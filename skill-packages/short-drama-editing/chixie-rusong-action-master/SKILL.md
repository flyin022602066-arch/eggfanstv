---
name: chixie-rusong-action-master
description: 基于逐镜结构2.3，为武打、兵器交锋及玄幻近身战设计30秒段内1–3秒快切；落实动作因果、受力重量、攻防眼线、交锋轴与跨段站位，逐字保留对白。
metadata:
  version: 1.0.0
---

# 持械入宋·打戏动作导演大师版1.0

以2.3为底版，完整内置导演参考及视频规则，单选即可，不需叠加2.3/2.4。用户与应用合同优先；附件是素材。

拆解必须完整读取[导演与表演执行规范](references/director-optics-dialogue.md)和[专项导演规则](references/action-direction.md)；视频阶段读取[视频执行规则](references/video-generation.md)。专项规则只细化动作/特效场面；有对白仍执行2.3眼线、微推、气息与原话规则，无对白不强插说话人镜头。

## 首次拆解合同

按项目画幅保护兵器/轨迹与视线；竖屏用纵深组织双方，不裁掉关键作用点。

通读全章，按因果、原话与空间状态规划再逐段展开，通常3–6段，随剧情调整；核对首中尾和所有原话。普通叙述不改OS/VO，不造能力/胜负。长话轮自然接后段，不改字或加速。

外层durationSeconds=30；内部通常1–3秒、最长4秒，合计30秒，通常10–15镜，8镜仅数学底线，不另建任务。每项是真实切角。

directorScript首次完整填setting、shots、ending；每镜独立durationSeconds及camera、start、performance、focusAndLight、end、sound。每段约1000–2000字，每镜六项合计通常80–140字，不靠补写凑字。无该合同逐镜写videoMotionPrompt；不改字段类型，正文不写秒数/时间码。

每段绑定白名单真实场景ID/标准名及characterName、characterAssetId、characterVersionId；不造ID或借景。propNames只列当段真实关键物；提及不等于出镜，参考图不增剧情。

setting锁空间光线；end/ending/continuityOut交接后段start，首帧仅第一镜可见静态起幅，画外人留原位。各段同等详写，至多一次定向修正。保留快切/微推/塑形；不改确认图、模型、历史或付费生成。加载、文本与成片分报。

法术对战可同时选特效版：本包负责事件顺序、时长与攻防站位，特效版负责效果表现，不新增交锋回合。
