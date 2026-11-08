package skills

import "testing"

func TestOwnedArchiveUpdatePreservesIdentityAndPinnedFiles(t *testing.T) {
	svc, _ := agentSkillFixture(t)
	old := installAgentSkill(t, svc, map[string]string{"SKILL.md": "---\nname: camera-test\ndescription: original\nmetadata:\n  version: 1.0.0\n---\n# Original", "references/shot.md": "original shot"})
	files := map[string]string{"SKILL.md": "---\nname: camera-test\ndescription: revised\nmetadata:\n  version: 2.0.0\n---\n# Revised", "references/shot.md": "detailed shot"}
	archive := skillZip(t, files)
	if _, err := svc.UpdateOwnedSkillArchive("someone-else", old.SkillID, archive); err == nil {
		t.Fatal("another user updated a private skill")
	}
	updated, err := svc.UpdateOwnedSkillArchive("owner", old.SkillID, archive)
	if err != nil {
		t.Fatal(err)
	}
	if updated.SkillID != old.SkillID || updated.VersionID == old.VersionID || updated.Version != "2.0.0" || updated.Description != "revised" || !updated.IsAdded || !updated.IsPrivate {
		t.Fatalf("update lost identity or metadata: %+v", updated)
	}
	pinned, err := svc.AgentFile("owner", old, "references/shot.md")
	if err != nil || pinned.Content != "original shot" {
		t.Fatalf("historical pin changed: %+v %v", pinned, err)
	}
	current, err := svc.SkillPackageFile("owner", old.SkillID, "references/shot.md")
	if err != nil || current.Content != "detailed shot" {
		t.Fatalf("current file did not update: %+v %v", current, err)
	}
	repeated, err := svc.UpdateOwnedSkillArchive("owner", old.SkillID, archive)
	if err != nil || repeated.VersionID != updated.VersionID {
		t.Fatalf("identical archive created a duplicate version: %+v %v", repeated, err)
	}
	files["SKILL.md"] = "---\nname: different-skill\ndescription: other\n---\n# Other"
	if _, err := svc.UpdateOwnedSkillArchive("owner", old.SkillID, skillZip(t, files)); err == nil {
		t.Fatal("a different package replaced the selected skill")
	}
	after, err := svc.SkillDetail("owner", old.SkillID)
	if err != nil || after.VersionID != updated.VersionID {
		t.Fatal("rejected update changed the selected version")
	}
}
