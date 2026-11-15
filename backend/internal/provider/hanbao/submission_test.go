package hanbao

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCanonicalModelAcceptsCLIEnumAndDisplayNames(t *testing.T) {
	for _, scenario := range []struct {
		input, expected string
	}{
		{"seedance_v2.5", "seedance_v2.5"},
		{"Seedance 2.5", "seedance_v2.5"},
		{"seedance-2.0-mini", "seedance_v2.0_mini"},
		{"Seedance 2.0 Fast", "seedance_v2.0"},
	} {
		if actual := CanonicalModel(scenario.input); actual != scenario.expected || !SupportedModel(scenario.input) {
			t.Fatalf("CanonicalModel(%q) = %q, want %q", scenario.input, actual, scenario.expected)
		}
	}
	if SupportedModel("not-a-hanbao-model") || CanonicalModel("not-a-hanbao-model") != "" {
		t.Fatal("unknown model was accepted")
	}
}

func TestHanbaoPassesNineLargeOriginalsToComponentUnchanged(t *testing.T) {
	service := testService(t)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 3840, 2160))); err != nil {
		t.Fatal(err)
	}
	original := append(encoded.Bytes(), make([]byte, 4<<20)...)
	request := VideoRequest{Prompt: "fixture", Model: "seedance_v2.0", Duration: 8, Ratio: "9:16"}
	for index := 0; index < 9; index++ {
		request.Images = append(request.Images, original)
		request.ImageExtensions = append(request.ImageExtensions, ".png")
	}
	var paths []string
	submits := 0
	service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
		if args[0] == "accounts" {
			return []byte(`{"success":true,"data":{"accounts":[{"id":"ready","logged_in":true}]}}`), nil
		}
		if args[0] != "image2video" {
			t.Fatalf("wrong command: %v", args)
		}
		submits++
		for _, argument := range args {
			if !strings.HasPrefix(argument, "--image=") {
				continue
			}
			path := strings.TrimPrefix(argument, "--image=")
			data, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(data, request.Images[len(paths)]) || filepath.Ext(path) != ".png" {
				t.Fatalf("reference %d changed: %v", len(paths)+1, err)
			}
			paths = append(paths, path)
		}
		return []byte(`{"success":true,"data":{"submit_id":"cv:fixture","account":"ready"}}`), nil
	}
	ref, err := service.Submit(context.Background(), request)
	if err != nil || ref.SubmitID != "cv:fixture" || submits != 1 || len(paths) != 9 {
		t.Fatalf("original references did not reach component: ref=%+v count=%d submits=%d error=%v", ref, len(paths), submits, err)
	}
	for _, path := range paths {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("temporary reference was not removed")
		}
	}
}

func TestHanbaoSelectsAvailableAccountBeforeSingleSubmission(t *testing.T) {
	for _, scenario := range []struct {
		name, preferred, expected string
		accounts                  string
	}{
		{"automatic", "", "ready", `[{"id":"expired","logged_in":false},{"id":"ready","logged_in":true}]`},
		{"preferred", "preferred", "preferred", `[{"id":"ready","logged_in":true},{"id":"preferred","logged_in":true}]`},
		{"cooldown", "preferred", "ready", `[{"id":"preferred","logged_in":true,"blocked":true,"block_kind":"cooldown"},{"id":"ready","logged_in":true}]`},
		{"count-exhausted", "preferred", "ready", `[{"id":"preferred","logged_in":true,"daily_limit":1,"remaining_today":0},{"id":"ready","logged_in":true}]`},
		{"seconds-insufficient", "preferred", "ready", `[{"id":"preferred","logged_in":true,"daily_seconds_limit":60,"remaining_seconds":20},{"id":"ready","logged_in":true}]`},
		{"unlimited", "preferred", "preferred", `[{"id":"preferred","logged_in":true,"daily_limit":0,"remaining_today":0,"daily_seconds_limit":0,"remaining_seconds":0}]`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			service := testService(t)
			settings, _ := service.load()
			settings.Account = scenario.preferred
			if err := service.Save(settings); err != nil {
				t.Fatal(err)
			}
			commands := []string{}
			service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
				commands = append(commands, args[0])
				if args[0] == "accounts" {
					return []byte(`{"success":true,"data":{"accounts":` + scenario.accounts + `}}`), nil
				}
				if args[0] != "text2video" || args[1] != "--account="+scenario.expected {
					t.Fatalf("wrong selection: %v", args)
				}
				return []byte(`{"success":true,"data":{"submit_id":"cv:fixture","account":"actual"}}`), nil
			}
			ref, err := service.Submit(context.Background(), VideoRequest{Prompt: "fixture", Model: "seedance_v2.5", Duration: 30, Ratio: "9:16"})
			if err != nil || ref.Account != "actual" || strings.Join(commands, ",") != "accounts,text2video" {
				t.Fatalf("ref=%+v commands=%v error=%v", ref, commands, err)
			}
			loaded, _ := service.load()
			if loaded.Account != scenario.preferred {
				t.Fatal("dispatch overwrote the saved preference")
			}
		})
	}
}

