package repository

import (
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

type CharacterReferenceVersionRow struct {
	model.AssetVersion
	AssetTitle string
}

type CharacterReferenceData struct {
	Versions        []CharacterReferenceVersionRow
	Representations []model.AssetRepresentation
	VoiceBindings   []model.CharacterVoiceBinding
	VoiceProfiles   []model.VoiceProfile
}

func (r *Repository) ProjectCharacterReferenceData(userID, projectID string) (CharacterReferenceData, error) {
	result := CharacterReferenceData{}
	versions := func() *gorm.DB {
		return r.db.Table("asset_versions av").
			Joins("JOIN assets a ON a.id = av.asset_id").
			Joins("JOIN project_asset_links pal ON pal.asset_id = a.id").
			Where("pal.project_id = ? AND a.user_id = ? AND a.category = ? AND av.status <> ?", projectID, userID, model.AssetCategoryCharacter, model.AssetVersionStatusArchived)
	}
	if err := versions().Select("av.*, a.title AS asset_title").Order("a.updated_at desc, a.id asc, av.version desc").Scan(&result.Versions).Error; err != nil {
		return result, err
	}
	if len(result.Versions) == 0 {
		return result, nil
	}
	if err := r.db.Where("asset_version_id IN (?)", versions().Select("av.id")).Order("role asc, created_at asc").Find(&result.Representations).Error; err != nil {
		return result, err
	}
	if err := r.db.Where("asset_version_id IN (?)", versions().Select("av.id")).Find(&result.VoiceBindings).Error; err != nil {
		return result, err
	}
	if len(result.VoiceBindings) > 0 {
		bindings := r.db.Model(&model.CharacterVoiceBinding{}).Select("voice_profile_id").Where("asset_version_id IN (?)", versions().Select("av.id"))
		if err := r.db.Where("user_id = ? AND id IN (?)", userID, bindings).Find(&result.VoiceProfiles).Error; err != nil {
			return result, err
		}
	}
	return result, nil
}
