package database

import (
	"fmt"

	"gorm.io/gorm"
)

var resourceSourceIndex = sqliteIndexContract{
	table: "resources", name: "idx_resources_source_resource_id", columns: []string{"source_resource_id"},
}

func migrateResourceSourceReference(tx *gorm.DB) error {
	if err := ensureSQLiteColumn(tx, "resources", "source_resource_id", "TEXT"); err != nil {
		return err
	}
	if err := tx.Exec("CREATE INDEX IF NOT EXISTS idx_resources_source_resource_id ON resources(source_resource_id)").Error; err != nil {
		return fmt.Errorf("添加本地资源来源索引: %w", err)
	}
	return requireResourceSourceReference(tx)
}

func requireResourceSourceReference(db *gorm.DB) error {
	has, err := sqliteHasColumn(db, "resources", "source_resource_id")
	if err != nil {
		return err
	}
	if !has {
		return fmt.Errorf("本地资源结构缺失 resources.source_resource_id，请启用自动迁移")
	}
	valid, err := matchesSQLiteIndex(db, resourceSourceIndex)
	if err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("本地资源来源索引 %s 定义不完整", resourceSourceIndex.name)
	}
	return nil
}
