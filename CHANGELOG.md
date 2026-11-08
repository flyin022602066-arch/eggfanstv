# Changelog

All notable public changes to BeefTV are documented in this file.

## v1.7.83

- 修复普通声音叙述误删后续出镜角色，以及模型角色名单不完整时补齐本章资产无法找回遗漏人物的问题。
- 分镜角色支持缺图先绑定、手动新增并绑定当前镜头；手动选择锁定保留，同名与别名角色优先复用，参考图可随后补齐。
- 逐镜规划按富文本中的完整句与完整话轮定位原文，不再因整章只有一个段落而只能规划一个生成单元。
- 更新完整 Windows 外发安装包，保留技能、小鸡图标和原有渠道参数，不包含个人项目、素材或密钥。

## v1.7.82

- 极途视频参考素材恢复原有 Uguu 图床上传规则，关闭 Gway 媒体图床及兜底，不增加并发限制，保留视频接口和生成参数。
- 修复人物造型目录被场景、道具的重名或宽泛别名冲突阻断的问题；人物识别只处理角色。
- 道具匹配优先完整名称和明确绑定的资产 ID，补齐与提交保留已有选择，不再提示选择不存在的道具版本。

## v1.7.81

- 极途 Gway 视频参考素材默认使用渠道专属媒体上传，上传会话不可用时尝试官方网关直传，再降级 Uguu。
- 保留原始素材字节、引用顺序与生成参数，其他渠道上传方式不变；取消任务不触发兜底重传。
- 更新完整 Windows 外发安装包，保留标准技能与小鸡图标，不包含个人项目、素材或密钥。

## v1.7.80

- 章节资产提取遇到上游 content_filter 时显示明确的上游终止原因，保留原始错误标记和请求编号。
- 流式终止事件沿用前序响应提供的请求编号，错误诊断不包含章节正文。
- 验证正常长文本资产完整返回，保留上游明确拒绝和断流后完整结果的处理规则。

## v1.7.79

- 汇总当前分镜拆解与资产回填修复，保留真实出镜角色、场景身份、对白原文顺序及重复话轮。
- 完整 Windows 外发安装包随附独立逐镜技能 2.3.2，并校验程序内嵌的小鸡图标和版本资源。
- 保留既有工作区和渠道参数，安装包不包含个人项目、素材或密钥。

## v1.7.78

- 结构化逐镜技能使用单一规则合同，整章规划与逐单元展开在一个持久任务内完成；校验原文连续覆盖、原话声轨、内部镜长及导演正文，单元最多修正一次，未完成不回填半成品。
- 已确认场景和道具跨章节复用时保留章节关联，宽泛别名不再替代精确地点匹配；任务恢复保存紧凑资产身份。
- 本地 ZIP 技能可更新原有技能版本，保留已选 ID 和历史任务引用。

## v1.7.77

- 修复分镜制作右侧留白：最终提交提示词紧接生成设置，生成补充跟随左侧脚本，左右两列独立连续排列。
- 保留提示词编辑、折叠交互和窄屏布局，更新完整 Windows 安装包。

## v1.7.76

- 再次核对本地技能库分支，确认最新提交已包含在主线，八个标准技能随完整安装包发布。
- 保留角色、造型与图片历史工作区和现有渠道参数，重新构建 Windows x64 完整外发安装包。

## v1.7.75

- 角色资产改为角色列表与造型卡片工作区，同一造型的重绘收进图片历史；新增造型仅填写名称和差异，继承基础身份与声音。
- 图片生成、上传或素材库选图后需核对确认；重绘保留旧定稿和已绑定镜头，默认造型与基础人脸独立管理。
- 每套造型独立显示生成状态，支持原图预览下载、单版删除及镜头精确选图，操作失败明确提示并可重试。
- 确认本地技能库分支更新已包含，更新完整 Windows x64 外发安装包。

## v1.7.74

- 角色资产按整章完整提取，静态、昏迷、被动呈现与一次性出场角色均保留；取消解析和回填阶段的本地动作词过滤。
- 普通物品的跨镜复用与剧情关键性筛选仅作用于道具，保留模型对真实出场与对白提及的语义判断。
- 汇入本地项目优化：最新成功结果整体替换本章未确认草稿，保留已确认资产与镜头绑定；上游审核拒绝显示真实原因。
- 更新完整 Windows x64 外发安装包，覆盖升级保留本机项目、素材与渠道设置。

## v1.7.73

- 30 秒分镜按整集 90～180 秒、通常 3～6 段统筹，普通叙述转为画面，避免按对白参考字数无限加段；保留原文台词和剧情顺序。
- 项目角色、场景和道具生成图片后同步到素材库，使用原始图片资源，避免角色图片仅存在于造型版本中。
- 无图资产可直接绑定素材库图片，也可选原图用于参考生成；后续角色造型仍锁定基础版身份。
- 修复多个地点中已有复合场景名被拆开后重复绑定的问题，更新完整 Windows 安装包并保留本机数据。

## v1.7.72

- 修复章节拆解与镜头资产匹配漏掉守在侧面、仰头观察、按停计时和向前移动等实际出镜动作的问题。
- 保留对白提及、画外音与资产参考附录的排除规则，避免将未出镜人物自动绑定到镜头。
- 分镜结构检查区分原文台词中的时长和镜头时间码，不再将“比昨天快十秒”等对白误报为违规时间安排。

## v1.7.71

- 将缺图、角色造型核对和未绑定引用的诊断放回「镜头资产」，修复详情默认折叠，最终提交提示词区域只展示整理后的文本及简洁状态。
- 修复已绑定但尚未生成参考图的资产被误报为未绑定的问题，保留角色引用及原始镜头文本，缺图时继续提示补图。
- 更新完整 Windows x64 外发安装包，覆盖升级保留本机项目、素材和渠道配置。

## v1.7.70

