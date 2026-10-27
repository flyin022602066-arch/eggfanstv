package repository

import (
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type ProjectOverviewMetrics struct {
	UnitCount                    int64 `gorm:"column:unit_count"`
	CompletedUnitCount           int64 `gorm:"column:completed_unit_count"`
	TotalWordCount               int64 `gorm:"column:total_word_count"`
	UnitsWithoutText             int64 `gorm:"column:units_without_text"`
	UnitsWithoutShots            int64 `gorm:"column:units_without_shots"`
	CanvasCount                  int64 `gorm:"column:canvas_count"`
	AssetCount                   int64 `gorm:"column:asset_count"`
	ShotCount                    int64 `gorm:"column:shot_count"`
	PendingCandidateCount        int64 `gorm:"column:pending_candidate_count"`
	ReadyStoryboardCount         int64 `gorm:"column:ready_storyboard_count"`
	ReadyPrevizCount             int64 `gorm:"column:ready_previz_count"`
	ReadyVideoCount              int64 `gorm:"column:ready_video_count"`
	TimelineRenderSucceededCount int64 `gorm:"column:timeline_render_succeeded_count"`
	StaleArtifactCount           int64 `gorm:"column:stale_artifact_count"`
}

type ProjectOverviewUnitRow struct {
	model.ProjectUnit
	ShotCount      int64 `gorm:"column:shot_count"`
	CandidateCount int64 `gorm:"column:candidate_count"`
	CanvasCount    int64 `gorm:"column:canvas_count"`
}

type ProjectAssetCountRow struct {
	Key   string `gorm:"column:key"`
	Count int64  `gorm:"column:count"`
}

func (r *Repository) ProjectUnitCanvasCounts(projectID string) (map[string]int64, error) {
	var rows []ProjectAssetCountRow
	if err := r.db.Table("canvas_unit_links").Select("unit_id AS key, COUNT(DISTINCT canvas_id) AS count").Where("project_id = ?", projectID).Group("unit_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.Key] = row.Count
	}
	return counts, nil
}

func (r *Repository) ProjectOverviewMetrics(projectID string) (ProjectOverviewMetrics, error) {
	var metrics ProjectOverviewMetrics
	err := r.db.Raw(`
		SELECT
			(SELECT COUNT(*) FROM project_units WHERE project_id = ?) AS unit_count,
			(SELECT COUNT(*) FROM project_units WHERE project_id = ? AND status = ?) AS completed_unit_count,
			(SELECT COALESCE(SUM(word_count), 0) FROM project_units WHERE project_id = ?) AS total_word_count,
			(SELECT COUNT(*) FROM project_units WHERE project_id = ? AND word_count = 0) AS units_without_text,
			(SELECT COUNT(*) FROM project_units pu WHERE pu.project_id = ? AND pu.status <> ? AND NOT EXISTS (SELECT 1 FROM shots s WHERE s.project_id = pu.project_id AND s.unit_id = pu.id)) AS units_without_shots,
			(SELECT COUNT(*) FROM canvas_projects WHERE project_id = ?) AS canvas_count,
			(SELECT COUNT(*) FROM project_asset_links WHERE project_id = ?) AS asset_count,
			(SELECT COUNT(*) FROM shots WHERE project_id = ?) AS shot_count,
			(SELECT COUNT(*) FROM project_asset_candidates WHERE project_id = ? AND status = 'pending_confirmation') AS pending_candidate_count,
			(SELECT COUNT(DISTINCT shot_id) FROM shot_artifacts WHERE project_id = ? AND type = 'storyboard' AND selected = ? AND status = 'ready') AS ready_storyboard_count,
			(SELECT COUNT(DISTINCT shot_id) FROM shot_artifacts WHERE project_id = ? AND type = 'action_board' AND selected = ? AND status = 'ready') AS ready_previz_count,
			(SELECT COUNT(DISTINCT shot_id) FROM shot_artifacts WHERE project_id = ? AND type = 'video' AND selected = ? AND status = 'ready') AS ready_video_count,
			(SELECT COUNT(*) FROM tasks WHERE project_id = ? AND type = ? AND status = ?) AS timeline_render_succeeded_count,
			(SELECT COUNT(*) FROM shot_artifacts WHERE project_id = ? AND status = 'stale') AS stale_artifact_count
`, projectID, projectID, model.ProjectUnitStatusCompleted, projectID, projectID, projectID, model.ProjectUnitStatusDraft, projectID, projectID, projectID, projectID, projectID, true, projectID, true, projectID, true, projectID, model.TaskTypeTimelineRender, model.TaskStatusSucceeded, projectID).Scan(&metrics).Error
	return metrics, err
}

func (r *Repository) ProjectOverviewUnits(projectID string, limit int) ([]ProjectOverviewUnitRow, error) {
	if limit <= 0 || limit > 20 {
		limit = 8
	}
	var rows []ProjectOverviewUnitRow
	err := r.db.Raw(`
		SELECT pu.id, pu.project_id, pu.parent_id, pu.kind, pu.title, pu.word_count, pu.status, pu.position, pu.created_at, pu.updated_at,
			(SELECT COUNT(*) FROM shots s WHERE s.project_id = pu.project_id AND s.unit_id = pu.id) AS shot_count,
			(SELECT COUNT(*) FROM project_asset_candidates pac WHERE pac.project_id = pu.project_id AND pac.unit_id = pu.id AND pac.status = 'pending_confirmation') AS candidate_count,
			(SELECT COUNT(DISTINCT cul.canvas_id) FROM canvas_unit_links cul WHERE cul.project_id = pu.project_id AND cul.unit_id = pu.id) AS canvas_count
		FROM project_units pu
		WHERE pu.project_id = ?
		ORDER BY pu.position ASC, pu.created_at ASC
		LIMIT ?
	`, projectID, limit).Scan(&rows).Error
	return rows, err
}

func (r *Repository) ProjectUnitShots(projectID string, unitID string) ([]model.Shot, error) {
	var shots []model.Shot
	err := r.db.Where("project_id = ? AND unit_id = ?", projectID, unitID).Order("position asc, created_at asc").Find(&shots).Error
	return shots, err
}

func (r *Repository) ProjectUnitShotRevisions(projectID string, unitID string) ([]model.ShotRevision, error) {
	var revisions []model.ShotRevision
	err := r.db.Table("shot_revisions").Select("shot_revisions.*").Joins("JOIN shots ON shots.id = shot_revisions.shot_id").Where("shots.project_id = ? AND shots.unit_id = ?", projectID, unitID).Order("shots.position asc, shot_revisions.version asc").Scan(&revisions).Error
	return revisions, err
}

func (r *Repository) ProjectUnitShotArtifacts(projectID string, unitID string) ([]model.ShotArtifact, error) {
	var artifacts []model.ShotArtifact
	err := r.db.Where("project_id = ? AND unit_id = ?", projectID, unitID).Order("shot_id asc, type asc, version asc").Find(&artifacts).Error
	return artifacts, err
}

func (r *Repository) ProjectUnitShotAssetReferences(projectID string, unitID string) ([]model.ShotAssetReference, error) {
	var references []model.ShotAssetReference
	err := r.db.Table("shot_asset_references").Select("shot_asset_references.*").Joins("JOIN shots ON shots.id = shot_asset_references.shot_id").Where("shots.project_id = ? AND shots.unit_id = ?", projectID, unitID).Order("shot_asset_references.created_at asc").Scan(&references).Error
	return references, err
}

func (r *Repository) ProjectAssetVersionsByIDs(projectID string, versionIDs []string) ([]model.AssetVersion, error) {
	if len(versionIDs) == 0 {
		return []model.AssetVersion{}, nil
	}
	var versions []model.AssetVersion
	err := r.db.Table("asset_versions").Select("asset_versions.*").
		Joins("JOIN project_asset_links ON project_asset_links.asset_id = asset_versions.asset_id").
		Where("project_asset_links.project_id = ? AND asset_versions.id IN ?", projectID, versionIDs).
		Find(&versions).Error
	return versions, err
}

func (r *Repository) AssetRepresentationsByVersionIDs(versionIDs []string) ([]model.AssetRepresentation, error) {
	if len(versionIDs) == 0 {
		return []model.AssetRepresentation{}, nil
	}
	var representations []model.AssetRepresentation
	err := r.db.Where("asset_version_id IN ?", versionIDs).Order("asset_version_id asc, role asc, created_at asc").Find(&representations).Error
	return representations, err
}

func (r *Repository) ProjectUnitAssetCandidates(projectID string, unitID string) ([]model.ProjectAssetCandidate, error) {
	var candidates []model.ProjectAssetCandidate
	err := r.db.Where("project_id = ? AND (unit_id = ? OR unit_id = '')", projectID, unitID).Order("created_at asc").Find(&candidates).Error
	return candidates, err
}

func (r *Repository) ProjectUnitAssets(userID string, projectID string, unitID string) ([]model.Asset, error) {
	var assets []model.Asset
	err := r.db.Table("assets").Distinct("assets.*").
		Joins("JOIN project_asset_links pal ON pal.asset_id = assets.id AND pal.project_id = ?", projectID).
		Joins("JOIN asset_versions av ON av.asset_id = assets.id").
		Joins("JOIN shot_asset_references sar ON sar.asset_version_id = av.id").
		Joins("JOIN shots s ON s.id = sar.shot_id AND s.project_id = ? AND s.unit_id = ?", projectID, unitID).
		Where("assets.user_id = ?", userID).
		Order("assets.updated_at desc").
		Scan(&assets).Error
	return assets, err
}

func (r *Repository) ProjectWorkflowInstancesForUnit(projectID string, unitID string) ([]model.WorkflowInstance, error) {
	var instances []model.WorkflowInstance
	err := r.db.Where("project_id = ? AND unit_id = ?", projectID, unitID).Order("created_at asc").Find(&instances).Error
	return instances, err
}

func (r *Repository) ProjectCanvasSummariesPage(userID string, projectID string, page int, pageSize int) ([]model.CanvasProject, int64, error) {
	var canvases []model.CanvasProject
	var total int64
	query := r.db.Model(&model.CanvasProject{}).Where("user_id = ? AND project_id = ?", userID, projectID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Select("id", "user_id", "project_id", "title", "created_at", "updated_at").Order("updated_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&canvases).Error
	return canvases, total, err
}

func (r *Repository) UserCanvasProjectsPage(userID string, page int, pageSize int, projectID string, search string, sort string) ([]model.CanvasProject, int64, error) {
	var projects []model.CanvasProject
	var total int64
	query := r.db.Model(&model.CanvasProject{}).Where("user_id = ?", userID)
	if projectID == "independent" {
		query = query.Where("project_id = '' OR project_id IS NULL")
	} else if projectID != "" && projectID != "all" {
		query = query.Where("project_id = ?", projectID)
	}
	if search = strings.TrimSpace(search); search != "" {
		query = query.Where("LOWER(title) LIKE ?", "%"+strings.ToLower(search)+"%")
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	order := "updated_at desc, id asc"
	if sort == "name" {
		order = "title asc, id asc"
	} else if sort == "nodes" {
		order = "COALESCE(json_array_length(payload_json, '$.nodes'), 0) desc, id asc"
	}
	err := query.Order(order).Offset((page - 1) * pageSize).Limit(pageSize).Find(&projects).Error
	return projects, total, err
}

func (r *Repository) ProjectCanvasUnitLinksForCanvases(projectID string, canvasIDs []string) ([]model.CanvasUnitLink, error) {
	if len(canvasIDs) == 0 {
		return []model.CanvasUnitLink{}, nil
	}
	var links []model.CanvasUnitLink
	err := r.db.Where("project_id = ? AND canvas_id IN ?", projectID, canvasIDs).Order("created_at asc").Find(&links).Error
	return links, err
}

func (r *Repository) ProjectAssetCandidatesPage(projectID string, page int, pageSize int, unitID string, status string, category string, queryText string) ([]model.ProjectAssetCandidate, int64, error) {
	var candidates []model.ProjectAssetCandidate
	var total int64
	query := r.db.Model(&model.ProjectAssetCandidate{}).Where("project_id = ?", projectID)
	if value := strings.TrimSpace(unitID); value != "" {
		unit := "COALESCE(NULLIF(unit_id, ''), (SELECT s.unit_id FROM shots s JOIN project_units u ON u.id = s.unit_id AND u.project_id = s.project_id WHERE s.id = project_asset_candidates.shot_id AND s.project_id = project_asset_candidates.project_id), '')"
		if value == "__unassigned__" {
			query = query.Where(unit + " = ''")
		} else {
			query = query.Where(unit+" = ?", value)
		}
	}
	if value := strings.TrimSpace(status); value != "" {
		query = query.Where("status = ?", value)
	}
	if value := strings.TrimSpace(category); value != "" {
		query = query.Where("category = ?", value)
	}
	if value := strings.TrimSpace(queryText); value != "" {
		query = query.Where("LOWER(name) LIKE ?", "%"+strings.ToLower(value)+"%")
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&candidates).Error
	return candidates, total, err
}

func (r *Repository) ProjectAssetsPage(userID string, projectID string, page int, pageSize int, category string, mediaType string, status string, folderID *string, queryText string, unitID string) ([]model.Asset, int64, error) {
	var assets []model.Asset
	var total int64
	query := r.db.Table("assets").Joins("JOIN project_asset_links ON project_asset_links.asset_id = assets.id").Where("assets.user_id = ? AND project_asset_links.project_id = ?", userID, projectID)
	query = r.filterProjectAssetsByUnit(query, projectID, unitID)
	if value := strings.TrimSpace(category); value != "" {
		query = query.Where("assets.category = ?", value)
	}
	if value := strings.TrimSpace(mediaType); value != "" {
		query = query.Where("assets.kind = ?", value)
	}
	if value := strings.TrimSpace(status); value != "" {
		query = query.Where("assets.status = ?", value)
	}
	if folderID != nil {
		query = query.Where("project_asset_links.folder_id = ?", strings.TrimSpace(*folderID))
	}
	if value := strings.TrimSpace(queryText); value != "" {
		query = query.Where("LOWER(assets.title) LIKE ?", "%"+strings.ToLower(value)+"%")
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Select("assets.*").Order("assets.updated_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Scan(&assets).Error
	return assets, total, err
}

func (r *Repository) ProjectAssetFacets(userID string, projectID string, unitID string) ([]ProjectAssetCountRow, []ProjectAssetCountRow, error) {
	base := func() *gorm.DB {
		query := r.db.Table("assets").Joins("JOIN project_asset_links pal ON pal.asset_id = assets.id").Where("pal.project_id = ? AND assets.user_id = ?", projectID, userID)
		return r.filterProjectAssetsByUnit(query, projectID, unitID)
	}
	var categoryRows []ProjectAssetCountRow
	if err := base().Select("assets.category AS key, COUNT(*) AS count").
		Group("assets.category").Scan(&categoryRows).Error; err != nil {
		return nil, nil, err
	}
	var folderRows []ProjectAssetCountRow
	if err := base().Select("pal.folder_id AS key, COUNT(*) AS count").
		Group("pal.folder_id").Scan(&folderRows).Error; err != nil {
		return nil, nil, err
	}
	return categoryRows, folderRows, nil
}

type ProjectAssetUnitRow struct {
	AssetID string
	UnitID  string
}

func (r *Repository) projectAssetUnitAssociations(projectID string) *gorm.DB {
	return r.db.Raw(`
		SELECT c.resolved_asset_id AS asset_id, u.id AS unit_id
		FROM project_asset_candidates c
		LEFT JOIN shots s ON s.id = c.shot_id AND s.project_id = c.project_id
		JOIN project_units u ON u.id = COALESCE(NULLIF(c.unit_id, ''), s.unit_id) AND u.project_id = c.project_id
		WHERE c.project_id = ? AND c.status = 'confirmed' AND c.resolved_asset_id <> ''
		UNION
		SELECT av.asset_id, u.id AS unit_id
		FROM shot_asset_references ref
		JOIN asset_versions av ON av.id = ref.asset_version_id
		JOIN shots s ON s.id = ref.shot_id
		JOIN project_units u ON u.id = s.unit_id AND u.project_id = s.project_id
		WHERE s.project_id = ?`, projectID, projectID)
}

func (r *Repository) filterProjectAssetsByUnit(query *gorm.DB, projectID string, unitID string) *gorm.DB {
	value := strings.TrimSpace(unitID)
	if value == "" {
		return query
	}
	if value == "__unassigned__" {
		return query.Where("NOT EXISTS (SELECT 1 FROM (?) asset_units WHERE asset_units.asset_id = assets.id)", r.projectAssetUnitAssociations(projectID))
	}
	return query.Where("EXISTS (SELECT 1 FROM (?) asset_units WHERE asset_units.asset_id = assets.id AND asset_units.unit_id = ?)", r.projectAssetUnitAssociations(projectID), value)
}

func (r *Repository) ProjectAssetUnitLinks(userID string, projectID string) ([]ProjectAssetUnitRow, error) {
	var rows []ProjectAssetUnitRow
	err := r.db.Table("assets").Select("assets.id AS asset_id, COALESCE(asset_units.unit_id, '') AS unit_id").
		Joins("JOIN project_asset_links pal ON pal.asset_id = assets.id AND pal.project_id = ?", projectID).
		Joins("LEFT JOIN (?) asset_units ON asset_units.asset_id = assets.id", r.projectAssetUnitAssociations(projectID)).
		Where("assets.user_id = ?", userID).Order("assets.id, asset_units.unit_id").Scan(&rows).Error
	return rows, err
}