func TestHanbaoNoAvailableAccountNeverSubmits(t *testing.T) {
	service := testService(t)
	service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
		if args[0] != "accounts" {
			t.Fatal("unavailable accounts reached generation")
		}
		return []byte(`{"success":true,"data":{"accounts":[{"id":"cooling","logged_in":true,"blocked":true,"block_kind":"cooldown"},{"id":"expired","logged_in":false}]}}`), nil
	}
	_, err := service.Submit(context.Background(), VideoRequest{Prompt: "fixture", Model: "seedance_v2.5", Duration: 30, Ratio: "9:16"})
	var uncertain UncertainError
	if err == nil || errors.As(err, &uncertain) || !strings.Contains(err.Error(), "冷却") || !strings.Contains(err.Error(), "未登录") {
		t.Fatalf("incorrect preflight failure: %v", err)
	}
}

func TestHanbaoAutomaticSelectionRotatesDespiteActiveAccount(t *testing.T) {
	service := testService(t)
	service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
		if args[0] != "accounts" {
			t.Fatal("selection must not submit generation")
		}
		return []byte(`{"success":true,"data":{"active":"first","accounts":[{"id":"first","logged_in":true},{"id":"cooling","logged_in":true,"blocked":true},{"id":"second","logged_in":true},{"id":"third","logged_in":true}]}}`), nil
	}
	for _, expected := range []string{"first", "second", "third", "first", "second"} {
		actual, err := service.selectAccount(context.Background(), "", 30)
		if err != nil || actual != expected {
			t.Fatalf("automatic selection = %q, want %q, error=%v", actual, expected, err)
		}
	}
	for range 3 {
		actual, err := service.selectAccount(context.Background(), "third", 30)
		if err != nil || actual != "third" {
			t.Fatalf("explicit preference lost: %q, %v", actual, err)
		}
	}
}

func TestHanbaoManualUnavailablePreferenceFallsBackToRotation(t *testing.T) {
	service := testService(t)
	service.runner = func(context.Context, string, []string, []string, string) ([]byte, error) {
		return []byte(`{"success":true,"data":{"active":"first","accounts":[{"id":"first","logged_in":true},{"id":"preferred","logged_in":true,"blocked":true},{"id":"second","logged_in":true}]}}`), nil
	}
	for _, expected := range []string{"first", "second", "first"} {
		actual, err := service.selectAccount(context.Background(), "preferred", 30)
		if err != nil || actual != expected {
			t.Fatalf("fallback selection = %q, want %q, error=%v", actual, expected, err)
		}
	}
}

