package hanbao

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestLoginRequiresConfirmedSession(t *testing.T) {
	for _, fixture := range []struct {
		name      string
		body      string
		confirmed bool
	}{
		{"saved", `{"success":true,"data":{"logged_in":true,"account":"fixture-account","saved_at":123}}`, true},
		{"not-saved", `{"success":true,"data":{"logged_in":false}}`, false},
		{"browser-open-only", `{"success":true,"data":{"port":12345}}`, false},
		{"closed", `{"success":false,"data":{"logged_in":false},"error":"登录窗口已关闭或与浏览器连接中断"}`, false},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			service := testService(t)
			if err := service.checkExecutable(); err != nil {
				t.Fatal(err)
			}
			calls := 0
			service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
				calls++
				if strings.Join(args, " ") != "login --account=fixture-account --timeout=300" {
					t.Fatal("login parameters changed", args)
				}
				return []byte(fixture.body), nil
			}
			result, err := service.Control(context.Background(), "login", "fixture-account", "", nil, nil)
			if fixture.confirmed {
				if err != nil || result["logged_in"] != true || result["account"] != "fixture-account" {
					t.Fatal("saved login not confirmed", result, err)
				}
			} else if err == nil {
				t.Fatal("unconfirmed login reported success", result)
			}
			if calls != 1 {
				t.Fatal("login attempted more than once", calls)
			}
		})
	}
}

func TestCancelledLoginIgnoresLateSuccess(t *testing.T) {
	service := testService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.runner = func(context.Context, string, []string, []string, string) ([]byte, error) {
		cancel()
		return []byte(`{"success":true,"data":{"logged_in":true}}`), nil
	}
	_, err := service.Control(ctx, "login", "fixture-account", "", nil, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled login accepted a late response", err)
	}
}
