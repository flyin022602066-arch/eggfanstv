package handler

import (
	"net/http"
	"time"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/asset"

	"github.com/gin-gonic/gin"
)

func registerSunoMediaRoute(routes *gin.RouterGroup, service *app.Service) {
	routes.POST("/resources/suno-media", func(c *gin.Context) {
		user, err := currentUser(c, service)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, service)
		if !available || !enforceRateLimit(c, "resources-upload:"+user.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var input asset.SunoMediaRequest
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, app.BadAuthRequest("歌曲取回请求格式错误"))
			return
		}
		input.Identity = c.GetHeader("X-Idempotency-Key")
		resource, err := requestAssetPort(c, service).RetrieveSunoMedia(c.Request.Context(), user.ID, input, policy.Resource.GeneratedFileMB<<20)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": resource})
	})
}