func TestHanbaoThirtyOneAccountsRotateThroughSubmission(t *testing.T) {
	service := testService(t)
	settings, err := service.load()
	if err != nil {
		t.Fatal(err)
	}
	settings.Account = ""
	if err := service.Save(settings); err != nil {
		t.Fatal(err)
	}
	accounts := make([]accountCandidate, 31)
	for index := range accounts {
		accounts[index] = accountCandidate{ID: fmt.Sprintf("account-%02d", index+1), LoggedIn: true}
	}
	accountReply, err := json.Marshal(map[string]any{"success": true, "data": map[string]any{"active": accounts[0].ID, "accounts": accounts}})
	if err != nil {
		t.Fatal(err)
	}
	counts := make(map[string]int)
	submissions, accountChecks := 0, 0
	service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
		if args[0] == "accounts" {
			accountChecks++
			return accountReply, nil
		}
		if args[0] != "text2video" {
			t.Fatalf("unexpected command: %v", args)
		}
		expected := accounts[submissions%len(accounts)].ID
		if args[1] != "--account="+expected {
			t.Fatalf("submission %d selected %q, want %q", submissions+1, args[1], expected)
		}
		counts[expected]++
		submissions++
		return json.Marshal(map[string]any{"success": true, "data": map[string]any{"submit_id": fmt.Sprintf("cv:fixture-%d", submissions), "account": expected}})
	}
	for index := 0; index < len(accounts)*2; index++ {
		ref, err := service.Submit(context.Background(), VideoRequest{Prompt: "fixture", Model: "seedance_v2.5", Duration: 30, Ratio: "16:9"})
		if err != nil || ref.Account != accounts[index%len(accounts)].ID || ref.SubmitID != fmt.Sprintf("cv:fixture-%d", index+1) {
			t.Fatalf("submission %d returned wrong receipt: %+v, error=%v", index+1, ref, err)
		}
	}
	if submissions != 62 || accountChecks != 62 || len(counts) != 31 {
		t.Fatalf("wrong dispatch counts: submissions=%d checks=%d accounts=%d", submissions, accountChecks, len(counts))
	}
	for account, count := range counts {
		if count != 2 {
			t.Fatalf("account %s received %d tasks, want 2", account, count)
		}
	}
	loaded, err := service.load()
	if err != nil || loaded.Account != "" {
		t.Fatalf("automatic dispatch changed saved preference: %q, error=%v", loaded.Account, err)
	}
	t.Log("62 mocked submissions: all 31 accounts receive exactly two tasks; unchanged CLI active account does not pin dispatch")
}

func TestHanbaoFailedSubmissionRotatesOnlyOnNextRequestedTask(t *testing.T) {
	service := testService(t)
	var selected []string
	service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
		if args[0] == "accounts" {
			return []byte(`{"success":true,"data":{"active":"first","accounts":[{"id":"first","logged_in":true},{"id":"second","logged_in":true}]}}`), nil
		}
		selected = append(selected, args[1])
		return []byte(`{"success":false,"error":"审核不通过,请修改后重试"}`), nil
	}
	for _, expected := range []string{"--account=first", "--account=second"} {
		_, err := service.Submit(context.Background(), VideoRequest{Prompt: "fixture", Model: "seedance_v2.5", Duration: 30, Ratio: "9:16"})
		if err == nil || !strings.Contains(err.Error(), "审核不通过") || selected[len(selected)-1] != expected {
			t.Fatalf("wrong failure or account: %v %v", selected, err)
		}
	}
	if len(selected) != 2 {
		t.Fatalf("failed task automatically resubmitted: %v", selected)
	}
}

func TestHanbaoParsesMultilineReceiptAndNonzeroProcessExit(t *testing.T) {
	service := testService(t)
	service.runner = func(context.Context, string, []string, []string, string) ([]byte, error) {
		return []byte("progress\n{\n  \"success\": true,\n  \"data\": {\"submit_id\":\"cv:fixture\",\"account\":\"actual\"}\n}\n[done]\n"), errors.New("exit status 3")
	}
	reply, err := service.run(context.Background(), "text2video", nil, time.Second)
	if err != nil || reply.Data["submit_id"] != "cv:fixture" {
		t.Fatalf("valid receipt was lost: %+v %v", reply, err)
	}
}

