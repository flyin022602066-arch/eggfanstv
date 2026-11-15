package doubaobrowser

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestDeliveryMarkerDoesNotLaunchWorkerAndRejectsInvalidIdentities(t *testing.T) {
	svc := New(t.TempDir())
	defer svc.Close()
	for _, identity := range []struct{ user, task string }{{"", "task"}, {"owner", "../outside"}} {
		if err := svc.RecordDelivery(identity.user, identity.task); err == nil {
			t.Fatal("invalid marker identity accepted")
		}
	}
	if err := svc.RecordDelivery("owner", "task"); err != nil {
		t.Fatal(err)
	}
	if len(svc.workers) != 0 {
		t.Fatal("local delivery started a browser worker")
	}
	entries, err := os.ReadDir(svc.directory)
	if err != nil || len(entries) != 1 {
		t.Fatal("invalid owner directory", err)
	}
	if _, err := os.Stat(filepath.Join(svc.directory, entries[0].Name(), "deliveries", "task.json")); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordDelivery("owner", "task"); err != nil {
		t.Fatal("idempotent marker write failed", err)
	}
}

func TestReconcileDeliveriesOnlyMarksVerifiedSuccessForThisOwner(t *testing.T) {
	svc := New(t.TempDir())
	defer svc.Close()
	ownerDir := filepath.Join(svc.directory, fmt.Sprintf("%x", sha256.Sum256([]byte("owner"))))
	if err := os.MkdirAll(ownerDir, 0700); err != nil {
		t.Fatal(err)
	}
	pool := []byte(`{"jobs":{"saved":{"phase":"success"},"not-downloaded":{"phase":"success"},"running":{"phase":"accepted"},"failed":{"phase":"failed"},"../unsafe":{"phase":"success"}}}`)
	if err := os.WriteFile(filepath.Join(ownerDir, "pool.json"), pool, 0600); err != nil {
		t.Fatal(err)
	}
	checked := []string{}
	if err := svc.ReconcileDeliveries("owner", func(task string) bool { checked = append(checked, task); return task == "saved" }); err != nil {
		t.Fatal(err)
	}
	if len(checked) != 2 {
		t.Fatal("non-success or invalid task reached verification", checked)
	}
	files, err := os.ReadDir(filepath.Join(ownerDir, "deliveries"))
	if err != nil || len(files) != 1 || files[0].Name() != "saved.json" {
		t.Fatal("unverified task marked delivered", files, err)
	}
	if err := svc.ReconcileDeliveries("foreign", func(string) bool { t.Fatal("cross-owner verification"); return true }); err != nil {
		t.Fatal(err)
	}
	if len(svc.workers) != 0 {
		t.Fatal("reconciliation launched browser")
	}
}
