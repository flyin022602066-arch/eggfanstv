package handler

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"infinite-canvas/backend/internal/app"

	"github.com/gin-gonic/gin"
)

type sunoRelayContract struct {
	method string
	path   string
	body   string
}

var sunoRelayContracts = []sunoRelayContract{
	{http.MethodPost, "/suno/submit/music", `{"prompt":"test"}`},
	{http.MethodGet, "/suno/fetch/task_abc123", ""},
	{http.MethodPost, "/suno/uploads/audio", `{"url":"https://example.com/audio.mp3"}`},
	{http.MethodPost, "/suno/submit/lyrics", `{"prompt":"test"}`},
	{http.MethodPost, "/suno/submit/persona", `{"clip_id":"clip-1"}`},
	{http.MethodGet, "/suno/account/integral", ""},
	{http.MethodGet, "/suno/act/midi?clipId=clip-1&stemClipId=stem_2", ""},
	{http.MethodGet, "/suno/act/mp4-state?taskBatchId=1265431382265176065", ""},
	{http.MethodGet, "/suno/act/music-style", ""},
	{http.MethodGet, "/suno/act/my-musics?pageNum=1&pageSize=10", ""},
	{http.MethodGet, "/suno/act/timing/clip-1", ""},
	{http.MethodGet, "/suno/act/wav/clip-1", ""},
	{http.MethodGet, "/suno/act/waveform?clipId=clip-1", ""},
	{http.MethodPost, "/suno/fetch", `{"ids":["task_abc123","clip_xyz456"]}`},
	{http.MethodPost, "/suno/submit/adjust-speed", `{"clip_id":"clip-1","speed":1.5}`},
	{http.MethodPost, "/suno/submit/concat", `{"clip_id":"clip-1"}`},
	{http.MethodPost, "/suno/submit/fade", `{"clip_id":"clip-1","fade_in_s":2}`},
	{http.MethodPost, "/suno/submit/mp4", `{"clip_id":"clip-1"}`},
	{http.MethodPost, "/suno/submit/regen-img", `{"task_batch_id":"1265431382265176065"}`},
	{http.MethodPost, "/suno/submit/set-metadata", `{"clip_id":"clip-1","title":"test","image_url":"https://example.com/cover.jpg"}`},
	{http.MethodPost, "/suno/submit/stems", `{"clip_id":"clip-1"}`},
	{http.MethodPost, "/suno/submit/stems-all", `{"clip_id":"clip-1"}`},
	{http.MethodPost, "/suno/submit/stems-all-by-url", `{"url":"https://example.com/audio.mp3"}`},
	{http.MethodPost, "/suno/submit/stems-by-url", `{"url":"https://example.com/audio.mp3"}`},
	{http.MethodPost, "/suno/submit/upsample-tags", `{"original_tags":"test"}`},
	{http.MethodPost, "/suno/submit/url-transfer", `{"url":"https://example.com/audio.mp3"}`},
}

func TestSunoRelayAllowsPublishedContracts(t *testing.T) {
	if len(sunoRelayContracts) != 26 {
		t.Fatalf("contract count = %d, want 26", len(sunoRelayContracts))
	}
	for _, contract := range sunoRelayContracts {
		t.Run(contract.method+" "+contract.path, func(t *testing.T) {
			target, err := url.Parse("https://api.example.com" + contract.path)
			if err != nil {
				t.Fatal(err)
			}
			if err := authorizeCustomRelay(contract.method, target, "openai", "application/json; charset=utf-8"); err != nil {
				t.Fatalf("published Suno route rejected: %v", err)
			}
		})
	}
}

