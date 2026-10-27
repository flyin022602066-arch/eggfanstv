package model

import "time"

type EggfansAssetBinding struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	UserID       string    `json:"-" gorm:"index;uniqueIndex:idx_eggfans_asset_source,priority:1;size:36"`
	AccountScope string    `json:"-" gorm:"uniqueIndex:idx_eggfans_asset_source,priority:2;size:64"`
	SourceKey    string    `json:"-" gorm:"uniqueIndex:idx_eggfans_asset_source,priority:3;size:64"`
	ResourceID   string    `json:"resourceId,omitempty" gorm:"index;size:36"`
	BaseURL      string    `json:"baseUrl"`
	AssetType    string    `json:"assetType" gorm:"size:16"`
	AssetGroupID string    `json:"groupId" gorm:"index;size:120"`
	AssetID      string    `json:"assetId" gorm:"index;size:120"`
	URI          string    `json:"uri"`
	Status       string    `json:"status" gorm:"index;size:24"`
	Error        string    `json:"error"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
