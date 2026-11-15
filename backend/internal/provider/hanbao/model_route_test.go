package hanbao

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
)

func TestHanbaoFastAndMiniKeepDistinctNativeSubmissionModels(t *testing.T) {
	for _, scenario := range []struct {
		name, input, expected string
	}{
		{"fast-display", "Seedance 2.0 Fast", "seedance_v2.0"},
		{"fast-native", "seedance_v2.0", "seedance_v2.0"},
		{"mini-display", "Seedance 2.0 Mini", "seedance_v2.0_mini"},
		{"mini-native", "seedance_v2.0_mini", "seedance_v2.0_mini"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			service := testService(t)
			request := VideoRequest{Prompt: "fixture-dialogue", Model: scenario.input, Duration: 11, Ratio: "16:9"}
			for index := 0; index < 8; index++ {
				request.Images = append(request.Images, []byte{byte(index), 1, 2, 3})
			}
			submissions := 0
			service.runner = func(_ context.Context, _ string, args, _ []string, _ string) ([]byte, error) {
				if args[0] == "accounts" {
					return []byte(`{"success":true,"data":{"accounts":[{"id":"ready","logged_in":true}]}}`), nil
				}
				submissions++
				if args[0] != "image2video" {
					t.Fatalf("unexpected command: %v", args)
				}
				actual := map[string]string{}
				images := 0
				for _, argument := range args[1:] {
					name, value, found := strings.Cut(argument, "=")
					if !found {
						t.Fatalf("unexpected argument: %q", argument)
					}
					if name == "--image" {
						original, err := os.ReadFile(value)
						if err != nil || images >= len(request.Images) || !bytes.Equal(original, request.Images[images]) {
							t.Fatalf("reference changed: index=%d error=%v", images, err)
						}
						images++
						continue
					}
					actual[name] = value
				}
				for name, expected := range map[string]string{"--account": "ready", "--model": scenario.expected, "--prompt": request.Prompt, "--duration": "11", "--ratio": "16:9", "--poll": "0"} {
					if actual[name] != expected {
						t.Fatalf("%s = %q, expected %q", name, actual[name], expected)
					}
				}
				if images != 8 || len(actual) != 6 {
					t.Fatalf("unexpected submission shape: images=%d params=%v", images, actual)
				}
				return []byte(`{"success":true,"data":{"submit_id":"cv:fixture","account":"ready"}}`), nil
			}
			if _, err := service.Submit(context.Background(), request); err != nil || submissions != 1 {
				t.Fatalf("submission failed or retried: count=%d error=%v", submissions, err)
			}
		})
	}
}
