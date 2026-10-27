package app

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestVideoPollRecoversFromTransientHTTPError(t *testing.T) {
	attempts := 0
	result, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		switch attempts {
		case 1:
			return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusBadGateway, Status: "502 Bad Gateway"}
		case 2:
			return videoPollOutcome{}, nil
		default:
			return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if attempts != 3 || result["mode"] != "video" {
		t.Fatalf("attempts = %d, result = %#v", attempts, result)
	}
}

func TestVideoPollWaitsBeforeFirstQueryAndUsesRetryAfter(t *testing.T) {
	var waits []time.Duration
	policy := fastVideoPollPolicy()
	policy.InitialDelay = 10 * time.Millisecond
	policy.Interval = 10 * time.Millisecond
	policy.Sleep = func(_ context.Context, delay time.Duration) error {
		waits = append(waits, delay)
		return nil
	}
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", policy, func(context.Context) (videoPollOutcome, error) {
		attempts++
		if attempts == 1 {
			return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusTooManyRequests, RetryAfter: 20 * time.Millisecond}
		}
		return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := []time.Duration{10 * time.Millisecond, 20 * time.Millisecond}; !reflect.DeepEqual(waits, want) {
		t.Fatalf("waits = %v, want %v", waits, want)
	}
}

func TestVideoPollStopsImmediatelyOnAuthenticationError(t *testing.T) {
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusUnauthorized, Status: "401 Unauthorized"}
	})
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusUnauthorized {
		t.Fatalf("error = %#v, want 401 provider error", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}

func TestVideoPollRecoversFromTracedConnectionFailure(t *testing.T) {
	for _, phase := range []string{"connect", "tls", "response"} {
		t.Run(phase, func(t *testing.T) {
			attempts := 0
			result, err := runVideoPollLoop(context.Background(), "original-task", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
				attempts++
				if attempts == 1 {
					return videoPollOutcome{}, providerTransportError{Kind: "poll", Phase: phase, Cause: errors.New("connection reset by peer")}
				}
				return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
			})
			if err != nil || attempts != 2 || result["mode"] != "video" {
				t.Fatalf("poll did not recover: attempts=%d result=%v err=%v", attempts, result, err)
			}
		})
	}
}

func TestVideoPollDoesNotRetryCreateOrInvalidCertificate(t *testing.T) {
	for _, failure := range []error{
		providerTransportError{Kind: "create", Cause: errors.New("connection reset by peer")},
		providerTransportError{Kind: "poll", Cause: x509.UnknownAuthorityError{}},
		providerTransportError{Kind: "poll", Cause: x509.HostnameError{Certificate: &x509.Certificate{}, Host: "wrong.example"}},
		providerTransportError{Kind: "poll", Cause: context.Canceled},
	} {
		if retry, _ := retryableVideoPollError(context.Background(), failure); retry {
			t.Fatalf("permanent or create error retried: %T", failure)
		}
	}
}

func TestVideoPollStopsAfterThreeConsecutiveNotFoundResponses(t *testing.T) {
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusNotFound, Status: "404 Not Found"}
	})
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusNotFound {
		t.Fatalf("error = %#v, want 404 provider error", err)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3", attempts)
	}
}

func TestVideoPollSuccessfulPendingResponseResetsNotFoundCounter(t *testing.T) {
	attempts := 0
	result, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		switch attempts {
		case 1, 3:
			return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusNotFound, Status: "404 Not Found"}
		case 2:
			return videoPollOutcome{}, nil
		default:
			return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if attempts != 4 || result["mode"] != "video" {
		t.Fatalf("attempts = %d, result = %#v", attempts, result)
	}
}

func TestVideoPollRetriesMalformedResponseTwiceThenSucceeds(t *testing.T) {
	attempts := 0
	result, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		if attempts <= 2 {
			return videoPollOutcome{}, &json.SyntaxError{Offset: int64(attempts)}
		}
		return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
	})
	if err != nil || attempts != 3 || result["mode"] != "video" {
		t.Fatalf("result = %#v, error = %v, attempts = %d", result, err, attempts)
	}
}

