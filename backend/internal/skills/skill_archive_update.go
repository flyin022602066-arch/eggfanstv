package skills

import "infinite-canvas/backend/internal/kernel"

// UpdateOwnedSkillArchive appends a reviewed local ZIP without changing the
// selected skill ID or removing versions pinned by historical tasks.
func (s *Service) UpdateOwnedSkillArchive(userID, id string, data []byte) (*SkillItem, error) {
	skill, err := s.ownedSkill(userID, id)
	if err != nil {
		return nil, err
	}
	if skill.SourceType != "zip" || len(data) == 0 || len(data) > maxSkillPackageBytes {
		return nil, kernel.BadAuthRequest("仅支持更新已有本地 ZIP 技能，文件须在 1B-20MB 内")
	}
	archive, err := archiveFromZip(data, "")
	if err != nil {
		return nil, err
	}
	previous := parseSkillPackageMetadata([]byte(skill.Instruction))
	if previous.Name == "" || archive.Metadata.Name != previous.Name {
		return nil, kernel.BadAuthRequest("更新包必须与原技能名称标识一致")
	}
	if skill.ContentHash == archive.ContentHash {
		return s.SkillDetail(userID, id)
	}
	skill.Instruction = string(archive.Files["SKILL.md"])
	skill.Description = archive.Metadata.Description
	if err := s.addSkillArchiveVersion(skill, archive, "zip", skill.SourceURL, skill.SourceRef, skill.SourceSubdir, skill.SourceCommit, skill.AutoUpdate); err != nil {
		return nil, err
	}
	return s.SkillDetail(userID, id)
}
