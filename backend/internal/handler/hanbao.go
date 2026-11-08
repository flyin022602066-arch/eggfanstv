package handler

import (
	"context"
	"errors"
	"net/http"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/provider/hanbao"

	"github.com/gin-gonic/gin"
)

type HanbaoPort interface {
	Status() (hanbao.Status, error)
	Save(hanbao.Settings) error
	Control(context.Context, string, string, string, *int, *int) (map[string]any, error)
	SMS(context.Context, string, hanbao.SMSRequest) (any, error)
}

func RegisterHanbaoRoutes(r *gin.RouterGroup, svc *app.Service) {
	group := r.Group("/hanbao")
	group.Use(func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
			fail(c, http.StatusUnauthorized, err)
			c.Abort()
			return
		}
		if dep, exists := runtimeDependencies(c); exists && dep.Hanbao != nil {
			c.Set("hanbao.port", dep.Hanbao)
		} else if svc != nil && svc.HanbaoDomain() != nil {
			c.Set("hanbao.port", svc.HanbaoDomain())
		} else {
			fail(c, http.StatusServiceUnavailable, errors.New("憨包仅支持本地工作区"))
			c.Abort()
		}
	})
	port := func(c *gin.Context) HanbaoPort { value, _ := c.Get("hanbao.port"); return value.(HanbaoPort) }
	respond := func(c *gin.Context, data any, err error) {
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, hanbao.ErrBusy) { status = http.StatusConflict }
			fail(c, status, err)
			return
		}
		ok(c, data)
	}
	group.GET("/status", func(c *gin.Context) { data, err := port(c).Status(); respond(c, data, err) })
	group.PUT("/settings", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var input hanbao.Settings
		if c.ShouldBindJSON(&input) != nil { fail(c, http.StatusBadRequest, errors.New("憨包设置格式无效")); return }
		respond(c, gin.H{"saved": true}, port(c).Save(input))
	})
	group.POST("/accounts/:action", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var input struct {
			Account string `json:"account"`
			Plan string `json:"plan"`
			DailyLimit *int `json:"dailyLimit"`
			DailySeconds *int `json:"dailySeconds"`
		}
		if c.ShouldBindJSON(&input) != nil { fail(c, http.StatusBadRequest, errors.New("账号参数格式无效")); return }
		data, err := port(c).Control(c.Request.Context(), c.Param("action"), input.Account, input.Plan, input.DailyLimit, input.DailySeconds)
		respond(c, data, err)
	})
	group.POST("/sms/:action", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var input hanbao.SMSRequest
		if c.ShouldBindJSON(&input) != nil { fail(c, http.StatusBadRequest, errors.New("接码参数格式无效")); return }
		data, err := port(c).SMS(c.Request.Context(), c.Param("action"), input)
		respond(c, data, err)
	})
}
