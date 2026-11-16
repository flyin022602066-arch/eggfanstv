package project

import (
	"fmt"
	"reflect"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func TestCharacterReferenceCatalogUsesBoundedQueries(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	seedReadyCharacterReference(t, db, project.UserID, asset.PrimaryVersionID)
	for index := 0; index < 100; index++ {
		version := model.AssetVersion{ID: fmt.Sprintf("catalog-version-%d", index), AssetID: asset.ID, Version: index + 2, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"clothing":"白衣"}`}
		if err := db.Create(&version).Error; err != nil {
			t.Fatal(err)
		}
	}
	queries := 0
	if err := db.Callback().Query().After("gorm:query").Register("test:catalog-query-count", func(*gorm.DB) { queries++ }); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Row().After("gorm:row").Register("test:catalog-row-count", func(*gorm.DB) { queries++ }); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Callback().Query().Remove("test:catalog-query-count") })
	t.Cleanup(func() { db.Callback().Row().Remove("test:catalog-row-count") })
	catalog, err := service.CharacterReferenceCatalog(project.UserID, project.ID)
	if err != nil || len(catalog.Versions) != 101 {
		t.Fatalf("catalog size=%d err=%v", len(catalog.Versions), err)
	}
	if queries > 8 {
		t.Fatalf("catalog used %d queries for 101 versions; expected batched reads", queries)
	}
	t.Logf("101 versions loaded in %d database reads", queries)
}

func TestCharacterReferenceCatalogBulkReadPreservesCardsAndOwnership(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	seedReadyCharacterReference(t, db, project.UserID, asset.PrimaryVersionID)
	profile := model.VoiceProfile{ID: "catalog-voice", UserID: project.UserID, Status: "active", CompatibleModelsJSON: `["video"]`}
	binding := model.CharacterVoiceBinding{ID: "catalog-binding", AssetVersionID: asset.PrimaryVersionID, VoiceProfileID: profile.ID, Instructions: "温柔"}
	archived := model.AssetVersion{ID: "catalog-archived", AssetID: asset.ID, Version: 2, Status: model.AssetVersionStatusArchived, DefinitionJSON: `{}`}
	foreignAsset := model.Asset{ID: "catalog-foreign", UserID: "foreign", Category: model.AssetCategoryCharacter}
	foreignVersion := model.AssetVersion{ID: "catalog-foreign-version", AssetID: foreignAsset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{}`}
	foreignLink := model.ProjectAssetLink{ID: "catalog-foreign-link", ProjectID: project.ID, AssetID: foreignAsset.ID}
	for _, row := range []any{&profile, &binding, &archived, &foreignAsset, &foreignVersion, &foreignLink} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, status := range []string{"active", "inactive", "foreign"} {
		owner := project.UserID
		if status == "foreign" {
			owner = "foreign"
		}
		if err := db.Model(&profile).Updates(map[string]any{"user_id": owner, "status": status}).Error; err != nil {
			t.Fatal(err)
		}
		catalog, err := service.CharacterReferenceCatalog(project.UserID, project.ID)
		if err != nil || len(catalog.Versions) != 1 {
			t.Fatalf("catalog=%+v err=%v", catalog, err)
		}
		version, err := service.repo.AssetVersion(asset.PrimaryVersionID)
		if err != nil {
			t.Fatal(err)
		}
		expected, err := service.characterVersionCard(project.UserID, *version)
		if err != nil || !reflect.DeepEqual(expected, catalog.Versions[0].CharacterCardSummary) {
			t.Fatalf("bulk card changed status=%s: actual=%+v expected=%+v err=%v", status, catalog.Versions[0], expected, err)
		}
	}
}

func TestCharacterAssetFilterSkipsUnrelatedAssetSummaries(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	seedReadyCharacterReference(t, db, project.UserID, asset.PrimaryVersionID)
	for index := 0; index < 100; index++ {
		prop := model.Asset{ID: fmt.Sprintf("loading-prop-%d", index), UserID: project.UserID, Category: model.AssetCategoryProp, Kind: "image", Title: "道具"}
		link := model.ProjectAssetLink{ID: fmt.Sprintf("loading-link-%d", index), ProjectID: project.ID, AssetID: prop.ID}
		if err := db.Create(&prop).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&link).Error; err != nil {
			t.Fatal(err)
		}
	}
	queries := 0
	if err := db.Callback().Query().After("gorm:query").Register("test:character-assets-query-count", func(*gorm.DB) { queries++ }); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Row().After("gorm:row").Register("test:character-assets-row-count", func(*gorm.DB) { queries++ }); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Callback().Query().Remove("test:character-assets-query-count") })
	t.Cleanup(func() { db.Callback().Row().Remove("test:character-assets-row-count") })
	assets, err := service.FilterProjectAssets(project.UserID, project.ID, ProjectAssetFilter{Category: "character"})
	if err != nil || len(assets) != 1 || assets[0].ID != asset.ID || assets[0].Character == nil {
		t.Fatalf("assets=%+v err=%v", assets, err)
	}
	if queries > 12 {
		t.Fatalf("character filter used %d queries; unrelated props must not be summarized", queries)
	}
	t.Logf("character list loaded in %d database reads with 100 unrelated props", queries)
}

