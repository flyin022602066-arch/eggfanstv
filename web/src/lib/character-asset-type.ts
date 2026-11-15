export type CharacterAssetType = "individual" | "group";

export function characterAssetType(name: string | undefined, definition: Record<string, unknown>): CharacterAssetType {
    if (definition.characterType === "individual" || definition.characterType === "group") return definition.characterType;
    if (String(definition.role || "").includes("【群体演员】")) return "group";
    const title = name?.trim() || "";
    return /(?:群像|群体|群演|人群|群众|众人|众生|众弟子|众食客|众工人|众士兵|众村民|们)$/u.test(title) || /^(?:其余|其他|一群|一众|一批|一队|数名|多名|若干)(?:[一二三四五六七八九十百两0-9]+[位名个])?.+/u.test(title) ? "group" : "individual";
}

export const GROUP_CHARACTER_DESIGN_RULE = `【群体演员设定图】本资产代表多个不同的人，不是一个人。生成同框的群体选角参考图，完整展示各人的头部与服饰；按已确认人数与构成设计，人数未明确时采用少量不同个体作为选角样例，不把样例人数固化为剧情人数。不使用同一人的正侧背三视图、独立头像加无头身体布局、单人复制阵列或同脸换装。每位成员有不同面孔、脸型、眉眼、发型与体态轮廓，在剧本允许范围内区分年龄、身形与服装细节；剧本明确的性别、年龄段、身份、时代和制服规范不得为差异化而更改。统一群体身份、服饰体系和项目画风，不统一五官；无克隆脸、无双胞胎式重复，不借用男女主人脸。背景中性，成员脸部清楚，人数适量不拥挤，无文字水印。明确有姓名、专属称谓、独立动作或独立对白的成员仍需单独建卡，不能被本群体取代。群体旧设定里的单人锁脸和三视图要求不适用，以本规则为准；用户本次明确编辑的服装、人数及构图要求保留。`;

export function groupCharacterVideoRule(name: string) {
    return `群体演员“${name}”不是一个人：参考图仅提供群体身份、时代服饰与不同面孔的选角样例，不复制其中某一张脸到所有背景人物；按本镜剧情决定人数、站位与动作，不照搬参考图排版或样例人数，不新增具名角色，不替代已单独绑定的说话人。`;
}
