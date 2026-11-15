import {expect, test} from "bun:test";
import {characterCandidateReview} from "../src/lib/character-candidate-review";
import type {ProjectAssetCandidate} from "../src/services/api/projects";

const candidate = (details:unknown) => ({id:"candidate", projectId:"project", name:"纪昼", category:"character", status:"pending_confirmation", detailsJson:JSON.stringify(details), createdAt:"", updatedAt:""}) as ProjectAssetCandidate;
test("新造型展示归属和具体差异，不能显示确认新角色", () => {
    const review = characterCandidateReview(candidate({_characterMatch:{title:"纪昼", mode:"new_look", description:"寒潮围巾：新增围巾；原文：程野给她围上围巾"}}));
    expect(review.label).toBe("归入纪昼的新造型");
    expect(review.description).toContain("新增围巾");
    expect(review.ambiguous).toBe(false);
});
test("历史候选默认核对总库，同名冲突必须人工归并", () => {
    expect(characterCandidateReview(candidate({})).label).toContain("自动核对总库");
    expect(characterCandidateReview(candidate({_characterMatch:{mode:"ambiguous"}})).ambiguous).toBe(true);
});

test("群体候选显示群体类型但不误判具名角色", () => {
    expect(characterCandidateReview({ ...candidate({}), name: "工人与食客群像" }).characterType).toBe("group");
    expect(characterCandidateReview(candidate({ characterType: "group" })).characterType).toBe("group");
    expect(characterCandidateReview(candidate({ role: "与工人群像交谈" })).characterType).toBe("individual");
    expect(characterCandidateReview(candidate(null)).characterType).toBe("individual");
});
