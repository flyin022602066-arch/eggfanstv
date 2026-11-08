package app

import (
	"infinite-canvas/backend/internal/model"
	localproject "infinite-canvas/backend/internal/project"
	"time"
)

func (s *Service) DeleteCharacterLookVersion(userID, projectID, assetID, versionID string, expectedUpdatedAt time.Time) error {
	return s.projectDomain().DeleteCharacterLookVersion(userID, projectID, assetID, versionID, expectedUpdatedAt)
}

func (s *Service) CharacterReferenceCatalog(userID, projectID string) (localproject.CharacterReferenceCatalog, error) {
	return s.projectDomain().CharacterReferenceCatalog(userID, projectID)
}

func (s *Service) SaveCharacterReferenceProfile(userID, projectID, assetID, versionID string, req localproject.SaveCharacterReferenceProfileRequest) error {
	return s.projectDomain().SaveCharacterReferenceProfile(userID, projectID, assetID, versionID, req)
}

func (s *Service) CreateCharacterLook(userID, projectID, assetID string, req localproject.CreateCharacterLookRequest) (model.AssetVersion, error) {
	return s.projectDomain().CreateCharacterLook(userID, projectID, assetID, req)
}

func (s *Service) ExtractCharacterLooks(userID, projectID, assetID string, req localproject.ExtractCharacterLooksRequest) ([]model.AssetVersion, error) {
	return s.projectDomain().ExtractCharacterLooks(userID, projectID, assetID, req)
}

func (s *Service) SaveCharacterReferenceChoices(userID, projectID, unitID string, req localproject.SaveCharacterReferenceChoicesRequest) error {
	return s.projectDomain().SaveCharacterReferenceChoices(userID, projectID, unitID, req)
}