- 修复重新拆解后核对写入被同名资产阻断的问题，核对窗口可明确选择角色、场景和道具，确认后写入并跳转到本章分镜。
- 写入失败时直接显示原因并保留已生成结果，可重新核对后重试，无需再次调用模型。
- 更新完整 Windows x64 外发安装包，包含当前技能库与运行组件；覆盖升级保留本机项目、素材和渠道配置。

## v1.7.69

- 整合本地技能库更新，完整安装包随附七个标准技能包，新增“持械入宋第一版”及导演光学、对白表演和视频执行参考。
- 短剧与章节分镜最多选择五项技能，保留每项上下文额度和逐项加载报告，不影响其他入口的技能数量限制。
- 保留现有角色复用、基础版人脸继承和渠道配置逻辑；完整外发包不包含个人项目、素材或密钥。

## v1.7.68

- 章节提取参考整个项目的角色与造型库，已有人物无明确造型变化时直接关联本章，避免重复新建角色。
- 新造型必须保留本章原文依据及具体差异，确认时归入已有角色；同名归属不明确时由用户选择，不自动生成独立人物。
- 更新完整 Windows x64 外发安装包，包含当前工作区修复、标准技能、协议插件和媒体运行时；不包含个人项目、素材或密钥，覆盖升级保留本机数据。

## v1.7.67

- 角色后续形态改为参考基础版原图进行图片编辑，继承同一人物身份；明确的头部变化仅调整指定部位，不再独立文生图换脸。
- 批量补图先完成基础造型，再生成其余形态；基础图缺失、失败或模型不支持参考编辑时明确提示，不降级为无参考生成。
- 修复章节资产提取的桌面任务超时策略和流式断流处理，截断时续接一次，完整校验后再回填。
- 更新完整 Windows x64 外发安装包，包含标准技能和媒体运行时，不包含个人项目、素材或密钥；覆盖升级保留本机数据。

## v1.7.66

- 修复自动补齐资产引用误标为脚本未保存，导致镜头角色造型版本无法选择的问题。
- 造型管理新增“用于当前镜头并锁定”，默认定位本镜所选版本，预览与视频提交使用同一版本图片，不改变其他镜头。
- 完整 Windows x64 安装包包含当前工作区代码、标准技能、协议插件和媒体运行时，升级保留本机项目与渠道配置。

## v1.7.64

- 修复重新拆解结果“核对后写入”命中旧缓存，导致项目修订号或镜头快照过期而无法写入的问题；写入前强制读取当前项目与章节数据，并显示可读的冲突原因。
- 更新完整 Windows x64 外发安装包，不包含个人项目、素材或密钥。

## v1.7.63

- 角色多造型按组紧凑展示，隐藏空白历史占位，补充版本删除入口和引用保护；镜头角色操作整合到镜头资产区域。
- 修复资产删除无反馈和角色原图下载失败，错误原因在操作区域直接显示。
- 拆解、恢复回填及补齐资产统一核对真实出镜人物，排除对白提及与无原文依据的角色，保留手动和锁定绑定。
- 完整外发包自动安装五个标准内置技能及参考文件，包括高级小说拆解与短剧编剧；保留用户自定义技能。
- 更新 Windows x64 完整安装包，不包含个人项目、素材和密钥，升级保留本机数据与渠道设置。

## v1.7.62

- 将本地项目优化与技能库分支的更新汇入主线，保留当前角色多造型、镜头参考、画布和渠道功能。
- 完整安装包附带四个专业摄影技能包和高级小说拆解技能包，保留标准入口及参考资料，可在技能库中导入。
- 修复角色造型连续保存时修订时间未递增、旧状态可能覆盖新状态的问题。
- 保留画布图片快捷工具栏修复，重新构建 Windows x64 完整外发安装包，不包含个人项目、素材或密钥。

## v1.7.61

- 修复画布 Agent 打开或保持后台打开状态时，图片、视频等节点的快捷工具栏被误隐藏的问题。
- 修复图片设置弹层关闭、切换节点或卸载后残留打开状态，导致节点工具栏无法恢复的问题。
- 保留现有渠道、生成参数与项目数据，补充明暗主题下工具菜单、图片设置和节点切换回归验证。

## v1.7.60

- 整合项目角色多造型参考：管理历史造型与定稿图，按镜头选择、确认和锁定角色版本，生成预览与实际提交保持一致。
- 整合画布参考模板库：导入、收藏、搜索姿势和服装参考，组合模板并应用到图片节点，支持移除及项目隔离。
- 保留项目读取恢复、整集视频追加、现有渠道参数及外发版隐藏规则，完整安装包不包含个人项目、素材或密钥。

## v1.7.59

- 修复后台读取临时失败时将项目误报为不可用的问题，保留已加载分镜、选择与编辑状态，支持自动及手动重试。
- 项目与章节工作区读取超时调整为 30 秒，跨集读取失败不会显示上一集镜头，真实权限和删除错误继续阻止访问。
- 剪辑媒体库只显示视频并按集数归类，支持一键追加整集视频，按章节与镜头顺序接在现有视频之后。
- 更新完整 Windows x64 外发安装包，保留现有功能、渠道与用户数据，不包含个人项目、素材或密钥。

## v1.7.58

- 修复对白中仅被提及的人物被误提取为出镜角色的问题，角色提取、章节资产提取和分镜拆解统一区分出镜、说话与被提及人物。
- 自动绑定角色时排除对白提及，保留真实出镜、回忆或照片画面，以及用户明确设置的角色与手动绑定。
- 更新完整 Windows x64 外发安装包，保留现有功能与渠道配置，不包含个人项目、素材或密钥。

## v1.7.57

- 修复音乐导演台用户填写的歌曲标题被 Suno 返回的默认歌名覆盖的问题，提交和后续查询回填均以用户标题为准。
- 保留歌曲标题已传入创建音乐请求的行为，并补充上游返回其他歌名时的回归测试。

## v1.7.56

