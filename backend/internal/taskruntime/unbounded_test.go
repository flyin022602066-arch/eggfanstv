package taskruntime

import (
	"context"
	"fmt"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

type finiteDispatchRepo struct {
	memoryRepo
	remaining int
}

func (repo *finiteDispatchRepo) ClaimNext(_ context.Context, owner string, ttl time.Duration) (*model.Task, error) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if repo.remaining == 0 {
		return nil, nil
	}
	repo.remaining--
	expires := time.Now().Add(ttl)
	return &model.Task{ID: fmt.Sprintf("video-%d", repo.remaining), Type: "canvas_video", Status: model.TaskStatusRunning, LeaseOwner: owner, LeaseExpiresAt: &expires}, nil
}

func TestUnboundedDispatchStartsEveryTaskBeforeAnyTaskFinishes(t *testing.T) {
	const count = 32
	repo := &finiteDispatchRepo{remaining: count}
	started := make(chan string, count)
	release := make(chan struct{})
	runtime := testRuntime(t, Deps{Repository: repo, Policy: staticPolicy{n: 1}, Config: Config{Unbounded: true, MaxSlots: 1}, Executor: fnExec(func(session Session) Outcome {
		started <- session.Task().ID
		<-release
		return Outcome{Kind: KindCompleted, Applied: true}
	})})
	defer close(release)
	runtime.Dispatch(context.Background())
	seen := make(map[string]bool, count)
	timeout := time.NewTimer(2 * time.Second)
	defer timeout.Stop()
	for len(seen) < count {
		select {
		case id := <-started:
			if seen[id] {
				t.Fatalf("duplicate submission: %s", id)
			}
			seen[id] = true
		case <-timeout.C:
			t.Fatalf("only %d/%d tasks started before another task finished", len(seen), count)
		}
	}
}
