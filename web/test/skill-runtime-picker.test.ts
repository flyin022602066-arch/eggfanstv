import { expect, test } from "bun:test";

import { skillDisplayName } from "../src/services/api/skills";

test("技能名称标注明确包含15秒限制的技能", () => {
    expect(skillDisplayName({ skillName: "短片导演", has15SecondLimit: true })).toBe("短片导演（含15秒限制）");
    expect(skillDisplayName({ skillName: "通用导演", has15SecondLimit: false })).toBe("通用导演");
});
