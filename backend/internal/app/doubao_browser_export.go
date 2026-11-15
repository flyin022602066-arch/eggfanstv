package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	localasset "infinite-canvas/backend/internal/asset"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
)

type doubaoArchiveError struct{ Cause error }

func (e doubaoArchiveError) Error() string {
	return fmt.Sprintf("视频原件已保存，本地 output 归档待恢复：%v", e.Cause)
}
func (e doubaoArchiveError) Unwrap() error { return e.Cause }

type doubaoArchiveCheckpoint struct {
	TaskID    string         `json:"taskId"`
	UserID    string         `json:"userId"`
	Directory string         `json:"directory"`
	Result    map[string]any `json:"result"`
}

func (s *Service) SetDoubaoBrowserOutputDir(directory string) {
	s.doubaoBrowserOutputDir = strings.TrimSpace(directory)
}

func doubaoArchiveName(title, identity string) string {
	title = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune("/\\:*?\"<>|", r) {
			return '_'
		}
		return r
	}, title)
	title = strings.Trim(title, " .")
	if title == "" {
		title = "未命名"
	}
	runes := []rune(title)
	if len(runes) > 48 {
		title = string(runes[:48])
	}
	sum := sha256.Sum256([]byte(identity))
	return title + "-" + hex.EncodeToString(sum[:4])
}

func (s *Service) doubaoArchiveFile(task model.Task) string {
	sum := sha256.Sum256([]byte(task.UserID + "\x00" + task.ID))
	return filepath.Join(s.dataDir, "doubao-browser-exports", hex.EncodeToString(sum[:])+".json")
}

