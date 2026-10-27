package handler

import (
	"context"
	"net/http"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/model"

	"github.com/gin-gonic/gin"
)

type eggfansPrivateAssetPort interface {
	EggfansPrivateAvatar(context.Context, string, app.EggfansAvatarRequest) (map[string]any, error)
	SyncResourceToEggfansPrivateAsset(context.Context, string, string, app.EggfansAvatarRequest) (*model.EggfansAssetBinding, error)
	ResourceEggfansPrivateAssets(string, string) ([]model.EggfansAssetBinding, error)
	QueryEggfansVideoTasks(context.Context, string, app.EggfansVideoTaskQuery) (map[string]any, error)
	ListVolcLibraryAssets(string) ([]app.VolcLibraryAsset, error)
	SyncResourceToVolcLibrary(context.Context, string, string, string) (*model.EggfansAssetBinding, error)
}

func registerEggfansPrivateAssetRoutes(r *gin.RouterGroup, svc *app.Service) {
	var assets eggfansPrivateAssetPort = svc
	r.GET("/volc-asset-library", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		records, err := assets.ListVolcLibraryAssets(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, records)
	})
	r.POST("/resources/:id/volc-asset", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		var request struct {
			Name string `json:"name"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		binding, err := assets.SyncResourceToVolcLibrary(c.Request.Context(), user.ID, c.Param("id"), request.Name)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, binding)
	})
	r.POST("/eggfans/video-tasks/query", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var request app.EggfansVideoTaskQuery
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := assets.QueryEggfansVideoTasks(c.Request.Context(), user.ID, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/eggfans/private-avatar", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var request app.EggfansAvatarRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := assets.EggfansPrivateAvatar(c.Request.Context(), user.ID, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/resources/:id/eggfans-private-asset", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var request app.EggfansAvatarRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		binding, err := assets.SyncResourceToEggfansPrivateAsset(c.Request.Context(), user.ID, c.Param("id"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, binding)
	})
	r.GET("/resources/:id/eggfans-private-assets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		bindings, err := assets.ResourceEggfansPrivateAssets(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, bindings)
	})
}
