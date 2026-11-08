package database

import (
	"fmt"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

var characterLookColumns = []struct{ table, column, sqlType string }{
	{"asset_versions", "reference_profile_json", "TEXT"},
	{"shot_asset_references", "selection_status", "TEXT"},
	{"shot_asset_references", "selection_source", "TEXT"},
	{"shot_asset_references", "selection_locked", "NUMERIC DEFAULT 0"},
	{"shot_asset_references", "selection_reason", "TEXT"},
	{"shot_asset_references", "selection_revision_id", "TEXT"},
}

func migrateCharacterLookReferences(tx *gorm.DB) error {
	// 早期仅画布工作区没有项目版本表；只创建缺表，已有表只追加列。
	for _, table := range []any{&model.AssetVersion{}, &model.ShotAssetReference{}} {
		if !tx.Migrator().HasTable(table) {
			if err := tx.Migrator().CreateTable(table); err != nil {
				return err
			}
		}
	}
	for _, field := range characterLookColumns {
		if err := ensureSQLiteColumn(tx, field.table, field.column, field.sqlType); err != nil {
			return err
		}
	}
	return requireCharacterLookReferences(tx)
}

func requireCharacterLookReferences(db *gorm.DB) error {
	for _, field := range characterLookColumns {
		has, err := sqliteHasColumn(db, field.table, field.column)
		if err != nil {
			return err
		}
		if !has {
			return fmt.Errorf("角色造型结构缺失 %s.%s，请启用自动迁移", field.table, field.column)
		}
	}
	return nil
}