func (s *Service) doubaoArchiveDirectory(task model.Task) (string, error) {
	body, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return "", err
	}
	var input struct {
		Metadata struct {
			DomainProjectID string `json:"domainProjectId"`
			UnitID          string `json:"unitId"`
			ChapterID       string `json:"chapterId"`
			ShotID          string `json:"shotId"`
			NodeID          string `json:"nodeId"`
			SourceNodeID    string `json:"sourceNodeId"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(body), &input); err != nil {
		return "", err
	}
	projectID, unitID := input.Metadata.DomainProjectID, input.Metadata.UnitID
	if unitID == "" {
		unitID = input.Metadata.ChapterID
	}
	var canvas *model.CanvasProject
	if task.ProjectID != "" {
		if value, err := s.repo.CanvasProjectForUser(task.UserID, task.ProjectID); err == nil {
			canvas = value
			if projectID == "" {
				projectID = value.ProjectID
			}
		} else if projectID == "" {
			projectID = task.ProjectID
		}
	}
	if canvas != nil && unitID == "" {
		var payload struct {
			Nodes []struct {
				ID       string `json:"id"`
				Metadata struct {
					ChapterID string `json:"chapterId"`
				} `json:"metadata"`
			} `json:"nodes"`
		}
		if json.Unmarshal([]byte(canvas.PayloadJSON), &payload) == nil {
			for _, node := range payload.Nodes {
				if node.ID == input.Metadata.SourceNodeID || node.ID == input.Metadata.NodeID {
					if node.Metadata.ChapterID != "" {
						unitID = node.Metadata.ChapterID
						break
					}
				}
			}
		}
		if unitID == "" && projectID != "" {
			links, err := s.repo.ProjectCanvasUnitLinks(projectID)
			if err != nil {
				return "", err
			}
			ids := map[string]bool{}
			for _, link := range links {
				if link.CanvasID == canvas.ID {
					ids[link.UnitID] = true
				}
			}
			if len(ids) == 1 {
				for id := range ids {
					unitID = id
				}
			}
		}
	}
	projectTitle, projectKey := "未归属项目", task.UserID
	if projectID != "" {
		project, err := s.repo.ProjectForUser(task.UserID, projectID)
		if err != nil {
			return "", fmt.Errorf("归档项目归属校验失败")
		}
		projectTitle, projectKey = project.Name, project.ID
		if input.Metadata.ShotID != "" {
			shot, err := s.repo.ShotForProject(projectID, input.Metadata.ShotID)
			if err != nil {
				return "", fmt.Errorf("归档镜头归属校验失败")
			}
			if unitID != "" && shot.UnitID != unitID {
				return "", fmt.Errorf("镜头与集数不匹配")
			}
			unitID = shot.UnitID
		}
	} else if canvas != nil {
		projectTitle, projectKey = canvas.Title, canvas.ID
	}
	unitTitle, unitKey := "未分集", "unassigned"
	if unitID != "" {
		if projectID == "" {
			return "", fmt.Errorf("集数缺少归属项目")
		}
		unit, err := s.repo.ProjectUnit(projectID, unitID)
		if err != nil {
			return "", fmt.Errorf("归档集数归属校验失败")
		}
		unitTitle, unitKey = unit.Title, unit.ID
	}
	return filepath.Join(doubaoArchiveName(projectTitle, projectKey), doubaoArchiveName(unitTitle, unitKey)), nil
}

func (s *Service) archiveDoubaoBrowserResult(task model.Task, result map[string]any) error {
	if !s.IsLocalMode() || !strings.HasPrefix(task.Model, "doubao-browser::") {
		return nil
	}
	if restored, recovered, err := s.recoverDoubaoBrowserArchive(task); recovered {
		if err == nil {
			result["localExport"] = restored["localExport"]
		}
		return err
	}
	// Save the downloaded resource references before resolving project classification.
	checkpoint := doubaoArchiveCheckpoint{TaskID: task.ID, UserID: task.UserID, Result: result}
	if err := s.saveDoubaoBrowserArchive(task, &checkpoint); err != nil {
		return doubaoArchiveError{err}
	}
	return s.finishDoubaoBrowserArchive(task, &checkpoint)
}

func (s *Service) saveDoubaoBrowserArchive(task model.Task, checkpoint *doubaoArchiveCheckpoint) error {
	file := s.doubaoArchiveFile(task)
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(checkpoint)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(file), ".archive-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	_ = temporary.Chmod(0600)
	if _, err = temporary.Write(data); err == nil {
		err = temporary.Sync()
	}
	closeErr := temporary.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, file)
	}
	return err
}

func (s *Service) recoverDoubaoBrowserArchive(task model.Task) (map[string]any, bool, error) {
	if !s.IsLocalMode() || !strings.HasPrefix(task.Model, "doubao-browser::") {
		return nil, false, nil
	}
	file, err := os.Open(s.doubaoArchiveFile(task))
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, true, doubaoArchiveError{err}
	}
	var checkpoint doubaoArchiveCheckpoint
	decodeErr := json.NewDecoder(io.LimitReader(file, 4<<20)).Decode(&checkpoint)
	closeErr := file.Close()
	if err := errors.Join(decodeErr, closeErr); err != nil {
		return nil, true, doubaoArchiveError{err}
	}
	if checkpoint.TaskID != task.ID || checkpoint.UserID != task.UserID || checkpoint.Result == nil {
		return nil, true, doubaoArchiveError{fmt.Errorf("归档任务身份不匹配")}
	}
	err = s.finishDoubaoBrowserArchive(task, &checkpoint)
	return checkpoint.Result, true, err
}

func (s *Service) finishDoubaoBrowserArchive(task model.Task, checkpoint *doubaoArchiveCheckpoint) error {
	s.doubaoArchiveMu.Lock()
	defer s.doubaoArchiveMu.Unlock()
	if s.doubaoBrowserOutputDir == "" {
		return doubaoArchiveError{fmt.Errorf("未配置 output 根目录")}
	}
	if checkpoint.Directory == "" {
		directory, err := s.doubaoArchiveDirectory(task)
		if err != nil {
			return doubaoArchiveError{err}
		}
		checkpoint.Directory = directory
		if err := s.saveDoubaoBrowserArchive(task, checkpoint); err != nil {
			return doubaoArchiveError{err}
		}
	}
	relative := filepath.Clean(checkpoint.Directory)
	if filepath.IsAbs(relative) || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return doubaoArchiveError{fmt.Errorf("归档目录无效")}
	}
	root, err := filepath.Abs(s.doubaoBrowserOutputDir)
	if err != nil {
		return doubaoArchiveError{err}
	}
	directory := root
	if err := os.MkdirAll(root, 0755); err != nil {
		return doubaoArchiveError{err}
	}
	if info, err := os.Lstat(root); err != nil {
		return doubaoArchiveError{err}
	} else if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return doubaoArchiveError{fmt.Errorf("output 根目录不得是链接")}
	}
	for _, part := range strings.Split(relative, string(filepath.Separator)) {
		directory = filepath.Join(directory, part)
		if err := os.Mkdir(directory, 0755); err != nil && !errors.Is(err, os.ErrExist) {
			return doubaoArchiveError{err}
		}
		info, err := os.Lstat(directory)
		if err != nil {
			return doubaoArchiveError{err}
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return doubaoArchiveError{fmt.Errorf("归档目录不得是链接")}
		}
	}
	encoded, err := json.Marshal(checkpoint.Result)
	if err != nil {
		return doubaoArchiveError{err}
	}
	outputs := localtask.CanonicalOutputs(string(encoded), task.Type)
	paths := []string{}
	for _, output := range outputs {
		if output.MediaType != "video" {
			continue
		}
		resource, err := s.repo.ResourceForUser(task.UserID, output.ResourceID)
		if err != nil {
			return doubaoArchiveError{fmt.Errorf("视频资源归属校验失败")}
		}
		if resource.Provider != "local" || resource.Kind != "video" || resource.Size <= 0 {
			return doubaoArchiveError{fmt.Errorf("原始视频尚未下载完成")}
		}
		filename := fmt.Sprintf("%s-%02d%s", doubaoArchiveName("video", task.ID), output.OutputIndex+1, resourceFileExtension(resource.ObjectKey, resource.MimeType, "video"))
		destination := filepath.Join(directory, filename)
		if err := s.copyDoubaoBrowserVideo(resource, destination); err != nil {
			return doubaoArchiveError{err}
		}
		paths = append(paths, filepath.ToSlash(filepath.Join(relative, filename)))
	}
	if len(paths) == 0 {
		return doubaoArchiveError{fmt.Errorf("没有已下载的视频原件")}
	}
	checkpoint.Result["localExport"] = map[string]any{"status": "saved", "directory": "output", "relativePath": paths[0], "files": paths}
	if err := s.DoubaoBrowserDomain().RecordDelivery(task.UserID, task.ID); err != nil {
		return doubaoArchiveError{fmt.Errorf("视频已保存，环境交付确认待重试：%w", err)}
	}
	return nil
}

func (s *Service) copyDoubaoBrowserVideo(resource *model.Resource, destination string) error {
	source, err := localasset.NewFileStore(s.dataDir).Open(resource.ObjectKey)
	if err != nil {
		return err
	}
	defer source.Close()
	if info, err := os.Lstat(destination); err == nil {
		if !info.Mode().IsRegular() || info.Size() != resource.Size {
			return fmt.Errorf("归档目标已存在且与原件不一致")
		}
		existing, err := os.Open(destination)
		if err != nil {
			return err
		}
		defer existing.Close()
		a, b := sha256.New(), sha256.New()
		if _, err := io.Copy(a, source); err != nil {
			return err
		}
		if _, err := io.Copy(b, existing); err != nil {
			return err
		}
		if !strings.EqualFold(hex.EncodeToString(a.Sum(nil)), hex.EncodeToString(b.Sum(nil))) {
			return fmt.Errorf("归档目标内容与原件不一致")
		}
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(destination), ".eggfans-video-*.part")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	defer temp.Close()
	count, err := io.Copy(temp, source)
	if err != nil {
		return err
	}
	if count != resource.Size {
		return fmt.Errorf("视频原件不完整")
	}
	if err := temp.Sync(); err != nil {
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(name, destination)
}
