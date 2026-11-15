package asset

import (
	"mime/multipart"
	"strings"

	"infinite-canvas/backend/internal/model"
)

func (s *Service) UploadLocalResource(userID string, header *multipart.FileHeader, kind string, width, height int, durationMs int64, identity ...string) (*model.Resource, error) {
	sourceResourceID := ""
	if len(identity) > 1 {
		sourceResourceID = strings.TrimSpace(identity[1])
		identity = identity[:1]
	}
	resource, err := s.UploadLocal(userID, header, kind, width, height, durationMs, identity...)
	if err != nil {
		return nil, err
	}
	if resource == nil {
		return nil, ResourceMissing()
	}
	if err := s.validateListedResource(resource); err != nil {
		return nil, err
	}
	if err := s.attachSourceResource(userID, resource, sourceResourceID); err != nil {
		return nil, err
	}
	return resource, nil
}

func (s *Service) attachSourceResource(userID string, resource *model.Resource, sourceResourceID string) error {
	sourceResourceID = strings.TrimSpace(sourceResourceID)
	if sourceResourceID == "" || resource == nil {
		return nil
	}
	source, err := s.repo.ResourceForUser(userID, sourceResourceID)
	if err != nil {
		return err
	}
	if source.Status != model.ResourceStatusReady || source.Kind != "image" {
		return ResourceMissing()
	}
	if resource.SourceResourceID != "" && resource.SourceResourceID != sourceResourceID {
		return UploadConflict()
	}
	if resource.SourceResourceID == "" {
		resource.SourceResourceID = sourceResourceID
		return s.repo.SaveResource(resource)
	}
	return nil
}
