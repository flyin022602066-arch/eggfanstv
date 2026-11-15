package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
)

type DoubaoBrowserPort interface {
	Control(context.Context, string, string, any) (map[string]any, error)
}

func RegisterDoubaoBrowserRoutes(r *gin.RouterGroup, svc *app.Service) {
	group := r.Group("/doubao-browser")
	group.Use(func(c *gin.Context) {
		if svc == nil || !svc.IsLocalMode() {
			fail(c, http.StatusServiceUnavailable, errors.New("豆包浏览器仅支持本地工作区"))
			c.Abort()
			return
		}
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
			fail(c, http.StatusUnauthorized, err)
			c.Abort()
			return
		}
		user, err := currentUser(c, svc)
		if err != nil || user == nil || user.ID == "" {
			fail(c, http.StatusUnauthorized, errors.New("本地工作区身份无效"))
			c.Abort()
			return
		}
		c.Set("doubao-browser.user", user.ID)
	})
	handle := func(action string) gin.HandlerFunc {
		return func(c *gin.Context) {
			if action != "status" && !requireTrustedDesktopWritePrincipal(c, "账号环境只能由当前 eggfansTV 桌面界面管理") {
				return
			}
			var input struct {
				Enabled   *bool  `json:"enabled"`
				ProfileID string `json:"profileId"`
			}
			if action != "status" {
				c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
				if c.ShouldBindJSON(&input) != nil {
					fail(c, http.StatusBadRequest, errors.New("账号环境参数无效"))
					return
				}
			}
			if action == "configure" && input.Enabled == nil {
				fail(c, http.StatusBadRequest, errors.New("缺少启用设置"))
				return
			}
			var port DoubaoBrowserPort
			if deps, ok := runtimeDependencies(c); ok {
				port = deps.DoubaoBrowser
			}
			if port == nil {
				port = svc.DoubaoBrowserDomain()
			}
			id, _ := c.Get("doubao-browser.user")
			if action == "clear" {
				if err := svc.ReconcileDoubaoBrowserDeliveries(id.(string)); err != nil {
					fail(c, http.StatusBadRequest, errors.New("本地交付状态核对失败，未清理环境"))
					return
				}
			}
			data, err := port.Control(c.Request.Context(), id.(string), action, input)
			if err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			ok(c, data)
		}
	}
	group.GET("/status", handle("status"))
	group.PUT("/settings", handle("configure"))
	group.POST("/clear", handle("clear"))
	group.POST("/open", handle("open"))
}
