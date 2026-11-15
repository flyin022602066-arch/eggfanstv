package outbound

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestBackupImageHostLiveRoundTrip(t *testing.T) {
	if os.Getenv("BEEFTV_TEST_BACKUP_IMAGE_UPLOAD") != "1" {
		t.Skip("synthetic public upload requires explicit opt-in")
	}
	for _, host := range []*BackupImageHost{NewPoneImageHost(nil), NewLeopardImageHost(nil)} {
		t.Run(host.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			original := uguuTestPNG(t)
			result, err := host.Upload(ctx, "synthetic-connectivity-test", original)
			if err != nil {
				t.Fatal(err)
			}
			request, err := http.NewRequestWithContext(ctx, http.MethodGet, result.URL, nil)
			if err != nil {
				t.Fatal(err)
			}
			response, err := host.client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			actual, err := io.ReadAll(io.LimitReader(response.Body, int64(len(original)+1)))
			if err != nil || response.StatusCode != http.StatusOK || !bytes.Equal(actual, original) {
				t.Fatalf("original round trip failed: HTTP=%d type=%s matching=%v err=%v", response.StatusCode, response.Header.Get("Content-Type"), bytes.Equal(actual, original), err)
			}
			if ready, err := host.URLAvailable(ctx, result.URL); err != nil || !ready {
				t.Fatalf("link cannot be reused: %v %v", ready, err)
			}
		})
	}
}