func TestHanbaoFailureRetainsSanitizedReplyAndDoesNotRetry(t *testing.T) {
	service := testService(t)
	calls := 0
	service.runner = func(context.Context, string, []string, []string, string) ([]byte, error) {
		calls++
		return []byte(`{"success":false,"code":3,"error":"服务拒绝 token=PRIVATE Cookie: session=COOKIE https://example.com/?key=URLSECRET C:\\private\\session.json fixture-secret"}`), errors.New("exit status 3")
	}
	_, err := service.run(context.Background(), "text2video", nil, time.Second)
	if err == nil || calls != 1 || !strings.Contains(err.Error(), "服务拒绝") || !strings.Contains(err.Error(), "code=3") {
		t.Fatalf("reply detail lost: %v, calls=%d", err, calls)
	}
	for _, secret := range []string{"PRIVATE", "COOKIE", "URLSECRET", "private", "fixture-secret"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("secret leaked: %s", secret)
		}
	}
}

func TestHanbaoProcessCapturesStructuredStderr(t *testing.T) {
	if os.Getenv("HANBAO_PROCESS_FIXTURE") == "1" {
		body, _ := json.Marshal(map[string]any{"success": false, "error": "fixture rejection", "code": 3})
		_, _ = os.Stderr.Write(body)
		os.Exit(3)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	environment := append(os.Environ(), "HANBAO_PROCESS_FIXTURE=1")
	body, processErr := runProcess(context.Background(), executable, []string{"-test.run=^TestHanbaoProcessCapturesStructuredStderr$"}, environment, t.TempDir())
	reply, err := parseReply(body)
	if processErr == nil || err != nil || reply.Error != "fixture rejection" {
		t.Fatalf("stderr reply lost: %+v %v %v", reply, processErr, err)
	}
}

func TestHanbaoSubmissionFailureDoesNotLeakSpacedCredentials(t *testing.T) {
	for _, detail := range []string{`请求被拒绝 password="PRIVATE VALUE"`, "请求被拒绝 prompt:PRIVATE TEXT\nCOOKIE", `请求被拒绝 sessionid="PRIVATE VALUE"`} {
		service := testService(t)
		service.runner = func(context.Context, string, []string, []string, string) ([]byte, error) {
			body, _ := json.Marshal(map[string]any{"success": false, "error": detail})
			return body, nil
		}
		_, err := service.run(context.Background(), "text2video", nil, time.Second)
		if err == nil || !strings.Contains(err.Error(), "请求被拒绝") || strings.Contains(err.Error(), "VALUE") || strings.Contains(err.Error(), "PRIVATE") || strings.Contains(err.Error(), "COOKIE") {
			t.Fatalf("unsafe error: %v", err)
		}
	}
}

func TestHanbaoStartFailureIsLocalAndCannotHaveSubmitted(t *testing.T) {
	service := testService(t)
	service.runner = func(context.Context, string, []string, []string, string) ([]byte, error) {
		return nil, &os.PathError{Op: "fork/exec", Path: "C:/private/component.exe", Err: os.ErrPermission}
	}
	_, err := service.run(context.Background(), "text2video", nil, time.Second)
	var uncertain UncertainError
	if err == nil || errors.As(err, &uncertain) || !strings.Contains(err.Error(), "尚未提交") || strings.Contains(err.Error(), "private") {
		t.Fatalf("incorrect startup failure: %v", err)
	}
}

func TestHanbaoMissingReceiptNeverAutomaticallyResubmits(t *testing.T) {
	for _, output := range []string{`{"success":true,"data":{}}`, `{"success":false,"error":"组件异常","code":3}`, "incomplete response"} {
		service := testService(t)
		calls := 0
		service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
			if args[0] == "accounts" {
				return []byte(`{"success":true,"data":{"accounts":[{"id":"ready","logged_in":true}]}}`), nil
			}
			calls++
			return []byte(output), nil
		}
		_, err := service.Submit(context.Background(), VideoRequest{Prompt: "fixture", Model: "seedance_v2.5", Duration: 30, Ratio: "9:16"})
		var uncertain UncertainError
		if !errors.As(err, &uncertain) || calls != 1 {
			t.Fatalf("missing receipt caused resend: %d %v", calls, err)
		}
	}
}

