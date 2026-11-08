package generation

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestVideoSubmissionModelRejectionIsNotUncertain(t *testing.T) {
	for _, test := range []struct {
		name     string
		body     string
		replayed bool
		rejected bool
	}{
		{name: "explicit model rejection", body: `{"error":{"code":"model_not_found","message":"No available channel for model seedance-2.5"}}`, rejected: true},
		{name: "case insensitive code", body: `{"error":{"code":"MODEL_NOT_FOUND"}}`, rejected: true},
		{name: "generic server failure", body: `{"error":{"code":"server_error"}}`},
		{name: "model name in request echo", body: `{"error":{"code":"server_error"},"prompt":"model_not_found"}`},
		{name: "existing upstream task", body: `{"error":{"code":"model_not_found"},"task_id":"task-existing"}`},
		{name: "replayed response", body: `{"error":{"code":"model_not_found"}}`, replayed: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			cause := HTTPError{StatusCode: http.StatusServiceUnavailable, Body: test.body, IdempotencyReplayed: test.replayed}
			err := UncertainVideoSubmission(context.Background(), cause)
			var unknown SubmissionUnknownError
			if errors.As(err, &unknown) == test.rejected {
				t.Fatalf("wrong submission certainty: %v", err)
			}
		})
	}
}
