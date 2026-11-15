package hanbao

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
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
		if args[0] == "accounts" {
			return []byte(`{"success":true,"data":{"accounts":[{"id":"创作账号1","logged_in":true}]}}`), nil
		}
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
	request.Images = make([][]byte, 10)
	if _, err := s.Submit(context.Background(), request); err == nil || called != 2 {
		t.Fatal("too many images dispatched")
	}
	request.Images = nil
	s.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
		if args[0] == "accounts" {
			return []byte(`{"success":true,"data":{"accounts":[{"id":"创作账号1","logged_in":true}]}}`), nil
		}
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

func TestFeihuProjectSearchUsesPlatformName(t *testing.T) {
	service := testService(t)
	service.token = "fixture-token"
	service.client = fakeHTTP(func(request *http.Request) (*http.Response, error) {
		if filepath.Base(request.URL.Path) != "projectList" {
			t.Fatal("project search dispatched an unrelated action")
		}
		if err := request.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if request.Form.Get("name") != "豆包三次" || request.Form.Get("token") != "fixture-token" {
			t.Fatalf("unexpected project search fields: %v", request.Form.Get("name"))
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":200,"data":{"list":[{"project_id":17868,"name":"豆包三次","price":0.2,"status":2}]}}`))}, nil
	})
	body, _ := json.Marshal(map[string]string{"name": "  豆包三次  "})
	var input SMSRequest
	if err := json.Unmarshal(body, &input); err != nil {
		t.Fatal(err)
	}
	result, err := service.SMS(context.Background(), "projects", input)
	if err != nil || len(result.(map[string]any)["list"].([]any)) != 1 {
		t.Fatalf("project search failed: %v", err)
	}
}

func TestFeihuBusinessErrorPreservesStageCodeAndSafeMessage(t *testing.T) {
	for _, status := range []int{200, 400} {
		service := testService(t)
		service.token = "fixture-token"
		service.client = fakeHTTP(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(`{"code":107001,"msg":"当前筛选条件无可用号码 fixture-key fixture-secret fixture-token https://example.com/?token=fixture-token","data":[]}`))}, nil
		})
		settings, _ := service.load()
		_, err := service.smsCall(context.Background(), settings.Feihu, "getPhone", url.Values{"token": {service.token}})
		if err == nil {
			t.Fatal("business failure accepted")
		}
		for _, expected := range []string{"取号", "107001", "当前筛选条件无可用号码"} {
			if !strings.Contains(err.Error(), expected) {
				t.Fatalf("missing %q in %v", expected, err)
			}
		}
		for _, secret := range []string{"fixture-key", "fixture-secret", "fixture-token", "https://example.com"} {
			if strings.Contains(err.Error(), secret) {
				t.Fatal("error exposed a credential or URL")
			}
		}
	}
}

