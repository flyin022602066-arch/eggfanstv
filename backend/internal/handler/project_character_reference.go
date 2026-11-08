package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
	localproject "infinite-canvas/backend/internal/project"
	"net/http"
	"time"
)

func RegisterCharacterReferenceRoutes(r *gin.RouterGroup, svc *app.Service) {
	r.DELETE("/projects/:id/characters/:assetId/versions/:versionId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		expected, err := time.Parse(time.RFC3339Nano, c.Query("expectedUpdatedAt"))
		if err != nil || expected.IsZero() {
			fail(c, http.StatusBadRequest, app.BadAuthRequest("缺少有效的 expectedUpdatedAt，请刷新后再删除造型"))
			return
		}
		if err := svc.DeleteCharacterLookVersion(user.ID, c.Param("id"), c.Param("assetId"), c.Param("versionId"), expected); err != nil {
			failCharacterReference(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})
	r.POST("/projects/:id/characters/:assetId/looks/extract", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req localproject.ExtractCharacterLooksRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		versions, err := svc.ExtractCharacterLooks(user.ID, c.Param("id"), c.Param("assetId"), req)
		if err != nil {
			failCharacterReference(c, err)
			return
		}
		ok(c, gin.H{"versions": versions})
	})
	r.GET("/projects/:id/character-versions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		catalog, err := svc.CharacterReferenceCatalog(user.ID, c.Param("id"))
		if err != nil {
			failCharacterReference(c, err)
			return
		}
		ok(c, catalog)
	})
	r.PATCH("/projects/:id/characters/:assetId/versions/:versionId/reference-profile", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req localproject.SaveCharacterReferenceProfileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.SaveCharacterReferenceProfile(user.ID, c.Param("id"), c.Param("assetId"), c.Param("versionId"), req); err != nil {
			failCharacterReference(c, err)
			return
		}
		ok(c, gin.H{"saved": true})
	})
	r.POST("/projects/:id/characters/:assetId/looks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req localproject.CreateCharacterLookRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		version, err := svc.CreateCharacterLook(user.ID, c.Param("id"), c.Param("assetId"), req)
		if err != nil {
			failCharacterReference(c, err)
			return
		}
		ok(c, gin.H{"version": version})
	})
	r.PUT("/projects/:id/units/:unitId/character-references", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req localproject.SaveCharacterReferenceChoicesRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.SaveCharacterReferenceChoices(user.ID, c.Param("id"), c.Param("unitId"), req); err != nil {
			failCharacterReference(c, err)
			return
		}
		ok(c, gin.H{"saved": true})
	})
}

func failCharacterReference(c *gin.Context, err error) {
	if app.IsProjectNotFound(err) {
		fail(c, http.StatusNotFound, err)
		return
	}
	failService(c, err)
}
