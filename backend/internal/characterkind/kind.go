package characterkind

import (
	"regexp"
	"strings"
)

var collectiveName = regexp.MustCompile(`(?:群像|群体|群演|人群|群众|众人|众生|众弟子|众食客|众工人|众士兵|众村民|们)$|^(?:其余|其他|一群|一众|一批|一队|数名|多名|若干)(?:[一二三四五六七八九十百两0-9]+[位名个])?.+`)

func IsGroup(name string, definition map[string]any) bool {
	if kind, _ := definition["characterType"].(string); kind == "group" || kind == "individual" {
		return kind == "group"
	}
	role, _ := definition["role"].(string)
	return strings.Contains(role, "【群体演员】") || collectiveName.MatchString(strings.TrimSpace(name))
}

const GroupDesignRule = `【群体演员设定图】本资产代表多个不同的人，不是一个人。生成同框的群体选角参考图，完整展示各人的头部与服饰；按已确认人数与构成设计，人数未明确时采用少量不同个体作为选角样例，不把样例人数固化为剧情人数。不使用同一人的正侧背三视图、独立头像加无头身体布局、单人复制阵列或同脸换装。每位成员有不同面孔、脸型、眉眼、发型与体态轮廓，在剧本允许范围内区分年龄、身形与服装细节；剧本明确的性别、年龄段、身份、时代和制服规范不得为差异化而更改。统一群体身份、服饰体系和项目画风，不统一五官；无克隆脸、无双胞胎式重复，不借用男女主人脸。背景中性，成员脸部清楚，人数适量不拥挤，无文字水印。明确有姓名、专属称谓、独立动作或独立对白的成员仍需单独建卡，不能被本群体取代。群体旧设定里的单人锁脸和三视图要求不适用，以本规则为准；用户本次明确编辑的服装、人数及构图要求保留。`

const GroupExtractionRule = `【群体演员分类与生成例外】角色资产不新增顶层分类。characters 中用 characterType 区分 individual（单人角色）与 group（群体演员）；未单独区分身份的工人、食客、侍卫、群众等多人按群体建卡，role 标注【群体演员】并保留本章实际可见依据。群体属于多人选角设计，不是一个人的不同角度或多套服装；不同成员的服装不是同一角色的多形态。appearance、physique、clothing 描述群体构成、身份服饰与成员差异；consistencyPrompt 保持时代、群体身份、服饰体系与画风一致，明确不同面孔，不能锁成同一张脸；multiViewPrompt 使用群体同框设定图，不使用独立头像与身体三视图。人数、性别与年龄遵从原文，不为差异化改动事实。具有专属身份或被单独描写动作、对白的成员单独提取为 individual；例如三师傅与其余六位师傅分别建卡，不因群体规则过滤、吞并或删除独立角色。只在对应镜头实际可见时绑定群体，视频参考只复用身份服饰与不同面孔的样例，不把某个样例脸复制到背景所有人。群体规则优先于旧模板中对所有人物统一三视图、单人锁脸的要求；普通单人和拟人化系统继续遵守各自规则。`