func TestFeihuReadActionsAndReceiveFailureDoNotChangeOrders(t *testing.T) {
	service := testService(t)
	service.token = "fixture-token"
	phoneCalls := 0
	service.client = fakeHTTP(func(request *http.Request) (*http.Response, error) {
		body := `{"code":200,"data":{"money":10,"available_num":10}}`
		switch filepath.Base(request.URL.Path) {
		case "userInfo":
		case "projectList":
			body = `{"code":200,"data":{"list":[{"project_id":1382,"name":"豆包","status":2}]}}`
		case "getPhone":
			phoneCalls++
			if err := request.ParseForm(); err != nil || request.Form.Get("isp") != "hk" {
				t.Fatal("Hong Kong filter was not preserved")
			}
			body = `{"code":107001,"msg":"上游测试拒绝"}`
		default:
			t.Fatal("unexpected upstream action")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	if _, err := service.SMS(context.Background(), "info", SMSRequest{}); err != nil || phoneCalls != 0 {
		t.Fatal("balance lookup caused a purchase", err)
	}
	if _, err := service.SMS(context.Background(), "receive", SMSRequest{Account: "憨包1", Filters: map[string]string{"isp": "hk"}}); err == nil || !strings.Contains(err.Error(), "上游测试拒绝") {
		t.Fatal("receive failure detail was lost", err)
	}
	if phoneCalls != 1 || len(service.orders) != 0 {
		t.Fatal("failed purchase retried or created a local order")
	}
}

func TestFeihuBlacklistOnlyReleasesPendingOrders(t *testing.T) {
	for _, status := range []int{1, 3, 4, 5, 6} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			service := testService(t)
			settings, _ := service.load()
			service.token = "fixture-token"
			service.orders["fixture-order"] = Order{ID: "fixture-order", Account: "憨包1", ProjectID: "1382", Status: status, Code: "4829", Message: "测试短信", Connection: smsConnectionID(settings.Feihu)}
			service.ordersLoaded = true
			calls := 0
			service.client = fakeHTTP(func(request *http.Request) (*http.Response, error) {
				calls++
				if err := request.ParseForm(); err != nil || filepath.Base(request.URL.Path) != "addBlackList" || request.Form.Get("order_id") != "fixture-order" || len(request.Form) != 2 {
					t.Fatal("blacklist contract mismatch")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":200,"msg":"OK","data":{}}`))}, nil
			})
			result, err := service.SMS(context.Background(), "blacklist", SMSRequest{OrderID: "fixture-order"})
			if err != nil {
				t.Fatal(err)
			}
			expected := status
			if status == 1 {
				expected = 5
			}
			order := result.(Order)
			if calls != 1 || order.Status != expected || order.Code != "4829" || order.Message != "测试短信" {
				t.Fatalf("blacklisting changed the completed order: %+v", order)
			}
		})
	}
}

func TestFeihuDocumentPhoneFiltersAndMessageStatuses(t *testing.T) {
	for _, terminalStatus := range []int{3, 4, 5, 6} {
		t.Run(fmt.Sprint(terminalStatus), func(t *testing.T) {
			service := testService(t)
			filters := map[string]string{"phone": "13800138000", "isp": "hk", "province": "19", "cardType": "1", "include": "138|139", "exclude": "165|170", "author": "author-login-name", "mode": "3", "code": "fixture-integration", "hk": "1"}
			calls := map[string]int{}
			service.client = fakeHTTP(func(request *http.Request) (*http.Response, error) {
				if request.Method != http.MethodPost || request.URL.RawQuery != "" || request.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
					t.Fatal("expected form POST without URL credentials")
				}
				if err := request.ParseForm(); err != nil {
					t.Fatal(err)
				}
				action := filepath.Base(request.URL.Path)
				calls[action]++
				body := `{"code":200,"data":{}}`
				if action != "login" && request.Form.Get("token") != "fixture-token" {
					t.Fatal("missing token")
				}
				switch action {
				case "login":
					if len(request.Form) != 2 || request.Form.Get("user") != "fixture-key" || request.Form.Get("pass") != "fixture-secret" {
						t.Fatal("login contract mismatch")
					}
					body = `{"code":200,"data":{"token":"fixture-token"}}`
				case "userInfo":
					if len(request.Form) != 1 {
						t.Fatal("unexpected balance parameters")
					}
					body = `{"code":200,"data":{"money":36,"max_num":50,"available_num":49}}`
				case "projectList":
					if len(request.Form) != 2 || request.Form.Get("pid") != "1382" {
						t.Fatal("project verification contract mismatch")
					}
					body = `{"code":200,"data":{"list":[{"project_id":1382,"name":"豆包","price":0.2,"status":2}]}}`
				case "getPhone":
					if len(request.Form) != len(filters)+2 || request.Form.Get("pid") != "1382" {
						t.Fatal("unexpected phone parameters")
					}
					for key, value := range filters {
						if request.Form.Get(key) != value {
							t.Fatalf("filter %s was altered", key)
						}
					}
					body = `{"code":200,"data":{"pid":1382,"phone":"13800138000","order_id":"fixture-order"}}`
				case "getMessage":
					if len(request.Form) != 2 || request.Form.Get("order_id") != "fixture-order" {
						t.Fatal("message contract mismatch")
					}
					status := 1
					if calls[action] > 1 {
						status = terminalStatus
					}
					body = fmt.Sprintf(`{"code":200,"data":{"status":%d,"code":"04829","message":"测试短信"}}`, status)
				default:
					t.Fatalf("unexpected upstream action: %s", action)
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
			})
			ctx := context.Background()
			balance, err := service.SMS(ctx, "info", SMSRequest{})
			if err != nil || balance.(map[string]any)["available_num"] != float64(49) {
				t.Fatal("quota response mismatch", err)
			}
			if _, err = service.SMS(ctx, "receive", SMSRequest{Account: "憨包1", Filters: filters}); err != nil {
				t.Fatal(err)
			}
			if _, err = service.SMS(ctx, "message", SMSRequest{OrderID: "fixture-order"}); err != nil {
				t.Fatal(err)
			}
			service.lastPoll["fixture-order"] = 0
			result, err := service.SMS(ctx, "message", SMSRequest{OrderID: "fixture-order"})
			if err != nil || result.(Order).Status != terminalStatus || result.(Order).Code != "04829" {
				t.Fatal("message status or leading-zero code mismatch", err)
			}
			if _, err = service.SMS(ctx, "message", SMSRequest{OrderID: "fixture-order"}); err != nil || calls["getMessage"] != 2 || calls["login"] != 1 || calls["getPhone"] != 1 {
				t.Fatal("terminal order was polled or token was not cached", err)
			}
		})
	}
}

func TestFeihuDefaultPhoneModeUsesPlatformWithoutRetry(t *testing.T) {
	for _, mode := range []string{"", "2", "3"} {
		t.Run("mode-"+mode, func(t *testing.T) {
			service := testService(t)
			service.token = "fixture-token"
			phoneCalls := 0
			service.client = fakeHTTP(func(request *http.Request) (*http.Response, error) {
				if err := request.ParseForm(); err != nil {
					t.Fatal(err)
				}
				body := `{"code":200,"data":{"list":[{"project_id":1382,"name":"豆包","status":2}]}}`
				if filepath.Base(request.URL.Path) == "getPhone" {
					phoneCalls++
					expected := mode
					if expected == "" {
						expected = "1"
					}
					if request.Form.Get("mode") != expected {
						t.Fatalf("unexpected phone mode: %q, expected %q", request.Form.Get("mode"), expected)
					}
					body = `{"code":107001,"msg":"您还未加入该项目的任何对接码，请先去对接码页面加入后再取号","data":{}}`
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
			})
			_, err := service.SMS(context.Background(), "receive", SMSRequest{Account: "憨包1", Filters: map[string]string{"mode": mode}})
			if err == nil || !strings.Contains(err.Error(), "还未加入") || phoneCalls != 1 || len(service.orders) != 0 {
				t.Fatal("receive failure retried or lost the upstream reason", err)
			}
		})
	}
}

func TestHanbaoLoginCancellationReleasesAccountOperation(t *testing.T) {
	service := testService(t)
	started := make(chan struct{})
	service.runner = func(ctx context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
		if args[0] == "login" {
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return []byte(`{"success":true,"data":{"accounts":[]}}`), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan error, 1)
	go func() {
		_, err := service.Control(ctx, "login", "憨包1", "", nil, nil)
		finished <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("login did not start")
	}
	settings, _ := service.load()
	if err := service.Save(settings); !errors.Is(err, ErrBusy) {
		t.Fatal("settings should be protected during login", err)
	}
	cancel()
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("cancelled login reported success")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled login did not stop")
	}
	if err := service.Save(settings); err != nil {
		t.Fatal("settings remained locked after login cancellation", err)
	}
}
