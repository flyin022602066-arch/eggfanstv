package repository

import "infinite-canvas/backend/internal/model"

func (r *Repository) ProjectUnitGenerationTasks(userID, projectID, unitID string) ([]model.Task, error) {
	shotIDs := r.db.Model(&model.Shot{}).Select("id").Where("project_id = ?", projectID)
	if unitID != "" {
		shotIDs = shotIDs.Where("unit_id = ?", unitID)
	}
	ranked := r.db.Model(&model.Task{}).
		Select(`id, ROW_NUMBER() OVER (PARTITION BY json_extract(input_json, '$.metadata.shotId'), json_extract(input_json, '$.metadata.artifactType') ORDER BY created_at DESC, updated_at DESC, id DESC) AS attempt_rank`).
		Where("user_id = ? AND project_id = ? AND json_valid(input_json)", userID, projectID).
		Where("json_extract(input_json, '$.metadata.shotId') IN (?)", shotIDs)
	latest := r.db.Table("(?) AS ranked_tasks", ranked).Select("id").Where("attempt_rank = 1")
	artifactTasks := r.db.Model(&model.ShotArtifact{}).Select("task_id").Where("project_id = ? AND task_id <> ''", projectID)
	if unitID != "" {
		artifactTasks = artifactTasks.Where("unit_id = ?", unitID)
	}
	tasks := make([]model.Task, 0)
	query := r.db.Where("user_id = ? AND project_id = ?", userID, projectID)
	if unitID == "" {
		query = query.Where("id IN (?) OR id IN (?)", latest, artifactTasks)
	} else {
		query = query.Where(`id IN (?) OR id IN (?) OR (json_extract(CASE WHEN json_valid(input_json) THEN input_json ELSE '{}' END, '$.metadata.chapterId') = ? AND COALESCE(json_extract(CASE WHEN json_valid(input_json) THEN input_json ELSE '{}' END, '$.metadata.shotId'), '') = '')`, latest, artifactTasks, unitID)
	}
	err := query.Order("created_at DESC, updated_at DESC, id DESC").Find(&tasks).Error
	return tasks, err
}
