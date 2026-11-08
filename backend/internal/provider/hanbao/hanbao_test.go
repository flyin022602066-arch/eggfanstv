package hanbao

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func testService(t *testing.T) *Service {
	t.Helper()
	s := New(t.TempDir())
	settings := DefaultSettings()
	settings.Account = "创作账号1"
	settings.Feihu.APIKey, settings.Feihu.APISecret, settings.Feihu.ProjectID = "fixture-key", "fixture-secret", "1382"
	if err := s.Save(settings); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestReplySettingsAndBusyBoundaries(t *testing.T) {
	reply, err := parseReply([]byte("进度中\n{\"success\":true,\"data\":{\"account\":\"甲\"}}\n[done]\n"))
	if err != nil || reply.Data["account"] != "甲" {
		t.Fatalf("reply=%+v %v", reply, err)
	}
	if _, err := parseReply([]byte(`{"success":"true"}`)); err == nil {
		t.Fatal("non-bool success accepted")
	}
	s := testService(t)
	body, err := os.ReadFile(filepath.Join(s.dataDir, "settings.json"))
	if err != nil || strings.Contains(string(body), "fixture-secret") || strings.Contains(string(body), "fixture-key") {
		t.Fatal("plaintext credential persisted")
	}
	status, err := s.Status()
	if err != nil || status.Settings.Feihu.APIKey != "" || !status.Settings.Feihu.HasAPIKey || status.Settings.Feihu.APISecret != "" {
		t.Fatalf("public status=%+v %v", status, err)
	}
	if err := s.Save(status.Settings); err != nil {
		t.Fatal(err)
	}
	loaded, _ := s.load()
	if loaded.Feihu.APIKey != "fixture-key" {
		t.Fatal("empty secret overwrote credential")
	}
	release, err := s.Acquire()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save(loaded); !errors.Is(err, ErrBusy) {
		t.Fatalf("save during generation=%v", err)
	}
	if _, err := s.Control(context.Background(), "delete-account", "创作账号1", "", nil, nil); !errors.Is(err, ErrBusy) {
		t.Fatalf("delete during generation=%v", err)
	}
	release()
	for _, invalid := range []string{"../other", `C:\profile`, "--delete", "a/b"} {
		if validAccount(invalid) {
			t.Fatalf("unsafe label %q accepted", invalid)
		}
	}
	loaded.Account = "../other"
	if s.Save(loaded) == nil {
		t.Fatal("invalid account saved")
	}
}

func TestCLIArgumentsIsolationRotatedAccountAndUncertainSubmit(t *testing.T) {
	s := testService(t)
	if err := s.checkExecutable(); err != nil {
		t.Skip(err)
	}
	t.Setenv("DOUBAO_BASE_DIR", "foreign-profile")
	t.Setenv("DOUBAO_UPLOAD_DEBUG", "1")
	prompt := "中文路径 & $(do-not-execute) `原样`\n第二行"
	called := 0
	s.runner = func(_ context.Context, exe string, args, env []string, dir string) ([]byte, error) {
		called++
		if dir != s.dataDir || exe != s.executable {
			t.Fatal("wrong workspace")
		}
		values := map[string]string{}
		for _, entry := range env {
			key, value, _ := strings.Cut(entry, "=")
			values[strings.ToUpper(key)] = value
		}
		if values["DOUBAO_BASE_DIR"] != s.dataDir || values["APPDATA"] != filepath.Join(s.dataDir, ".isolated-appdata") || values["DOUBAO_UPLOAD_DEBUG"] != "" || values["CANVAS_ATTEMPTS"] != "1" {
			t.Fatal("environment isolation lost")
		}
		if called == 1 {
			if !reflect.DeepEqual(args, []string{"text2video", "--account=创作账号1", "--prompt=" + prompt, "--model=seedance_v2.5", "--duration=30", "--ratio=9:16", "--poll=0"}) {
				t.Fatalf("args=%q", args)
			}
			return []byte("progress\n" + `{"success":true,"data":{"submit_id":"cv:workspace:conversation:abc","account":"轮换账号2"}}`), nil
		}
		if !reflect.DeepEqual(args, []string{"query_result", "--submit_id=cv:workspace:conversation:abc", "--account=轮换账号2", "--once", "--timeout=300"}) {
			t.Fatalf("query args=%q", args)
		}
		return []byte(`{"success":true,"data":{"gen_status":"running"}}`), nil
	}
	request := VideoRequest{Prompt: prompt, Model: "seedance_v2.5", Duration: 30, Ratio: "9:16"}
	ref, err := s.Submit(context.Background(), request)
	if err != nil || ref.Account != "轮换账号2" || ref.SubmitID != "cv:workspace:conversation:abc" {
		t.Fatalf("ref=%+v %v", ref, err)
	}
	if _, err := s.Query(context.Background(), ref); err != nil {
		t.Fatal(err)
	}
	request.Images = [][]byte{make([]byte, (4<<20)+1)}
	if _, err := s.Submit(context.Background(), request); err == nil || called != 2 {
		t.Fatal("oversize images dispatched")
	}
	request.Images = nil
	s.runner = func(context.Context, string, []string, []string, string) ([]byte, error) {
		return nil, context.DeadlineExceeded
	}
	_, err = s.Submit(context.Background(), request)
	var uncertain UncertainError
	if !errors.As(err, &uncertain) {
		t.Fatalf("submission should be uncertain: %v", err)
	}
	s.executable = filepath.Join(t.TempDir(), "substitute.exe")
	_ = os.WriteFile(s.executable, []byte("not the supplied binary"), 0600)
	if s.checkExecutable() == nil {
		t.Fatal("substituted executable accepted")
	}
}

type fakeHTTP func(*http.Request) (*http.Response, error)

func (f fakeHTTP) Do(r *http.Request) (*http.Response, error) { return f(r) }

func TestFeihuFormOrderOwnershipPollingAndCredentialProtection(t *testing.T) {
	s := testService(t)
	calls := map[string]int{}
	s.client = fakeHTTP(func(r *http.Request) (*http.Response, error) {
		if r.Method != "POST" || r.URL.RawQuery != "" || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
			t.Fatal("credentials must stay in POST form")
		}
		body, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(body))
		action := filepath.Base(r.URL.Path)
		calls[action]++
		data := map[string]any{}
		switch action {
		case "login":
			if form.Get("user") != "fixture-key" || form.Get("pass") != "fixture-secret" {
				t.Fatal("wrong login fields")
			}
			data["token"] = "fixture-token"
		case "getPhone":
			if form.Get("token") != "fixture-token" || form.Get("pid") != "1382" || form.Get("cardType") != "1" || form.Get("author") != "" {
				t.Fatal("wrong phone form")
			}
			data = map[string]any{"phone": "13800138000", "order_id": "order-1"}
		case "getMessage":
			data = map[string]any{"status": 1}
		case "projectList":
			data = map[string]any{"list": []any{map[string]any{"project_id": 1382, "status": 2, "name": "豆包"}}}
		case "cancelRecv":
			data = map[string]any{"released": true}
		default:
			t.Fatalf("unexpected action %s", action)
		}
		reply, _ := json.Marshal(map[string]any{"code": 200, "data": data})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(reply)))}, nil
	})
	ctx := context.Background()
	if _, err := s.SMS(ctx, "message", SMSRequest{OrderID: "foreign"}); err == nil || len(calls) != 0 {
		t.Fatal("foreign order contacted upstream")
	}
	value, err := s.SMS(ctx, "receive", SMSRequest{Account: "憨包1", Filters: map[string]string{"cardType": "1"}})
	if err != nil || value.(Order).ID != "order-1" {
		t.Fatal(value, err)
	}
	if _, err := s.SMS(ctx, "receive", SMSRequest{Account: "憨包1"}); err == nil || calls["getPhone"] != 1 {
		t.Fatal("duplicate pending order allowed")
	}
	settings, _ := s.load()
	settings.Feihu.ProjectID = "999"
	if s.Save(settings) == nil {
		t.Fatal("pending order lost its credentials/project")
	}
	if _, err := s.SMS(ctx, "message", SMSRequest{OrderID: "order-1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SMS(ctx, "message", SMSRequest{OrderID: "order-1"}); err == nil || calls["getMessage"] != 1 {
		t.Fatal("10 second limit missing")
	}
	if _, err := s.SMS(ctx, "release", SMSRequest{OrderID: "order-1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SMS(ctx, "message", SMSRequest{OrderID: "order-1"}); err != nil || calls["getMessage"] != 1 {
		t.Fatal("terminal order polled upstream")
	}
	if _, err := s.SMS(ctx, "connect", SMSRequest{}); err != nil || calls["login"] != 2 {
		t.Fatal("explicit reconnect did not refresh token")
	}
	body, _ := os.ReadFile(filepath.Join(s.dataDir, "sms-orders.json"))
	if strings.Contains(string(body), "13800138000") || strings.Contains(string(body), "order-1") {
		t.Fatal("SMS order plaintext persisted")
	}
	restored := New(filepath.Dir(s.dataDir))
	orders, err := restored.SMS(ctx, "orders", SMSRequest{})
	if err != nil || len(orders.([]Order)) != 1 || orders.([]Order)[0].Status != 5 {
		t.Fatal("order not restored", err)
	}
	settings, _ = s.load()
	settings.Feihu.APIKey = "another-platform-account"
	if err := s.Save(settings); err != nil {
		t.Fatal(err)
	}
	before := calls["cancelRecv"]
	if _, err := s.SMS(ctx, "release", SMSRequest{OrderID: "order-1"}); err == nil || calls["cancelRecv"] != before {
		t.Fatal("old platform order reused with new credentials")
	}
}

func TestFeihuRejectsUnrelatedOrUnapprovedProjectBeforePhonePurchase(t *testing.T) {
	for _, item := range []struct {
		name   string
		status int
	}{{"其他平台", 2}, {"豆包", 1}} {
		t.Run(item.name, func(t *testing.T) {
			s := testService(t)
			s.token = "fixture-token"
			s.client = fakeHTTP(func(r *http.Request) (*http.Response, error) {
				if filepath.Base(r.URL.Path) != "projectList" {
					t.Fatal("invalid project reached phone purchase")
				}
				body, _ := json.Marshal(map[string]any{"code": 200, "data": map[string]any{"list": []any{map[string]any{"project_id": 1382, "status": item.status, "name": item.name}}}})
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(body)))}, nil
			})
			if _, err := s.SMS(context.Background(), "receive", SMSRequest{Account: "憨包1"}); err == nil {
				t.Fatal("unsupported project accepted")
			}
		})
	}
}

func TestFeihuBusinessFailureDoesNotReleaseOrderOrLeakSecrets(t *testing.T) {
	s := testService(t)
	settings, _ := s.load()
	s.orders["own"] = Order{ID: "own", Account: "憨包1", ProjectID: "1382", Status: 1, Connection: smsConnectionID(settings.Feihu)}
	if err := s.saveOrders(); err != nil {
		t.Fatal(err)
	}
	s.token = "fixture-token"
	s.client = fakeHTTP(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":100010,"msg":"fixture-secret"}`))}, nil
	})
	_, err := s.SMS(context.Background(), "release", SMSRequest{OrderID: "own"})
	if err == nil || strings.Contains(err.Error(), "fixture-secret") || s.orders["own"].Status != 1 {
		t.Fatal("business failure not preserved", err)
	}
	if _, err := validateFeihuBase("https://127.0.0.1/api/sms"); err == nil {
		t.Fatal("private host accepted")
	}
	if _, err := validateFeihuBase("https://example.com/api/sms?token=secret"); err == nil {
		t.Fatal("URL secret accepted")
	}
}
