package skills

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"infinite-canvas/backend/internal/repository"
)

type bundledSkillPackage struct {
	Category    string
	Directory   string
	DisplayName string
	Reference   string
}

var bundledSkillPackages = []bundledSkillPackage{
	{Category: "novel-adaptation", Directory: "advanced-novel-screenplay", DisplayName: "高级小说拆解与短剧编剧", Reference: "references/novel-screenplay-spec.md"},
	{Category: "short-drama-editing", Directory: "short-drama-multicam-microshots", DisplayName: "高级短剧分镜·30秒段内多机位快切", Reference: "references/microshot-direction.md"},
	{Category: "short-drama-editing", Directory: "chixie-rusong-v1", DisplayName: "持械入宋第一版", Reference: "references/director-optics-dialogue.md"},
	{Category: "short-drama-editing", Directory: "chixie-rusong-plus-v2", DisplayName: "持械入宋plus第二版", Reference: "references/director-optics-dialogue.md"},
	{Category: "short-drama-editing", Directory: "chixie-rusong-plus-v2-blocking", DisplayName: "持械入宋plus第二版·站位连续2.4", Reference: "references/spatial-continuity.md"},
	{Category: "short-drama-editing", Directory: "chixie-rusong-action-master", DisplayName: "持械入宋·打戏动作导演大师版1.0", Reference: "references/action-direction.md"},
	{Category: "short-drama-editing", Directory: "chixie-rusong-fantasy-vfx-master", DisplayName: "持械入宋·玄幻奇观特效导演大师版1.0", Reference: "references/fantasy-vfx-direction.md"},
	{Category: "cinematography", Directory: "master-camera-blocking", DisplayName: "大师级摄影机位与镜头设计", Reference: "references/blocking-review.md"},
	{Category: "cinematography", Directory: "master-camera-movement", DisplayName: "电影级运镜与场面调度", Reference: "references/movement-review.md"},
	{Category: "cinematography", Directory: "cinematic-lighting", DisplayName: "电影光影设计与精细布光", Reference: "references/lighting-review.md"},
	{Category: "cinematography", Directory: "cinematography-continuity", DisplayName: "摄影色彩与画面连续性质检", Reference: "references/continuity-review.md"},
}

func (s *Service) ensureBundledSkillsAdded(userID string) error {
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("定位随附技能包失败: %w", err)
	}
	root := filepath.Join(filepath.Dir(executable), "skill-packages")
	owned, _, err := s.repo.Skills(repository.SkillListFilter{UserID: userID, Scope: "created", Limit: -1})
	if err != nil {
		return err
	}
	for _, item := range bundledSkillPackages {
		identity := item.Category + "/" + item.Directory
		found := false
		for _, skill := range owned {
			if skill.SourceSubdir == identity || parseSkillPackageMetadata([]byte(skill.Instruction)).Name == item.Directory {
				found = true
				break
			}
		}
		if found {
			continue
		}
		archive, err := readBundledSkillArchive(root, item)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("读取随附技能包 %s 失败: %w", identity, err)
		}
		for _, skill := range owned {
			if skill.ContentHash == archive.ContentHash {
				found = true
				break
			}
		}
		if found {
			continue
		}
		if _, err := s.createSkillFromArchive(userID, archive, SkillInstallRequest{Name: item.DisplayName, Tag: "drama"}, "zip", "", "", identity, "", false); err != nil {
			return fmt.Errorf("安装随附技能包 %s 失败: %w", identity, err)
		}
	}
	return nil
}

func readBundledSkillArchive(root string, item bundledSkillPackage) (skillPackageArchive, error) {
	file, err := os.Open(filepath.Join(root, item.Category, item.Directory+".zip"))
	if err != nil {
		return skillPackageArchive{}, err
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxSkillPackageBytes+1))
	if err != nil {
		return skillPackageArchive{}, err
	}
	if len(content) > maxSkillPackageBytes {
		return skillPackageArchive{}, fmt.Errorf("随附技能包超过 20MB")
	}
	archive, err := archiveFromZip(content, "")
	if err != nil {
		return skillPackageArchive{}, err
	}
	if archive.Metadata.Name != item.Directory {
		return skillPackageArchive{}, fmt.Errorf("随附技能包名称不匹配: %s", archive.Metadata.Name)
	}
	if len(archive.Files[item.Reference]) == 0 {
		return skillPackageArchive{}, fmt.Errorf("随附技能包缺少参考文件: %s", item.Reference)
	}
	return archive, nil
}
