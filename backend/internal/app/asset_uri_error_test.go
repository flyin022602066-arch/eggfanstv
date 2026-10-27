package app

import (
	"testing"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
)

func TestAssetURIRejectionPersistsThroughTaskOutput(t *testing.T) {
	service, database := newTimelineTaskTestService(t)
	task := seedRunningTimelineTask(t, database, `{}`)
	upstreamError := providerHTTPError{
		StatusCode: 400,
		Body:       `{"code":"client_parameter","data":null,"message":"content[1] 暂不支持 asset:// 素材引用，请传公网可访问的图片 URL"}`,
	}
	_ = service.terminalCoordinator().handleExecutionFailure(task, upstreamError, false, false)
	var stored model.Task
	if err := database.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	expected := "当前视频接口不支持 asset:// 图片 URI。请联系 Eggfans 网关维护者开通私域资产引用，或配置支持该 URI 的视频接口后再生成。"
	if stored.Status != model.TaskStatusFailed || stored.Error != expected {
		t.Fatalf("stored failure = %s: %q", stored.Status, stored.Error)
	}
	output := taskSummaryForOutput(stored)
	if output.Error != expected || output.ErrorCode != "invalid_params" {
		t.Fatalf("task output lost URI rejection: %#v", output)
	}
	failure := generation.ClassifyText(output.Error)
	if failure.UserMessage() != expected || !failure.BlocksAutomaticRetry() || !persistedFailureBlocksRetry(stored.Error, stored.Stage) {
		t.Fatalf("unsafe reloaded URI rejection: %+v", failure)
	}
}