- MV 资产可独立并行生成，单项失败不阻塞其他资产，批量生成最多同时执行三项。
- 修复主角人脸参考未参与生成的问题，支持逐角色绑定参考图，带参考图时使用图片编辑接口。
- MV 角色、场景、道具分别提供图片模型、比例、尺寸和质量设置并持久保存；角色默认使用 3:2 比例。
- 更新完整 Windows x64 单文件外发安装包，保留现有渠道设置和所有运行组件，不包含个人项目、素材或密钥。

## v1.7.55

- 修复未生成分镜的章节点击提取资产后立即退出：空镜头修订列表统一返回数组，正文可正常提交角色、场景与道具提取。
- 增加空章节工作区回归测试，保留原有章节隔离、历史资产版本与声音绑定逻辑。

## v1.7.54

- 整合当前项目优化，分镜技能状态收纳到产物预览侧栏，窄屏仍可查看。
- 优化道具提取：普通一次性道具不单独建资产，跨镜头保持一致或影响剧情的关键道具继续保留。
- 加强 30 秒分镜运镜技能，明确镜头起落、触发、方向与叙事目的，避免将人物动作误作运镜。
- 更新完整 Windows x64 单文件安装包，沿用运行时白名单，不包含个人项目、素材或密钥。

## v1.7.53

- 汇总当前各功能分支，合并模型 SDK、网络与图像处理依赖更新，保留已有渠道与用户配置。
- 修复产物预览切换分镜时任务卡片残留，任务 ID 仅随当前选中镜头显示。
- 更新完整 Windows x64 外发安装包，保留所有运行组件，不包含个人项目、素材或密钥。

## v1.7.52

- 整合项目优化与封面功能，保留当前画布、音乐 MV 及各渠道隔离设置。
- 修复场景 ID 错误导致整章分镜无法回填的问题；已生成状态以真实保存结果为准，保存失败可继续写入原任务结果。
- 重新构建完整 Windows x64 单文件安装包，不包含个人项目、素材、画布或密钥。

## v1.7.51

- MV 制作与预览任务区支持拖动调整宽度、按用户记忆、键盘微调与双击复位。
- MV 资产与分镜卡片按制作区宽度自动排列为多列，窄屏自动上下布局，拖动按帧更新且不触发卡片区重渲染。
- 重新构建完整 Windows x64 外发安装包，保留渠道隔离与隐藏规则，不包含个人项目、素材、画布或密钥。

## v1.7.50

- 合并项目优化与封面相关改动，重新生成完整 Windows x64 外发安装包。
- 版本号统一为 v1.7.50，外发包仅包含白名单运行时、协议插件和应用程序，不包含个人项目、素材、画布或密钥。

## Unreleased

- Built-in BeefAPI can be connected from the desktop app without pasting a key.
- Prepared the first audited public source snapshot.
- Added reproducible local builds, automated quality checks, and multi-architecture container publishing.
- Standardized public artifacts, runtime identifiers, documentation, and repository links on the BeefTV name.

## v1.7.49

- 重新构建完整 Windows x64 单文件外发安装包，沿用当前运行时白名单，不打包个人 Key、画布、项目或素材。

## v1.7.48

- 合并技能库完善分支，补齐专业摄影技能包与参考资料，技能库默认按最新发布展示，保留 30 秒分镜专项技能。
- 修复 Suno 已成功歌曲的本地取回通路，支持自动补取、播放、原文件下载和波形读取；取回失败不重提生成。
- 递增 Windows 完整单文件安装包版本，保留渠道隔离和外发版隐藏规则，不包含个人项目、素材或密钥。

## v1.7.47

- 整合功能优化与画布优化：素材库选取、资产重新打开、角色参考与风格编辑保持一致，保留当前项目及渠道配置。
- 修复音乐导演台已取回歌曲的本地播放、下载与波形交互，复用鉴权资源读取，不重新提交生成。
- 修复创作对话结果回填的类型检查阻塞，保留本地编辑与已完成生成结果的合并逻辑。
- 沿用完整 Windows x64 单文件安装包，包含助手、协议插件和媒体运行时，不包含个人 Key、项目、画布或素材。

## v1.7.46

- 修复分镜提示词残留错误资产 ID 导致视频无法提交的问题，按明确名称和项目真实资产核对，避免重复追加无效引用。
- 无法唯一核对的引用显示名称、完整 ID 和上下文，可直接替换为已绑定资产或移除多余引用，保存后继续生成。
- 完整 Windows x64 外发安装包沿用原运行时组件，不包含个人 Key、项目、画布或素材数据。

## v1.7.45

- 分镜制作界面显示镜头资产名称与完整资产 ID，便于核对绑定资产；未绑定提示同时标明资产名称或 ID。
- 重新构建完整 Windows x64 外发安装包，不包含个人 Key、项目、画布或素材数据。

## v1.7.44

- 修复资产单独生图弹窗编辑提示词后仍提交旧默认提示词的问题，提交时以用户最后编辑的提示词为准。
- 重新构建完整 Windows x64 外发安装包，不包含个人 Key、项目、画布或素材数据。

## v1.7.43

- Towo Seedance 2.5 视频模型增加可选本地网格人脸遮罩处理，保持原渠道请求参数与资产上传流程。
- 重新构建完整 Windows x64 外发安装包，不包含个人 Key、项目、画布或素材数据。

## v1.7.42

- 重新打包完整 Windows 外发安装版，沿用白名单运行时清单，不包含个人 Key、项目、画布或素材数据。

## v1.7.41

- 新增独立 Towo SD2.5 视频渠道，默认地址为 `https://towoapi.com`，与佳速及其他视频渠道隔离协议参数。
- 按 Towo 文档接入 `/v1/videos` 创建、`/v1/videos/{id}` 轮询和认证 `/content` 结果下载。
- 支持 `seconds`、`resolution`、`aspect_ratio`、`enable_audio` 以及图片、视频、音频、首尾帧参考素材映射；能力限制为 30 张图片、10 段视频、10 段音频、4 到 30 秒。