func TestVideoPollStopsAfterThreeMalformedResponses(t *testing.T) {
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		return videoPollOutcome{}, &json.SyntaxError{Offset: int64(attempts)}
	})
	var syntaxError *json.SyntaxError
	if !errors.As(err, &syntaxError) || attempts != 3 {
		t.Fatalf("error = %#v, attempts = %d, want three attempts and syntax error", err, attempts)
	}
}

func TestVideoPollTreatsCircuitAndInterruptedReadsAsTransient(t *testing.T) {
	for _, err := range []error{providerCircuitOpenError{}, io.ErrUnexpectedEOF, io.ErrClosedPipe} {
		retry, notFound := retryableVideoPollError(context.Background(), err)
		if !retry || notFound {
			t.Fatalf("error %T classified as retry=%v notFound=%v", err, retry, notFound)
		}
	}
}

func TestVideoPollNotifiesOnlyWhenRetryStartsAndRecovers(t *testing.T) {
	var events []videoPollEvent
	policy := fastVideoPollPolicy()
	policy.Notify = func(_ context.Context, _ string, event videoPollEvent, _ error) {
		events = append(events, event)
	}
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", policy, func(context.Context) (videoPollOutcome, error) {
		attempts++
		switch attempts {
		case 1, 2:
			return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusBadGateway}
		case 3:
			return videoPollOutcome{}, nil
		default:
			return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []videoPollEvent{videoPollEventRetrying, videoPollEventRecovered}
	if len(events) != len(want) || events[0] != want[0] || events[1] != want[1] {
		t.Fatalf("events = %#v, want %#v", events, want)
	}
}

func TestVideoPollContextCancellationInterruptsInitialWait(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	_, err := runVideoPollLoop(ctx, "provider-task-1", defaultVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		called = true
		return videoPollOutcome{}, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context canceled", err)
	}
	if called {
		t.Fatal("query ran after cancellation")
	}
}

func TestVideoPollAppliesFallbackDeadlineToWaitAndQuery(t *testing.T) {
	policy := fastVideoPollPolicy()
	waitHadDeadline := false
	queryHadDeadline := false
	policy.Sleep = func(ctx context.Context, _ time.Duration) error {
		_, waitHadDeadline = ctx.Deadline()
		return nil
	}
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", policy, func(ctx context.Context) (videoPollOutcome, error) {
		_, queryHadDeadline = ctx.Deadline()
		return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !waitHadDeadline || !queryHadDeadline {
		t.Fatalf("wait deadline = %v, query deadline = %v", waitHadDeadline, queryHadDeadline)
	}
}

func TestVideoDownloadRetriesTransientFailure(t *testing.T) {
	attempts := 0
	waits := 0
	policy := fastVideoPollPolicy()
	policy.Sleep = func(context.Context, time.Duration) error {
		waits++
		return nil
	}
	data, mimeType, err := runVideoDownload(context.Background(), "provider-task-1", policy, func(context.Context) ([]byte, string, error) {
		attempts++
		if attempts == 1 {
			return nil, "", providerHTTPError{StatusCode: http.StatusBadGateway, Status: "502 Bad Gateway"}
		}
		return []byte("video"), "video/mp4", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "video" || mimeType != "video/mp4" || attempts != 2 || waits != 1 {
		t.Fatalf("data = %q, mime = %q, attempts = %d, waits = %d", data, mimeType, attempts, waits)
	}
}

func TestVideoDownloadStopsAfterThreeTransientFailures(t *testing.T) {
	attempts := 0
	_, _, err := runVideoDownload(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) ([]byte, string, error) {
		attempts++
		return nil, "", providerHTTPError{StatusCode: http.StatusServiceUnavailable, Status: "503 Service Unavailable"}
	})
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || attempts != 3 {
		t.Fatalf("error = %#v, attempts = %d, want three attempts and provider error", err, attempts)
	}
}

func TestVideoPollDoesNotRetryExhaustedDownload(t *testing.T) {
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		return videoPollOutcome{}, videoDownloadError{TaskID: "provider-task-1", Cause: providerHTTPError{StatusCode: http.StatusBadGateway}}
	})
	var downloadError videoDownloadError
	if !errors.As(err, &downloadError) || attempts != 1 {
		t.Fatalf("error = %#v, poll attempts = %d, want one exhausted download", err, attempts)
	}
}