func TestSunoRelayRestrictsMethodsFormatsAndContentTypes(t *testing.T) {
	for _, contract := range sunoRelayContracts {
		t.Run(contract.path, func(t *testing.T) {
			target, err := url.Parse("https://api.example.com" + contract.path)
			if err != nil {
				t.Fatal(err)
			}
			for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead, http.MethodOptions} {
				if method != contract.method && authorizeCustomRelay(method, target, "openai", "application/json") == nil {
					t.Errorf("unexpected method %s allowed", method)
				}
			}
			for _, format := range []string{"gemini", "claude", "", "unknown"} {
				if err := authorizeCustomRelay(contract.method, target, format, "application/json"); err == nil {
					t.Errorf("unexpected format %q allowed", format)
				}
			}
			for _, query := range []string{"extra=1", "pageNum=1", "key=secret", "api_key=secret", "access_token=secret", "token=secret", "%6bey=secret"} {
				invalid := *target
				if invalid.RawQuery != "" {
					invalid.RawQuery += "&"
				}
				invalid.RawQuery += query
				if target.Path == "/suno/act/my-musics" && query == "pageNum=1" {
					query = "repeated pageNum"
				}
				if err := authorizeCustomRelay(contract.method, &invalid, "openai", "application/json"); err == nil {
					t.Errorf("unexpected query %q allowed", query)
				}
			}
			if contract.method == http.MethodPost {
				for _, contentType := range []string{"", "text/plain", "application/octet-stream", "application/x-www-form-urlencoded", "multipart/form-data; boundary=test", "application/problem+json", "application/json; charset"} {
					if err := authorizeCustomRelay(contract.method, target, "openai", contentType); err == nil {
						t.Errorf("unexpected POST content type %q allowed", contentType)
					}
				}
			}
		})
	}
}

func TestSunoRelayStrictQueryValidation(t *testing.T) {
	for _, requestPath := range []string{
		"/suno/act/my-musics",
		"/suno/act/my-musics?pageNum=1",
		"/suno/act/my-musics?pageSize=10",
		"/suno/act/my-musics?pageNum=2&pageSize=25",
		"/suno/act/midi?stemClipId=stem_2&clipId=clip-1",
		"/suno/act/mp4-state?taskBatchId=184467440737095516160",
		"/suno/act/waveform?clipId=9846ddf3-f154-4198-aad9-2652c22aa879",
	} {
		t.Run("allow "+requestPath, func(t *testing.T) {
			target, err := url.Parse("https://api.example.com" + requestPath)
			if err != nil {
				t.Fatal(err)
			}
			if err := authorizeCustomRelay(http.MethodGet, target, "openai", ""); err != nil {
				t.Fatalf("valid query rejected: %v", err)
			}
		})
	}
	invalidPaths := []string{
		"/suno/act/midi", "/suno/act/midi?clipId=clip-1", "/suno/act/midi?stemClipId=stem_2",
		"/suno/act/midi?clipId=&stemClipId=stem_2", "/suno/act/midi?clipId=clip-1&stemClipId=",
		"/suno/act/midi?clipId=clip-1&stemClipId=stem_2&clipId=clip-1",
		"/suno/act/midi?clipId=clip-1&stemClipId=stem_2&stemClipId=stem_2",
		"/suno/act/mp4-state", "/suno/act/mp4-state?taskBatchId=", "/suno/act/mp4-state?taskBatchId=%20",
		"/suno/act/mp4-state?taskBatchId=task-1&taskBatchId=task-2",
		"/suno/act/waveform", "/suno/act/waveform?clipId=", "/suno/act/waveform?clipId=%20",
		"/suno/act/waveform?clipId=clip-1&clipId=clip-2",
		"/suno/act/waveform?clipId=clip-1&%63lipId=clip-2",
		"/suno/act/waveform?clipId=clip-1&ClipId=clip-2",
		"/suno/act/waveform?clipId=clip-1&stemClipId=stem_2",
		"/suno/act/waveform?clipId=clip-1&pageSize=10",
		"/suno/act/waveform?clipId=clip-1;extra=1",
		"/suno/act/waveform?clipId=%zz",
	}
	for _, key := range []string{"clipId", "stemClipId", "taskBatchId"} {
		requestPath := "/suno/act/waveform?clipId="
		if key == "stemClipId" {
			requestPath = "/suno/act/midi?clipId=clip-1&stemClipId="
		} else if key == "taskBatchId" {
			requestPath = "/suno/act/mp4-state?taskBatchId="
		}
		for _, value := range []string{"%00", "a%2Fb", "a%5Cb", "%2e%2e", "%252e%252e", "a+b", "clip%26key%3Dsecret"} {
			invalidPaths = append(invalidPaths, requestPath+value)
		}
	}
	for _, key := range []string{"pageNum", "pageSize"} {
		for _, value := range []string{"", "0", "-1", "1.5", "1e2", "NaN", "abc", "%2B1", "%201", "1%20", "18446744073709551616"} {
			invalidPaths = append(invalidPaths, "/suno/act/my-musics?"+key+"="+value)
		}
		invalidPaths = append(invalidPaths, "/suno/act/my-musics?"+key+"=1&"+key+"=2")
	}
	invalidPaths = append(invalidPaths, "/suno/act/my-musics?clipId=clip-1", "/suno/act/my-musics?PageNum=1")
	for _, requestPath := range invalidPaths {
		t.Run("reject "+requestPath, func(t *testing.T) {
			target, err := url.Parse("https://api.example.com" + requestPath)
			if err != nil {
				t.Fatal(err)
			}
			if err := authorizeCustomRelay(http.MethodGet, target, "openai", ""); err == nil {
				t.Fatal("invalid query allowed")
			}
		})
	}
}