## v1.7.39

- 修复场景或道具重新生成后，章节分镜仍绑定旧图片版本的问题。
- 补齐本章资产会自动替换旧版本并校验写入完成，避免旧场景继续提交。
- 修复“核对后写入”重复点击导致并发写入失败的问题。

## v1.7.38

- 修复章节资产返回完整正文、却因字段名或字符串内混入非法裸换行而提取失败的问题，本地修复后重新校验，不重复消耗模型额度。
- 保留原始任务草稿及合法转义内容，前后端均支持该格式修复，缺字段或截断的结果仍不回填半成品。
- 提供包含此修复的完整 Windows 外发安装包，沿用渠道固定与隐藏设置。

## v1.7.37

- 发布完整 Windows 外发安装包，包含场景别名匹配、多地点绑定、缺失场景和道具补齐等 v1.7.36 修复。
- 保留外发版固定渠道地址、悬停查看地址及隐藏新增渠道、火山 URI 资产库和中转网关的设置。
- 随包提供创作助手、协议插件、媒体处理和本地语音识别组件，不打包个人密钥、项目或素材数据。

## v1.7.36

- 修复场景名称带班级限定词时无法匹配已确认教室资产的问题，保留场景与道具的明确别名。
- 同一分镜的多个地点分别匹配，已有主场景不再遮蔽第二地点，保留手动绑定及历史版本。
- 补齐本章资产会整理缺失场景和道具到本章待确认列表，镜头面板增加缺项提示及新增场景入口，确认补图后可继续补齐。
- 强化章节提取对通道、台阶等外景和实际拿取、佩戴、传递道具的覆盖规则，不自动发起生图。

## v1.7.35

- 章节资产提取改为整包接收；检测到截断后沿用原渠道、模型和上下文自动续接一次，并校验拼接断点。
- 角色、场景和道具完整校验后才回填，不再把截断结果内的角色卡或前置示例误当成整章结果。
- 已接收文本保留在任务中，续接失败或仍不完整时显示明确原因，不无限重试、不回填半成品。

## v1.7.34

- 章节资产提取及分镜生成增加“系统面板 / 拟人化系统”选择，按项目记忆并沿用至后续各集。
- 拟人化系统支持设置名称、动物或精灵形象与声音，作为角色生成资产并承接原文系统台词，不自动绑定旧面板。
- 生成任务冻结系统表现设定，刷新恢复仍沿用提交时的模式，系统角色参考图按完整造型生成。

## v1.7.33

- 修复系统道具检测只识别部分括号格式的问题，支持全角方括号和无括号的连续宿主属性列表，保留原文文字与数值。
- 提取弹窗、资产解析和任务刷新取回共用扩展后的识别规则，继续排除纯声音播报和普通资料清单。
- 系统面板生图改为数值留空的可复用模板；视频参考仅继承外框与布局，本镜原文决定显示状态，不照抄参考图中的旧数值。

## v1.7.32

- 发布包含系统面板道具提取与补提修正的 Windows 完整外发安装版，同步程序与安装包版本号。
- 保留外发版渠道地址固定和隐藏设置，随包提供协议插件、创作助手、剪辑工具与离线运行环境。

## v1.7.31

- 系统流小说中的可见属性面板、状态栏和系统界面纳入道具提取；按原文补回模型漏提的面板，保留逐镜文字与数值变化。
- 章节资产提取增加单独补提系统道具入口，已有章节可补入待确认列表，确认后沿用道具生图和分镜绑定流程。
- 分镜按系统面板内容匹配界面参考，避免误绑状态字段提及的实物；纯声音播报保留声音表现。

## v1.7.30

- 修复 Agent 文本流式输出完成后，对话版本冲突阻断后续消息保存、并误报模型不可用的问题。
- 成功正文先显示并保留；结果挂载失败提示同步问题，重新打开对话后从成功任务恢复，不重新提交生成。
- 自动合并后端生成结果回填引起的版本变化，保留用户修改、工作区隔离和真正的编辑冲突保护。

## v1.7.29

- 发布包含当前本地修正的 Windows 完整外发安装版，同步程序与安装包版本号。
- 将原佳速视频渠道显示名统一为极途 Gway，保留既有协议标识、调用参数与配置。
- 保留外发版渠道地址固定和隐藏规则，随包提供协议插件、创作助手、本地剪辑与语音识别运行环境。

## v1.7.28

- 发布包含主角人脸参考模式的 Windows 完整安装版，统一桌面程序与安装包版本号。
- 保留外发版渠道固定与隐藏设置，完整包含协议插件、剪辑工具、语音识别和创作助手运行环境。

## v1.7.27

- 新增项目级主角人脸预设，支持分别上传男主、女主参考图并绑定对应角色，跨集和重启后保留。
- 单张与批量角色生图自动携带对应人脸参考，保留面孔身份，服装、发型与造型遵循小说剧本和项目画风。
- 生图前读取最新预设，显示当前人脸参考；预设图作为本地资源保存并加入引用保护，沿用原有角色图回填和版本历史。

## v1.7.26

- AI 剪辑助手新增智能成片：直接从项目媒体库或当前时间线分析素材，按剧情、混剪和叙事节奏规划完整镜头组接，支持最多 120 个镜头。
- 增加真实对白保护、自动字幕、低音量配乐与淡入淡出；缺少对白识别依据时保留完整视频，避免为凑时长截断表演。
- 成片方案可先预览，再整批应用、撤销或打开导出；保留对话微调，记住项目成片设置，并自动修正一次无效方案。

## v1.7.25

- 修复章节分镜生成成功后，因对白、音效或镜头序列返回文本数组而中断保存和跳转的问题，保持文本内容及顺序。
- 明确分镜输出字段类型；已完成但未保存的任务可沿用原批准快照恢复，项目或镜头变化时仍需核对后写入。

## v1.7.24

