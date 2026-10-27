package database

import (
	"fmt"

	"gorm.io/gorm"
)

func migrateCharacterFacePresets(tx *gorm.DB) error {
	if err := ensureSQLiteColumn(tx, "projects", "character_face_presets_json", "TEXT"); err != nil {
		return err
	}
	return requireCharacterFacePresets(tx)
}

func requireCharacterFacePresets(db *gorm.DB) error {
	has, err := sqliteHasColumn(db, "projects", "character_face_presets_json")
	if err != nil {
		return err
	}
	if !has {
		return fmt.Errorf("项目主角人脸预设结构缺失，请启用自动迁移")
	}
	return nil
}