func TestSunoRelayRejectsUnknownAndEncodedPaths(t *testing.T) {
	paths := []string{
		"/suno", "/suno/", "/suno/models", "/suno/videos", "/suno/v1/responses",
		"/suno/submit/unknown", "/suno/submit/music/extra", "/suno/submit/music/",
		"/suno/uploads/audio/extra", "/suno/act/midi/clip-1", "/suno/fetch/",
		"/v1/suno/submit/music", "/prefix/suno/act/wav/clip-1", "/v1/suno/models",
		"/Suno/submit/music", "/suno//submit/music", "/suno/submit/../submit/music",
		"/suno/submit/%2e%2e/submit/music", "/suno/%73ubmit/music", "/%73uno/submit/music",
	}
	for _, prefix := range []string{"/suno/fetch/", "/suno/act/wav/", "/suno/act/timing/"} {
		for _, id := range []string{"", ".", "..", "clip/extra", "clip%2fextra", "clip%252fextra", "%2e%2e", "%252e%252e", "clip%5cextra", "clip%255cextra", "clip%00", "clip%20id", "clip%3fkey=secret", "clip%23fragment"} {
			paths = append(paths, prefix+id)
		}
	}
	for _, requestPath := range paths {
		t.Run(requestPath, func(t *testing.T) {
			target, err := url.Parse("https://api.example.com" + requestPath)
			if err != nil {
				t.Fatal(err)
			}
			for _, method := range []string{http.MethodGet, http.MethodPost} {
				if err := authorizeCustomRelay(method, target, "openai", "application/json"); err == nil {
					t.Errorf("unexpected path allowed for %s", method)
				}
			}
		})
	}
}

func TestSunoRelayForwardsContractsAndRedactsSecrets(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const apiKey = "suno-local-secret-key"
	type observedRequest struct {
		method string
		uri    string
		body   string
	}
	observed := make(chan observedRequest, 1)
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+apiKey {
			t.Errorf("Authorization = %q", request.Header.Get("Authorization"))
		}
		if request.Header.Get("X-Gateway-Tenant") != "suno-tenant" || request.Header.Get("User-Agent") != "Suno Relay Test" {
			t.Errorf("custom headers not retained: %v", request.Header)
		}
		for _, header := range []string{"Cookie", "Origin", "Referer", "X-Canvas-Upstream-URL", app.CustomRelayHeadersHeader, "X-Forwarded-For", "X-Goog-Api-Key"} {
			if value := request.Header.Get(header); value != "" {
				t.Errorf("browser/internal header forwarded: %s = %q", header, value)
			}
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Error(err)
		}
		observed <- observedRequest{request.Method, request.URL.RequestURI(), string(body)}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "upstream=unsafe")
		_, _ = io.WriteString(w, `{"code":"success","data":"`+apiKey+`"}`)
	}))
	defer upstream.Close()
	useCustomRelayTestClient(t, upstream.Client())
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, contract := range sunoRelayContracts {
		t.Run(contract.method+" "+contract.path, func(t *testing.T) {
			request := newSunoRelayTestRequest(contract.method, upstream.URL+contract.path, contract.body, apiKey)
			request.Header.Set(app.CustomRelayHeadersHeader, base64.StdEncoding.EncodeToString([]byte(`[{"name":"User-Agent","value":"Suno Relay Test"},{"name":"X-Gateway-Tenant","value":"suno-tenant"}]`)))
			request.Header.Set("Cookie", "browser=session")
			request.Header.Set("Origin", "https://canvas.example.com")
			request.Header.Set("Referer", "https://canvas.example.com/music")
			request.Header.Set("X-Goog-Api-Key", "stale-browser-key")
			response := serveSunoRelayTestRequest(request)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			got := <-observed
			if got.method != contract.method || got.uri != contract.path || got.body != contract.body {
				t.Fatalf("upstream request = %+v, want %+v", got, contract)
			}
			if strings.Contains(response.Body.String(), apiKey) || !strings.Contains(response.Body.String(), "[REDACTED]") {
				t.Fatalf("secret not redacted: %s", response.Body.String())
			}
			if response.Header().Get("Set-Cookie") != "" || response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("unsafe response headers: %v", response.Header())
			}
		})
	}
}