- 统一章节拆解的完整导演脚本合同，区分 30 秒生成单元与内部镜头；每段从镜头1重新编号，一次输出摄影、表演、空间变化与声音。
- 明确 600 字符目标仅作用于资产与声音附录，保留主脚本的详细导演描写；不新增提示词字数门禁或自动付费重写。
- 将原有提示词建议改为“已保存分镜的格式检查”，说明其用途与已有脚本的处理方式。

## v1.7.23

- 修复场景、道具图生成成功后未回填项目资产的问题，后台自动恢复已保存的图片，保留原设定与版本历史。
- 分镜结果在取回中断后仍可恢复；原批准快照未变化时自动保存，章节已修改时保留结果待核对。
- 章节页显示实际分镜数量，区分资产提取完成与分镜生成完成。

## v1.7.22

- 视频任务新增默认折叠的“高级任务操作”，可对单条卡住的视频仅停止本地跟进；不会请求上游取消，保留原任务 ID，停止后可重新提交。

## v1.7.21

- 修复章节资产已确认后仍显示“待确认”的统计问题，仅将待确认的资产计入数量。
- 优化 30 秒分镜的自然对白节奏，优先保留完整台词和表演停顿，台词过多时按完整句子或对话轮次拆分。
- 精简视频提示词中的重复镜头与重复台词，保留资产绑定、声音画像及未重复的旁白；资产与声音附录以 600 字以内为目标。
- Windows 外发安装包包含当前协议插件、创作助手运行环境、本地剪辑与语音识别组件，并保留渠道配置的外发版隐藏规则。
- 修复 Windows 外发版渠道编辑向导绕过地址固定和隐藏规则的问题，开发版保留完整渠道编辑。

## v1.7.19

- 主动替换角色参考图时，同步更新本项目已绑定镜头的参考版本，并保留历史任务输入和生成文件。
- 镜头资产缩略图、放大预览与实际提交共用同一绑定图片来源，避免预览新图却提交旧图。

## v1.7.16

- 音频和视频节点的字幕窗口支持云端自动转写，可读取已连接 BeefTV 账号的转写模型。
- 支持 hy-asr-3.0-preview，识别结果可编辑、保存到画布并导出 SRT；保留本地 whisper.cpp 转写。
- 转写模型与配音、音乐生成模型分开显示，避免使用不匹配的接口。
- 云端转写中断且结果不确定时不自动重复提交，避免重复计费。

## v1.7.15

- 调整工作区侧栏、画布工具与素材面板，保留主题、更新和帮助入口。
- 删除生成中节点时增加确认；切换画布或账号后，旧确认不会误删其他画布内容。
- 版本记录保留本机草稿，可预览和下载；恢复历史版本前先保留当前草稿。
- 修复素材引用菜单意外关闭、点击穿透与键盘导航问题。
- 历史视频仅在悬停或聚焦时加载预览，离开后取消下载。
- Windows 随包提供视频转码工具；无法直接播放的视频按需准备兼容预览，保留原件。
- 改善国内网络下的视频结果取回；正常线路失败后读取同一任务的备用接口，无需重新生成。
- 修复 Windows 连接、画布媒体和滚轮交互问题。
- 新增 Ubuntu 24.04 x64 桌面包，支持随包 CLI 和 MCP。

## v1.7.14

- 兼容通道的助手回复长时间没有新内容时自动尝试恢复，保留已完成操作，仍可随时停止。
- 视频节点自动显示首帧时不再改动画布，避免已准备的生成方案因此过期。
- 修复画布上按 Backspace 意外离开，以及离开或切换画布时删除内容未及时保存的问题。
- 生成方案显示未能开始的具体原因与等待状态；长任务显示已等待时间。
- 同轮多次局部编辑按各画布接续版本，恢复时保留原操作身份；外部删除与本地编辑冲突时保留本地内容并提示处理。
- 修复大画布读取被截断的问题，助手可分页读取完整节点、连线和时间线。
- 修复切换助手模型后仍使用旧模型的问题；恢复未完成轮次时继续使用原模型。
- 修复完全访问模式下工作区画布搜索错误过滤，导致找不到其他画布的问题。
- 旁白剪辑可检测实际停顿，并再次听取裁剪后的音频核对尾字与保留内容。
- 修复素材读取补齐资源后已成功，助手仍显示先前失败提示的问题。
- 删除素材记录时保留画布和历史仍在使用的资源，避免影响已有作品。
- 模型配置支持搜索选择，保留自定义服务和暂不可用的模型设置。
- 改进 BeefTV MCP 的连接状态和管理入口、侧栏收起与社交入口，并提供应用内中文更新说明。

## v1.7.13

- 连接入口改为「连接 BeefTV」，新登录授权和钱包控制台使用 beeftv.app；保留已连接企业账号。
- 创作助手支持图片、视频和音频参考、运行中补充内容与固定版本技能，并使用持久会话恢复中断工作。
- 助手可将已上传素材绑定到画布参考节点；技能选择器支持直接安装 ZIP 和 Markdown 技能。
- 内置助手可选择只读、当前画布或完全访问；跨画布编辑可整轮撤销。
- 切换助手权限后仍可读取已授权的会话素材；修复多图再次生成时新结果被旧画布覆盖的问题。
- 助手可裁剪、排列素材，添加旁白和字幕，并在本地渲染视频预览。
- 助手对话直接显示成片版本，可播放、下载，并在重开对话后恢复。
- 模型回复失败时保留已完成操作，提供继续处理入口。
- 外部 Agent 通过 MCP／CLI 使用完整业务工具，无需在 BeefTV 重复选择执行权限。
- 补齐节点移动、删除、移除连线和模型目录；修复失败更新留下安装缓存的问题。

## v1.7.12

- Seedance 2.0、2.5 统一名称，模型列表不再重复展示真人素材型号。
- 模型选择和助手生成确认显示当前报价。
- 保留旧项目的模型设置，仍可继续使用。

## v1.7.11

