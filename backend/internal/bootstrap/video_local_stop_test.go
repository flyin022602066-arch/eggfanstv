package bootstrap

import (
	"net/http"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestDesktopVideoLocalStopRequiresTrustedUIAndPreservesOtherTasks(t *testing.T) {
	harness := newDesktopHarness(t)
	owner, err := harness.rt.service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "local-stop-video", UserID: owner.ID, Type: "canvas_video", Status: model.TaskStatusRunning, ProviderRequestID: "upstream-retained"}
	other := model.Task{ID: "other-video", UserID: owner.ID, Type: "canvas_video", Status: model.TaskStatusRunning}
	for _, record := range []*model.Task{&task, &other} {
		if err := harness.rt.db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	rejected := harness.call(requestOptions{method: http.MethodPost, path: "/tasks/" + task.ID + "/stop-local", origin: "wails://wails", launchToken: harness.rt.LaunchToken()})
	if rejected.Code != http.StatusForbidden {
		t.Fatalf("non-UI stop = %d", rejected.Code)
	}
	for attempt := 0; attempt < 2; attempt++ {
		response := harness.desktopUI(http.MethodPost, "/tasks/"+task.ID+"/stop-local", "")
		if response.Code != http.StatusOK {
			t.Fatalf("local stop = %d: %s", response.Code, response.Body.String())
		}
		data, _ := decodeEnvelope(t, response)
		if data["status"] != "cancelled" || data["stage"] != "本地已停止" || data["providerRequestId"] != task.ProviderRequestID {
			t.Fatalf("local stop receipt = %v", data)
		}
	}
	response := harness.desktopUI(http.MethodGet, "/tasks/"+other.ID, "")
	data, _ := decodeEnvelope(t, response)
	if response.Code != http.StatusOK || data["status"] != "running" {
		t.Fatal("other task changed")
	}
}