func fastVideoPollPolicy() videoPollPolicy {
	policy := defaultVideoPollPolicy()
	policy.InitialDelay = time.Millisecond
	policy.Interval = time.Millisecond
	policy.Sleep = func(context.Context, time.Duration) error { return nil }
	return policy
}

func runVideoTaskForTest(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	return runVideoTaskWithPolicy(ctx, input, fastVideoPollPolicy())
}

func TestEggfansSeedanceVideoUsesNativeTaskRoute(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var createBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v3/contents/generations/tasks":
			if request.Method != http.MethodPost {
				t.Fatalf("create method = %s, want POST", request.Method)
			}
			if err := json.NewDecoder(request.Body).Decode(&createBody); err != nil {
				t.Fatalf("decode create body: %v", err)
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"data":{"task_id":"task-native"}}`))
		case "/api/v3/contents/generations/tasks/task-native":
			if request.Method != http.MethodGet {
				t.Fatalf("poll method = %s, want GET", request.Method)
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"data":{"status":"succeeded","content":{"video_url":"http://` + request.Host + `/result.mp4"}}}`))
		case "/result.mp4":
			writer.Header().Set("Content-Type", "video/mp4")
			_, _ = writer.Write([]byte("mock-video"))
		default:
			t.Errorf("unexpected request: %s %s", request.Method, request.URL.Path)
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	result, err := runVideoTaskForTest(context.Background(), canvasGenerationInput{
		Mode:   "video",
		Prompt: "a native seedance task",
		Config: providerConfig{
			BaseURL:       server.URL,
			APIKey:        "test-key",
			Model:         "doubao-seedance-2-5-260628",
			InterfaceType: "eggfans-seedance-video",
			Size:          "9:16",
			VQuality:      "720p",
			VideoSeconds:  "27",
		},
		ReferenceImages: []providerMedia{{URL: "https://example.com/reference.png"}},
	})
	if err != nil {
		t.Fatalf("run video task: %v", err)
	}
	if result["mode"] != "video" {
		t.Fatalf("result mode = %#v, want video", result["mode"])
	}
	if createBody["model"] != "doubao-seedance-2-5-260628" {
		t.Fatalf("model = %#v", createBody["model"])
	}
	content, ok := createBody["content"].([]interface{})
	if !ok || len(content) != 2 {
		t.Fatalf("content = %#v, want text and image entries", createBody["content"])
	}
	if _, exists := createBody["image_urls"]; exists {
		t.Fatal("native request contains legacy image_urls")
	}
	if _, exists := createBody["aspect_ratio"]; exists {
		t.Fatal("native request contains legacy aspect_ratio")
	}
	if _, exists := createBody["seconds"]; exists {
		t.Fatal("native request contains legacy seconds")
	}
	if createBody["ratio"] != "9:16" || createBody["resolution"] != "720p" || createBody["duration"] != float64(27) {
		t.Fatalf("native options = ratio=%#v resolution=%#v duration=%#v", createBody["ratio"], createBody["resolution"], createBody["duration"])
	}
	if !strings.Contains(fmt.Sprint(content[0]), "native seedance task") {
		t.Fatalf("prompt missing from content: %#v", content[0])
	}
}