- 图片生成前先保存画布节点，保存冲突时停止提交，避免生成完成后找不到结果节点。
- 图片已生成但画布更新失败时保留原任务，可重新加载资源，无需再次生成。
- 修复桌面端“重新加载资源”不可用，以及恢复任务后一直显示生成中的问题。

## v1.7.10

- 真人视频模型统一显示为 Seedance 2.0-真人、Seedance 2.5-真人，模型选择、设置和名称搜索保持一致。
- API 模型 ID、价格与渠道路由保持不变。

## v1.7.9

- 新增 Seedance 2.0、2.5 真人素材版，选择模型时显示价格，标准版保留原价。
- 修复模型目录刷新、分镜工作台恢复设置时可能自动切换到不同收费档位的问题。
- 生成与重试前检查真人素材版的可用状态和报价，助手确认卡片同步显示单价。

## v1.7.8

- 修复部分视频点击预览后页面崩溃、无法播放的问题。
- 修复恢复设置时已关闭的视频声音开关被重新开启的问题。
- 修复 Windows 下载更新包后无法完成校验的问题。

## v1.7.7

- 生成前检查渠道能否读取参考素材，需要在线链接时可直接填写并继续生成，或切换渠道。
- 处理参考素材时显示准备阶段，完成后再提交生成任务。
- 修复部分视频渠道的音频、水印等开关参数导致任务无法解析的问题。

## v1.7.6

- 统一素材库、生成历史与画布素材选择的布局，改进窄窗口显示和应用加载画面。
- 上传素材后切换页面仍会完成上传，返回页面不会重复创建素材。
- 永久删除生成历史前增加确认，批量删除失败的项目可单独重试。
- 提供旧回收站素材恢复入口，保留此前归档的素材。
- 改进素材详情中的图片缩放与视频播放控件。

## v1.7.5

- 桌面更新支持断点续传与自动重试，显示下载进度、速度和剩余时间，并提供更明确的网络错误提示。
- 修复桌面端资产详情中的音视频无法播放：通过本地资源鉴权后读取媒体，重启后仍可播放已保存的作品。
- 修复视频生成完成后，相对下载地址被误判为无效地址的问题。
- 新增可由用户配置地址的全参视频协议，支持图片、视频与音频参考素材。
- 改进自定义模型目录的能力识别与加载超时。
- 修复 macOS 保存媒体时改名丢失扩展名的问题。

Windows v1.6.20–v1.6.22 的旧更新器无法识别新版目录结构，请关闭应用后手工解压新版完整安装包；保留原用户数据目录。v1.6.23 及后续版本可使用应用内更新。

## v1.7.3

- Add guided setup for OpenAI, Google Gemini, Volcano Ark and compatible model services, with searchable catalogs and manual model entry.
- Preserve selected models and explicit protocol settings when refreshing custom catalogs.
- Wait for completed generation results during model tests and preserve actionable authentication errors.
- Encrypt local provider settings, backup settings and custom task headers; omit credentials from the browser's persisted configuration cache.
- Require upgrades from released Windows installers and failed-launch rollback tests against the final Windows package before publication.

## v1.7.2

- Restore the bundled Windows MCP command-line tool and prevent MCP connections from accidentally opening another desktop window.
- Add separate Claude Desktop setup instructions and stop offering connections when installation files are incomplete.
- Keep Windows runtime discovery outside AppData so packaged MCP clients cannot reuse an old virtualized runtime file.
- Start the Windows assistant in the background without opening a Node console window.
- Explain blocked model-service addresses and DNS failures with actionable connection guidance.

- Automatically remove completed upgrade folders after the local workspace starts successfully, while preserving failed upgrades for recovery. Windows also removes its released lock file; macOS retains the empty lock for compatibility with older update helpers.

- Fix the canvas assistant being unavailable when following a default text model from a custom local channel.
- Keep explicit model capabilities, protocol restrictions, and channel credentials in effect when resolving assistant connections.

## v1.7.1

- Choose the canvas assistant model directly beside the message input.
- Start with GPT 6 Astra after connecting BeefAPI, and keep your chosen model when refreshing the catalog.
- Offer Astra, Opus 5.5, DeepSeek V4.1 Flash, and GLM 5.3 when available on the connected account.
- Save model changes before starting the next assistant request.

## v1.6.23

- Add a canvas assistant for drafting scenes, editing nodes, connecting references, and proposing image or video generation for confirmation.
- Keep assistant conversations and canvas changes recoverable across restarts, with conflict checks and per-turn undo.
- Let external agents connect through the bundled CLI and MCP using revocable read-only or read-write access.
- Share canvas operations and generation delivery across manual editing and agents, preserving original tasks during recovery.
- Unify media rendering and workspace backup paths while retaining existing projects, assets, and tasks.

## v1.6.22

- Add a director workbench for staging objects, cameras, motion paths, and shot previews.
- Keep director references and exported previews attached to the correct scene when switching or closing the workbench.
- Preserve shot prompts, camera motion, and independent paths when editing or duplicating scenes.
- Restore the canvas archive import entry in the project library.

## v1.6.21

- Keep copied media nodes on the canvas when regenerating them, including changing a copied video's resolution.
- Upload local Seedance reference media before generation, supporting large files and validating media limits before submission.
- Preserve reference dimensions and use the same media preparation path for built-in and protocol-based video generation.

## v1.6.20

- Keep media file extensions when saving or renaming downloads in the Windows file dialog, while preserving overwrite confirmation and cancellation.
- Use the actual media format for asset-library downloads, including MOV, SVG, WAV and M4A.

## v1.6.19

- Explain account quota shortages with actionable balance, token and plan guidance.
- Distinguish completed videos that could not be saved from generation failures, directing users to recover the original result without paying again.
- Preserve structured provider errors and request IDs through video creation, polling and manual result recovery.

## v1.6.18

- Continue polling the original video task after Windows socket resets or connection aborts instead of failing immediately.
- Retry interrupted media downloads without submitting a new paid generation, while preserving cancellation and retry limits.
- Explain Windows network disconnects clearly in saved task errors and include native Windows recovery regression checks in desktop releases.