func TestProjectAssetFilterPreservesSummaryAndOwnership(t *testing.T) {
	service, db := newTestService(t, nil)
	project, character := seedProjectCharacterRepresentation(t, db)
	seedReadyCharacterReference(t, db, project.UserID, character.PrimaryVersionID)
	prop := model.Asset{ID: "filter-prop", UserID: project.UserID, Category: model.AssetCategoryProp, Kind: "image", Status: model.AssetVersionStatusDraft, Title: "药碗"}
	foreign := model.Asset{ID: "filter-foreign", UserID: "foreign", Category: model.AssetCategoryCharacter, Kind: "entity", Status: model.AssetVersionStatusConfirmed}
	for _, row := range []any{&prop, &foreign, &model.ProjectAssetLink{ID: "filter-prop-link", ProjectID: project.ID, AssetID: prop.ID}, &model.ProjectAssetLink{ID: "filter-foreign-link", ProjectID: project.ID, AssetID: foreign.ID}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	all, err := service.ProjectAssets(project.UserID, project.ID)
	if err != nil || len(all) != 2 {
		t.Fatalf("unfiltered assets=%+v err=%v", all, err)
	}
	var characterSummary AssetSummary
	for _, summary := range all {
		if summary.ID == character.ID {
			characterSummary = summary
		}
	}
	if len(characterSummary.Usages) == 0 {
		t.Fatal("fixture must include a representation usage")
	}
	filters := []ProjectAssetFilter{
		{},
		{Category: "character"},
		{MediaType: "image"},
		{Status: "draft"},
		{Usage: characterSummary.Usages[0]},
		{Category: "character", MediaType: "entity", Status: "confirmed", Usage: characterSummary.Usages[0]},
		{Category: "character", MediaType: "image"},
		{Category: "' OR 1=1 --"},
	}
	for _, filter := range filters {
		expected := make([]AssetSummary, 0)
		for _, summary := range all {
			if filter.Category != "" && string(summary.Category) != filter.Category || filter.MediaType != "" && summary.MediaType != filter.MediaType || filter.Status != "" && string(summary.Status) != filter.Status || filter.Usage != "" && !containsString(summary.Usages, filter.Usage) {
				continue
			}
			expected = append(expected, summary)
		}
		actual, err := service.FilterProjectAssets(project.UserID, project.ID, filter)
		if err != nil || !reflect.DeepEqual(actual, expected) {
			t.Fatalf("filter=%+v actual=%+v expected=%+v err=%v", filter, actual, expected, err)
		}
	}
	if _, err := service.FilterProjectAssets("foreign", project.ID, ProjectAssetFilter{Category: "character"}); err == nil {
		t.Fatal("foreign project assets accepted")
	}
}
