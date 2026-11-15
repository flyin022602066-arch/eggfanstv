package hanbao

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type accountCandidate struct {
	ID                string `json:"id"`
	LoggedIn          bool   `json:"logged_in"`
	ProfileReady      *bool  `json:"profile_ready"`
	Blocked           bool   `json:"blocked"`
	BlockKind         string `json:"block_kind"`
	DailyLimit        int    `json:"daily_limit"`
	UsedToday         int    `json:"used_today"`
	RemainingToday    *int   `json:"remaining_today"`
	DailySecondsLimit int    `json:"daily_seconds_limit"`
	UsedSecondsToday  int    `json:"used_seconds_today"`
	RemainingSeconds  *int   `json:"remaining_seconds"`
}

func (s *Service) selectAccount(ctx context.Context, preferred string, duration int) (string, error) {
	reply, err := s.run(ctx, "accounts", nil, 30*time.Second)
	if err != nil {
		return "", err
	}
	var data struct {
		Active   string             `json:"active"`
		Accounts []accountCandidate `json:"accounts"`
	}
	body, err := json.Marshal(reply.Data)
	if err != nil || json.Unmarshal(body, &data) != nil {
		return "", &CallError{Source: "local_response", Stage: "检查账号", Reason: "组件账号清单格式无效，尚未提交生成"}
	}
	available := []string{}
	blocked, loggedOut, exhausted := 0, 0, 0
	for _, account := range data.Accounts {
		if !validAccount(account.ID) {
			continue
		}
		if !account.LoggedIn || (account.ProfileReady != nil && !*account.ProfileReady) {
			loggedOut++
			continue
		}
		if account.Blocked {
			blocked++
			continue
		}
		remaining := account.DailyLimit - account.UsedToday
		if account.RemainingToday != nil {
			remaining = *account.RemainingToday
		}
		seconds := account.DailySecondsLimit - account.UsedSecondsToday
		if account.RemainingSeconds != nil {
			seconds = *account.RemainingSeconds
		}
		if (account.DailyLimit > 0 && remaining <= 0) || (account.DailySecondsLimit > 0 && seconds < duration) {
			exhausted++
			continue
		}
		available = append(available, account.ID)
	}
	if preferred != "" {
		for _, account := range available {
			if account == preferred {
				return account, nil
			}
		}
	}
	if len(available) > 0 {
		s.mu.Lock()
		defer s.mu.Unlock()
		next := 0
		for index, account := range available {
			if account == s.lastAutoAccount {
				next = (index + 1) % len(available)
				break
			}
			if s.lastAutoAccount == "" && account == data.Active {
				next = index
			}
		}
		s.lastAutoAccount = available[next]
		return s.lastAutoAccount, nil
	}
	reason := fmt.Sprintf("没有可用生成账号：%d 个未登录，%d 个冷却或受限，%d 个本地额度不足；尚未提交生成。请登录其他账号或检查账号状态", loggedOut, blocked, exhausted)
	if len(data.Accounts) == 0 {
		reason = "尚无已登记账号，请先登录 / 添加账号；尚未提交生成"
	}
	return "", &CallError{Source: "local_validation", Stage: "选择账号", Reason: strings.TrimSpace(reason)}
}