func TestHanbaoConfirmedCanvasFailureIsNotUncertain(t *testing.T) {
	service := testService(t)
	calls := 0
	service.runner = func(context.Context, string, []string, []string, string) ([]byte, error) {
		calls++
		return []byte(`{"success":false,"code":3,"error":"画布连续 1 次生成失败（生成失败，请重试）：这条先跳过，可稍后重试或换个账号"}`), errors.New("exit status 1")
	}
	_, err := service.run(context.Background(), "text2video", nil, time.Second)
	var uncertain UncertainError
	var failure *CallError
	if errors.As(err, &uncertain) || !errors.As(err, &failure) || failure.Source != "upstream_response" || calls != 1 {
		t.Fatalf("confirmed failure misclassified: %v calls=%d", err, calls)
	}
}

func TestHanbaoQueryRetainsStructuredFailureAndQueryError(t *testing.T) {
	for _, status := range []string{"failed", "fail", "error", "expired", "cancelled", "canceled"} {
		service := testService(t)
		service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
			if args[0] != "query_result" || args[1] != "--submit_id=cv:workspace:conversation:item" || args[2] != "--account=actual" {
				t.Fatal(args)
			}
			return []byte(`{"success":false,"data":{"gen_status":"` + status + `","fail_reason":"参考素材未通过"}}`), errors.New("exit status 1")
		}
		state, err := service.Query(context.Background(), TaskRef{SubmitID: "cv:workspace:conversation:item", Account: "actual"})
		if err != nil || state["gen_status"] != status || !strings.Contains(ResultError(state).Error(), "参考素材未通过") {
			t.Fatalf("terminal state lost: %+v %v", state, err)
		}
	}
}

func TestHanbaoConversationReceiptUsesNativeTaskIdentity(t *testing.T) {
	for _, scenario := range []struct {
		name, data, expected string
	}{
		{"conversation-string", `{"conversation_id":"conversation-original","account":"actual"}`, "conversation-original"},
		{"conversation-number", `{"conversation_id":7392819471928374651,"account":"actual"}`, "7392819471928374651"},
		{"submit-precedence", `{"submit_id":"cv:original","conversation_id":"legacy","account":"actual"}`, "cv:original"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			service := testService(t)
			submits, queries := 0, 0
			service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
				switch args[0] {
				case "accounts":
					return []byte(`{"success":true,"data":{"accounts":[{"id":"actual","logged_in":true}]}}`), nil
				case "text2video":
					submits++
					return []byte(`{"success":true,"data":` + scenario.data + "}"), errors.New("exit status 3")
				case "query_result":
					queries++
					if args[1] != "--submit_id="+scenario.expected || args[2] != "--account=actual" {
						t.Fatalf("native receipt changed: %v", args)
					}
					return []byte(`{"success":true,"data":{"gen_status":"running"}}`), nil
				default:
					t.Fatalf("unexpected command: %v", args)
					return nil, nil
				}
			}
			ref, err := service.Submit(context.Background(), VideoRequest{Prompt: "fixture", Model: "seedance-2.5", Duration: 30, Ratio: "16:9"})
			if err != nil || ref.SubmitID != scenario.expected || ref.Account != "actual" {
				t.Fatalf("accepted native receipt was lost: %+v %v", ref, err)
			}
			if _, err := service.Query(context.Background(), ref); err != nil || submits != 1 || queries != 1 {
				t.Fatalf("receipt did not query original task: %v submits=%d queries=%d", err, submits, queries)
			}
		})
	}
}