## v1.6.17

- Restore the audio toggle for BeefAPI Seedance models so silent video requests explicitly disable audio.
- Repair missing task diagnostics columns when upgrading from preview databases that reused migration numbers, preserving existing projects and tasks.
- Distinguish local task storage failures from model parameter errors and explain when generation has not been submitted.
- Require two complete rounds of real generation acceptance across six image and video paths before publishing desktop updates.

## v1.6.16

- Recover transient video download disconnects using the original provider task, with bounded background recovery for supported video protocols.
- Add “取回结果” to failed video task details on the canvas and in desktop task history; query and download the original result without creating another paid generation.
- Treat lost submission receipts as unconfirmed instead of silently resubmitting; keep explicit rate limits and pre-dispatch rejections retryable.
- Show readable, sanitized task log summaries and prevent late task detail responses from reopening or replacing a different task.

## v1.6.15

- Preserve specific generation errors, request IDs, timings and bounded request history in copied diagnostics, including after reopening a task.
- Distinguish local input and response-size limits, provider failures, and errors while saving or applying generated results.
- Include task image settings, reference counts and limits without copying prompts, credentials or media addresses; preserve request evidence during background polling and clear it when retrying.

## v1.6.14

- Keep canvas task details up to date with the desktop backend while a task is running, including progress, logs and start/completion times.
- Stop detail polling after completion and cancel pending reads when closing or switching tasks; show a retry notice when details cannot be refreshed.

## v1.6.13

- Accept Windows PowerShell ZIP path separators when installing signed depth components while retaining traversal and duplicate-file protection.
- Use the configured Windows/macOS system proxy for optional depth-component downloads, matching the desktop updater and preserving explicit environment proxy/bypass settings.
- Include Windows x64 depth-video processing from v1.6.12 with signed optional runtimes. CPU inference is tested; NVIDIA CUDA support is a community testing preview with a one-time CPU fallback for device failures. First use downloads components, and CPU processing can be slow and memory intensive.
- Expand the director workspace with scene controls, camera following, aspect frames, screenshots and panorama generation history.
- Preserve director scene covers and task recovery context, and improve canvas crop and trim controls at low zoom.
- Check for desktop updates periodically and support downloading and installing from one action while saving work first.
- Prevent late uploads and screenshots from overwriting reopened director scenes; drain panorama result writers before switching workspaces.
- Stamp director cover and output edits before persistence so refreshed canvases retain their previews.
- Install the matching Chromium browser in CI and tolerate subpixel rounding in model-picker layout checks.

## v1.6.12

- Add Windows x64 depth-video processing with the fixed Small model, signed optional CPU/CUDA runtimes, resumable verified downloads, and process-tree cancellation.
- Validate CUDA with a real model probe and fall back once to CPU for device failures. CUDA hardware support is a community testing preview; CPU inference has been tested on Windows with 2-second and 15-second clips.
- Fix Windows PowerShell 5.1 runtime-builder encoding and align the worker's video-duration limit with the app.
- Serialize component installation and stop download verification and extraction when cancelled.
- First use downloads optional components; CPU processing can be slow and memory intensive. Apple Silicon Mac processing remains unchanged.

## v1.6.11

- Fix local reference images being rejected before submitting Wan 3.0 video tasks through BeefAPI.
- Share verified enterprise video contracts across the model catalog, reference validation, and request preparation; preserve explicit protocols for other models.
- Reject unsupported reference types and counts before submission, and retain actionable media guidance in task history.
- Honor installed protocol media declarations and include the shared contracts in container builds.

## v1.6.10

- Check reference-video frame rates on WhatsToken material-conversion routes, including ordinary, fragmented and mixed MP4 files.
- Explain frame-rate, unsupported-codec and asset-access errors with actionable guidance that survives task history reloads.
- Preserve authentication errors and request identifiers when formatting media errors.

## v1.6.9

- Fix built-in BeefAPI Seedance profiles selecting a package name instead of the installed video provider ID, which caused false "interface not installed" failures before submission.
- Repair existing enterprise profiles automatically and accept previously saved OpenAI Videos protocol aliases without bypassing disabled plugins.
- Verify imported and restored Seedance profiles against the shipped provider catalog and test legacy aliases through the installed plugin runtime.

## v1.6.8

- Read missing reference-video dimensions even when duration is already known, and reject unreadable or out-of-range video before submission.
- Validate local and inline video dimensions from the actual file instead of trusting stale metadata.
- Explain pixel-limit failures with the affected reference, actual dimensions and allowed range.

## v1.6.7

- Ask for confirmation before paid Seedance 2.0 standard and 2.5 reference-video generation on affected channels where the requested aspect ratio may not be honored.
- Show frame, edit and extension settings that follow the source media, and explain first-frame compatibility errors with actionable guidance.
- Preserve generated videos and show a notice when their measured aspect ratio differs from the submitted request.

## v1.6.6

- Preserve structured provider error codes when polling Seedance tasks, so temporary route outages do not ask users to change model settings.

## v1.6.5

- Preserve explicit Seedance 2.5 reference/edit/extend task intent in provider requests.
- Recognize temporary model route unavailability as an actionable provider error.

## v1.6.4

- Restore Seedance image, video and audio references for built-in BeefAPI models after catalog import and configuration reload.
- Migrate the old built-in zero-reference profile while preserving unrelated custom limits, and align Seedance submission with the Videos API.
- Recognize Seedance capabilities for OpenAI Videos model profiles in both frontend and backend validation.

## v1.6.3

- Preserve explicit first/last-frame roles and adaptive aspect ratios for Seedance 2.5, including official model aliases and BeefAPI Enterprise requests.
- Keep reference generation distinct from frame, edit and extension constraints; retain explicitly selected reference and extension modes.
- Add a supported-mode selector to the professional video canvas and explain when output parameters follow input media.
- Explain nested TaskTypeConstraint failures with actionable guidance and retain the same message and diagnostic IDs after task reload.