func TestSunoRelayWAVResponseTypes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		path        string
		contentType string
		body        string
		status      int
	}{
		{"/suno/act/wav/clip-1", "application/json", `{"code":200,"data":[],"msg":"ok"}`, http.StatusOK},
		{"/suno/act/wav/clip-1", "application/problem+json", `{"data":[]}`, http.StatusOK},
		{"/suno/act/wav/clip-1", "audio/wav", "RIFF-local-wav", http.StatusOK},
		{"/suno/act/wav/clip-1", "audio/x-wav; rate=44100", "RIFF-local-wav", http.StatusOK},
		{"/suno/act/wav/clip-1", "application/octet-stream", "RIFF-local-wav", http.StatusOK},
		{"/suno/act/wav/clip-1", "video/mp4", "video-content", http.StatusBadGateway},
		{"/suno/act/wav/clip-1", "text/html", "<html>unsafe</html>", http.StatusBadGateway},
		{"/suno/fetch/task-1", "audio/wav", "RIFF-local-wav", http.StatusBadGateway},
		{"/suno/act/timing/clip-1", "application/octet-stream", "media", http.StatusBadGateway},
		{"/suno/act/waveform?clipId=clip-1", "audio/wav", "RIFF-local-wav", http.StatusBadGateway},
		{"/suno/act/midi?clipId=clip-1&stemClipId=stem_2", "audio/midi", "midi-content", http.StatusBadGateway},
	} {
		t.Run(test.path+" "+test.contentType, func(t *testing.T) {
			upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				w.Header().Set("Content-Type", test.contentType)
				_, _ = io.WriteString(w, test.body)
			}))
			defer upstream.Close()
			useCustomRelayTestClient(t, upstream.Client())
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			response := serveSunoRelayTestRequest(newSunoRelayTestRequest(http.MethodGet, upstream.URL+test.path, "", "test-key"))
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d, body = %s", response.Code, test.status, response.Body.String())
			}
			if test.status == http.StatusOK && response.Body.String() != test.body {
				t.Fatalf("response body = %q, want %q", response.Body.String(), test.body)
			}
		})
	}
}

func TestSunoRelayRedactsUpstreamErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const apiKey = "suno-error-secret"
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"invalid key `+apiKey+`"}}`)
	}))
	defer upstream.Close()
	useCustomRelayTestClient(t, upstream.Client())
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	response := serveSunoRelayTestRequest(newSunoRelayTestRequest(http.MethodGet, upstream.URL+"/suno/act/wav/clip-1", "", apiKey))
	if response.Code != http.StatusUnauthorized || strings.Contains(response.Body.String(), apiKey) || !strings.Contains(response.Body.String(), "[REDACTED]") {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestSunoRelayKeepsPrivateUpstreamPolicy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var requests atomic.Int32
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer upstream.Close()
	useCustomRelayTestClient(t, upstream.Client())
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	for _, allowedHost := range []string{"", "127.0.0.2"} {
		t.Run("allowlist="+allowedHost, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", allowedHost)
			response := serveSunoRelayTestRequest(newSunoRelayTestRequest(http.MethodGet, upstream.URL+"/suno/account/integral", "", "test-key"))
			if response.Code >= http.StatusOK && response.Code < http.StatusMultipleChoices {
				t.Fatalf("private upstream allowed without exact host: %s", response.Body.String())
			}
		})
	}
	if requests.Load() != 0 {
		t.Fatal("blocked private upstream was contacted")
	}
}

func newSunoRelayTestRequest(method string, target string, body string, apiKey string) *http.Request {
	request := httptest.NewRequest(method, "/api/ai/custom", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("X-Canvas-Upstream-URL", target)
	request.Header.Set("X-Canvas-Upstream-Format", "openai")
	if method == http.MethodPost {
		request.Header.Set("Content-Type", "application/json")
	}
	return request
}

func serveSunoRelayTestRequest(request *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request
	proxyCustomRelayRequest(context, defaultCustomRelayTestPolicy())
	return response
}