## v1.6.2

- Retire the unfinished built-in Agent product surface: the canvas dock, creation entry, home capability card, Agent query parameters, Agent settings and the `/agent/*` API are no longer reachable, so partially working Agent flows can no longer be entered by mistake.
- Enforce the retirement at the product boundary: generic task creation, task retry and the task worker refuse `cloud_agent`, `cloud_agent_step` and `agent_memory_compact` work instead of executing it as an ordinary paid text generation, and the periodic Agent memory compaction no longer runs in the background.
- Keep historical Agent runs, profiles, memories and tasks in place with no destructive migration.
- Manual creation and generation keep their existing authorization, quoting, approval, idempotency and cancellation behaviour on the canvas and in the creation workspace; canvas editing and connections, projects, assets, local storage, model channels, the built-in BeefAPI connection and the v1.6.0 depth workflow are unchanged. The retired Agent approval and memory endpoints are removed together with the rest of `/agent/*`.
- Remove the unused local `AgentPort` wiring, the test-only `generation.Engine`/`Deps` wrapper that had no production caller, and the unreferenced experimental `cmd/mcp` stdio entry.
- Simplify the core CI gates to the checks that guard the local product surface.
## v1.6.1

- Explain input and output moderation failures by text, image, video and audio, including copyright, privacy and counterfeit-content restrictions.
- Preserve specific failure guidance and request IDs when reloading task history; avoid attributing general moderation failures to real-person references.
- Distinguish upstream billing problems, configured usage limits, concurrency limits and model permissions, including errors wrapped in generic request codes.
- Keep uncertain submissions and unchanged moderation failures from automatically generating another request.

## v1.6.0

- Add depth action capture to the canvas video-processing menu on Apple Silicon Macs, with an optional local runtime and separately cached Small model weights.
- Download and verify depth components from the BeefTV release, with a Hugging Face fallback for model weights and visible task progress.
- Keep video first-frame posters visible until hover playback presents a decoded frame, preventing black flashes when playback starts or stops.
- Preserve current generation, reference-media, desktop-update, and task-retry contracts while integrating the new workflow.

## v1.5.9

- Validate reference image dimensions, aspect ratios, file sizes and audio/video duration using each model's configured capabilities before submitting.
- Preserve supported reference counts, resolutions and durations instead of silently dropping media or downgrading requested settings.
- Support local and inline reference audio for BeefAPI and native Ark channels, while retaining provider-specific audio-only rules.
- Show actionable reference conversion and request-size errors in both canvas nodes and task history, with safe diagnostics and no unsafe unchanged retries.

## v1.5.8

- Add a persistent light/dark switch to the workspace sidebar, with matching home, asset library, menus and settings surfaces.
- Restore canvas appearance controls with light, dark and custom modes; keep each canvas appearance independent from the workspace theme.
- New canvases follow the workspace theme unless an explicit default appearance is saved.

## v1.5.7

- Desktop update checks and downloads now use Cloudflare-hosted files, preserving signed manifests and package integrity verification.
- Publish immutable platform packages before switching the update feed, with verified downloads and protection against incomplete or older releases.
- Check Seedance reference audio total duration and explain gateway media validation failures with the affected clip and actionable limits.

## v1.5.6

- Validate Seedance reference audio/video duration before submission and preserve duration metadata for character voice samples.
- Explain material conversion failures with actionable duration limits and retain request identifiers for support.
- Keep existing task polling available and prevent unsafe resubmission while provider acceptance is uncertain.

## v1.5.5

- Desktop update checks and downloads now use the current user's static HTTP/HTTPS system proxy on macOS and Windows when no explicit environment proxy is configured.
- Keep a manual update check in the sidebar and show a retry action when checking fails, instead of hiding connection failures.
- Preserve proxy bypass rules, signed manifest verification and package integrity checks throughout redirected downloads.

## v1.5.4

- Generation failures now explain the cause and the next action across canvas nodes, task history and custom channels.
- Distinguish content moderation, account quota, provider billing, invalid parameters, rate limits, uncertain submissions and failed result downloads without guessing refunds or the offending input.
- Preserve safe error codes and request identifiers for support, including business errors returned with HTTP 200 and JSON errors inside media downloads.
- Prevent unsafe unchanged batch retries; edited prompts and reference media can be submitted as new attempts after moderation failures.
- Cover all 42 currently declared BeefAPI error codes with a shared frontend and backend regression contract.
- Improved the shared model picker with a viewport-safe, internally scrollable layout and consistent single-line model options.
- Removed redundant model icons, secondary descriptions, and stale option backgrounds from model selection UI.
- Restored native right-click paste behavior in canvas prompt editors and added regression coverage.
- Added regression coverage for generation output delivery, model picker overflow, and local generation error handling.
- Added a canonical local app update script to keep one installed BeefTV application instead of accumulating duplicate builds.

## v1.5.3

- Desktop builds show the installed version in the sidebar and check for published updates on startup.
- Signed updates can be downloaded in the app, then installed with an explicit restart while keeping local projects, assets, settings and connections.
- Pending canvas, director and timeline saves are checked before restarting; failed downloads or verification leave the current installation intact.
- Maintainers can build and publish signed macOS and Windows update packages from main. Existing installations need one manual upgrade to this version before in-app updates are available.

## v1.5.2

- Improved canvas node rendering and inline image cropping, annotation, and local redraw interactions.
- Rebuilt the recycle bin with a fixed two-row viewport, selection, recovery, and confirmed permanent deletion.
- Fixed project cover selection across media nodes and canvases, including fallbacks and centered empty placeholders.
- Added a short product demo and updated the README branding.

## v1.5.1

- Initial public BeefTV snapshot.
- Local-first AI video workspace with image, video, audio, text, asset, canvas, and model-channel workflows.
- BeefAPI remains a built-in local channel while its model catalog is discovered dynamically.
