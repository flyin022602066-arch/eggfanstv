import { describe, expect, test } from "bun:test";
import { parseChapterAssetBreakdown } from "../src/lib/canvas/chapter-asset-breakdown";
import { extractCharacterBreakdownJson, parseCharacterBreakdown } from "../src/lib/canvas/canvas-character-reference";
import type { SystemPresentationSettings } from "../src/lib/chapter-system-presentation";

describe("章节三类资产解析", () => {
    test("保留场景和道具别名供分镜绑定，去除空白与重复项", () => {
        const scene = { name: "文化楼教室", description: "白天的教室", prompt: "空教室全景", aliases: [" 文化楼核心班教室 ", "文化楼核心班教室", ""] };
        const prop = { name: "书包", description: "黑色书包", prompt: "独立书包设定图", aliases: [" 背包 "] };
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [], scenes: [scene], props: [prop] }));
        expect(result.scenes[0]!.aliases).toEqual(["文化楼核心班教室"]);
        expect(result.props[0]!.aliases).toEqual(["背包"]);
    });

    test("章节资产可修复字段名和内容中的非法裸换行，合法转义和正文不变", () => {
        const character = { name: "林夏", aliases: [], role: "主角", appearance: "短发", clothing: "白衬衫", physique: "纤细", personality: "冷静", props: "小夜灯", consistencyPrompt: "保持短发", multiViewPrompt: "正侧背", voiceLanguage: "中文", voiceAge: "青年", voiceTimbre: "清亮" };
        const assets = { characters: [character], scenes: [{ name: "旧屋", description: "旧屋内景", prompt: "旧屋全景\n保留\"轮廓\"与\\路径" }], props: [{ name: "灯", description: "暖色灯", prompt: "小夜灯特写" }] };
        const wrapped = JSON.stringify(assets).replace("林夏", "林\n夏").replace('"props":[', '"\nprops":[').replace("旧屋内景", "旧屋\r\n内景").replace("小夜灯特写", "小夜灯\t特写");
        expect(parseChapterAssetBreakdown(`提取结果：\n\`\`\`json\n${wrapped}\n\`\`\``)).toEqual(assets);
        expect(parseChapterAssetBreakdown(JSON.stringify(assets))).toEqual(assets);
    });

    test("修复裸换行仍不能接受缺字段、截断或其他非法控制字符", () => {
        for (const raw of ['{"characters":[],"scenes":[{"name":"旧\n屋","description":"旧屋","prompt":"全景"}]}', '{"characters":[],"scenes":[],"\nprops":[{"name":"未完', '{"characters":[],"scenes":[],"props":[{"name":"灯","description":"坏\u0000值","prompt":"全景"}]}']) {
            expect(() => parseChapterAssetBreakdown(raw)).toThrow();
        }
    });

    test("截断的资产根对象不能误取其中完整的角色卡或角色数组", () => {
        const character = { name: "林夏", aliases: [], role: "主角", appearance: "短发", clothing: "白衬衫", physique: "纤细", personality: "冷静", props: "小夜灯", consistencyPrompt: "保持短发", multiViewPrompt: "正侧背", voiceLanguage: "中文", voiceAge: "青年", voiceTimbre: "清亮" };
        const card = JSON.stringify(character);
        for (const raw of [`{"characters":[${card},{"name":"未写完`, `{"characters":[${card}],"scenes":[],"props":[`, card, `[${card}]`]) {
            expect(() => parseChapterAssetBreakdown(raw)).toThrow("完整");
        }
        const assets = { characters: [character], scenes: [], props: [{ name: "小夜灯", description: "暖色灯", prompt: "小夜灯特写" }] };
        expect(parseChapterAssetBreakdown(`${card}\n提取结果：\n${JSON.stringify(assets)}`).props).toEqual(assets.props);
    });
    test("无角色章节仍可提取场景和道具", () => {
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [], scenes: [{ name: "车站", description: "空旷站台", prompt: "夜间站台" }], props: [{ name: "信封", description: "牛皮纸信封", prompt: "褐色信封特写" }] }));
        expect(result.characters).toEqual([]);
        expect(result.scenes[0].name).toBe("车站");
        expect(result.props[0].name).toBe("信封");
    });
    test("缺失数组或缺失描述不能静默跳过", () => {
        expect(() => parseChapterAssetBreakdown('{"characters":[]}')).toThrow("缺少");
        expect(() => parseChapterAssetBreakdown('{"characters":[],"scenes":[{"name":"车站"}],"props":[]}')).toThrow("description");
    });
    test("支持围栏 JSON 和无资产章节", () => {
        expect(parseChapterAssetBreakdown('```json\n{"characters":[],"scenes":[],"props":[]}\n```')).toEqual({ characters: [], scenes: [], props: [] });
    });
    test("忽略正文解释但仍校验完整资产对象", () => {
        expect(parseChapterAssetBreakdown('提取结果如下：\n{"characters":[],"scenes":[],"props":[]}\n以上为全部结果。')).toEqual({ characters: [], scenes: [], props: [] });
    });

    test("模型漏提时按原文状态字段补回系统面板道具", () => {
        const source = "【叮——进化系统启动中……】\n【宿主：苏夜】\n【状态：蛋（进度：0%）】\n【形态：幼年】\n【等级：D级觉醒】\n【进化点：0】\n【灵气：0】";
        const result = parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', source);
        expect(result.characters).toEqual([]);
        expect(result.props).toHaveLength(1);
        expect(result.props[0]!.name).toBe("进化系统面板");
        expect(result.props[0]!.description).toContain("【状态：蛋（进度：0%）】");
        expect(result.props[0]!.prompt).toContain("布局");
        expect(result.props[0]!.prompt).toContain("逐镜");
    });

    test("只补界面道具，不为纯播报或普通叙述创建面板", () => {
        for (const source of ["【叮！任务完成，奖励已发放。】", "他只听到系统播报，没有任何面板显示。", "供电系统恢复，队长查看任务进度。", "【任务：回家】"]) {
            expect(parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', source).props).toEqual([]);
        }
    });

    test("显式属性面板无需密集状态字段，正文未明确的造型服从项目画风", () => {
        const result = parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', "苏夜眼前浮现属性面板，信息正逐行亮起。");
        expect(result.props).toHaveLength(1);
        expect(result.props[0]!.name).toBe("系统面板");
        expect(result.props[0]!.prompt).toContain("项目画风");
    });

    test("模型已提取面板时保留其设计，不重复创建或把每条数值拆成资产", () => {
        const panel = { name: "进化系统属性面板", description: "半透明暖金色面板", prompt: "暖金色环形界面，单独展示" };
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [], scenes: [], props: [panel] }), "【叮——进化系统启动中……】\n【宿主：苏夜】\n【等级：D级】");
        expect(result.props).toEqual([panel]);
    });

    test("同一行连续面板字段仍能补提，不要求小说按固定换行", () => {
        const result = parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', "他眼前一亮。【叮——进化系统启动中……】【宿主：苏夜】【状态：蛋】【等级：D级】");
        expect(result.props.map((asset) => asset.name)).toEqual(["进化系统面板"]);
    });

    test("全角方括号状态字段仍识别系统道具，并保留原文格式", () => {
        const source = "［叮——进化系统启动中……］\n［宿主：苏夜］\n［状态：蛋（进度：０％）］\n［等级：Ｄ级］";
        const result = parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', source);
        expect(result.props.map((asset) => asset.name)).toEqual(["进化系统面板"]);
        expect(result.props[0]!.description).toContain("［状态：蛋（进度：０％）］");
    });

    test("无括号的连续宿主属性列表也能补回系统面板", () => {
        const source = "叮——进化系统启动中……\n宿主：苏夜\n\n状态：蛋（进度：0%）\n等级：D级\n进化点：0\n苏夜陷入沉思。";
        const result = parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', source);
        expect(result.props.map((asset) => asset.name)).toEqual(["进化系统面板"]);
        expect(result.props[0]!.description).toContain("状态：蛋（进度：0%）");
        expect(result.props[0]!.description).not.toContain("苏夜陷入沉思");
    });

    test("同一段落夹在叙述中的全角状态列表不会漏掉", () => {
        const source = "苏夜愣住了。［叮——进化系统启动中……］［宿主：苏夜］［形态：幼年］［等级：D级］他连忙查看。";
        const result = parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', source);
        expect(result.props.map((asset) => asset.name)).toEqual(["进化系统面板"]);
    });

    test("普通字段清单不因存在等级和技能就被误判为系统道具", () => {
        const source = "演员报名表\n等级：初级\n技能：骑马\n积分：0\n工作人员核对资料。";
        expect(parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', source).props).toEqual([]);
    });

    test("后文抱怨系统的叙述不会被识别成第二个系统或额外面板", () => {
        const source = "【叮——进化系统启动中……】\n【宿主：苏夜】\n【状态：蛋】\n【等级：D级】\n苏夜崩溃了，哪门子的进化系统，我一颗蛋怎么进化？";
        expect(parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', source).props.map((asset) => asset.name)).toEqual(["进化系统面板"]);
    });

    test("系统资产的生图提示词只提供字段布局，具体数值只保留在原文依据", () => {
        const source = "【进化系统启动中】\n【宿主：苏夜】\n【进化点：1280】\n【灵气：5632】\n【状态：蛋（进度：23.6%）】";
        const [panel] = parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', source).props;
        expect(panel!.description).toContain("23.6%");
        for (const value of ["1280", "5632", "23.6%", "苏夜"]) expect(panel!.prompt).not.toContain(value);
        expect(panel!.prompt).toContain("数值区域留空");
        expect(panel!.prompt).toContain("进化点");
    });
});

const systemSettings: SystemPresentationSettings = {
    mode: "character",
    characterName: "小白",
    characterAppearance: "银白色的小狐狸，圆耳、短腿和一条蓬松尾巴",
    characterVoice: "轻柔明亮的中文普通话，语速平稳",
};
const emptyAssets = '{"characters":[],"scenes":[],"props":[]}';
const systemSource = "【叮——进化系统启动中……】\n【宿主：苏夜】\n【状态：蛋（进度：23.6%）】\n【等级：D级】\n【进化点：1280】\n苏夜低头查看。";
const humanCharacter = {
    name: "苏夜", aliases: ["宿主"], role: "主角", appearance: "黑色短发", physique: "清瘦", clothing: "灰色外套", personality: "谨慎", props: "", consistencyPrompt: "保持短发和外套一致", multiViewPrompt: "全身正面、侧面、背面", voiceLanguage: "中文普通话", voiceAge: "青年", voiceTimbre: "温和清晰",
};

test("角色候选完整保留模型结果，不在解析回填时按正文动作再次删减", () => {
    const characters = ["林夏", "陈默", "潇潇"].map((name) => ({ ...humanCharacter, name, aliases: [] }));
    const result = parseChapterAssetBreakdown(JSON.stringify({ characters, scenes: [], props: [] }), "林夏：陈默明天才回来。");
    expect(result.characters).toEqual(characters);
});

test("完整资产返回保留明确出场的静态男主和被动行动群演", () => {
    const characters = ["沈昭宁", "陆北辰", "送葬人", "抬轿人"].map((name) => ({ ...humanCharacter, name, aliases: [] }));
    const raw = JSON.stringify({ characters, scenes: [], props: [] });
    const source = "乱葬岗 夜/外\n出场人物：沈昭宁 陆北辰 送葬人若干 抬轿人若干\n一顶花轿被面无血色的抬轿人扛出。\n轿子里坐着南楚将军陆北辰，长发用银簪绾着。\n陆北辰胸前虽有旧伤，面色却鲜活如生。\n沈昭宁：天道把我劈下界了。";
    const result = parseChapterAssetBreakdown(raw, source);
    expect(result.characters.map((character) => character.name)).toEqual(["沈昭宁", "陆北辰", "送葬人", "抬轿人"]);
    expect(result.characters).toEqual(characters.slice(0, 4));
});

test("角色候选的别名和角色描述完整回填，由模型规则判定实际出场", () => {
    const characters = [
        { ...humanCharacter, name: "林夏", aliases: ["小夏"] },
        { ...humanCharacter, name: "陈默", aliases: [] },
        { ...humanCharacter, name: "潇潇", aliases: [], role: "潇潇走进门，实际出镜" },
    ];
    const result = parseChapterAssetBreakdown(JSON.stringify({ characters, scenes: [], props: [] }), "小夏低头。回忆画面：陈默在门边等候。");
    expect(result.characters).toEqual(characters);
});

test("静态、昏迷与一次性群演不因缺少主动动作或重复出镜而被本地过滤", () => {
    const characters = ["男主", "昏迷的伤员", "门卫", "抬轿人"].map((name) => ({ ...humanCharacter, name, aliases: [], role: "本章出场" }));
    const raw = JSON.stringify({ characters, scenes: [], props: [] });
    for (const source of ["轿内的人一动不动。", "门外只有一个身影。", "角色均为当前章节模型核对结果。"]) {
        expect(parseChapterAssetBreakdown(raw, source).characters).toEqual(characters);
    }
});

describe("章节资产完整根对象边界", () => {
    const assetObject = { characters: [humanCharacter], scenes: [], props: [{ name: "信封", description: "牛皮纸信封", prompt: "褐色信封特写" }] };
    const assetJson = JSON.stringify(assetObject);

    test("章节提取入口仅接受包含三个数组的完整根对象", () => {
        for (const raw of [JSON.stringify(humanCharacter), JSON.stringify([humanCharacter]), '{"characters":[]}', '{"characters":[],"scenes":[],"props":{}}']) {
            expect(() => extractCharacterBreakdownJson(raw, true)).toThrow();
        }
        expect(extractCharacterBreakdownJson(assetJson, true)).toEqual(assetObject);
    });

    test("跳过前面的角色片段，选择后面完整的三类资产根对象", () => {
        const prefix = [JSON.stringify(humanCharacter), JSON.stringify([humanCharacter]), JSON.stringify({ characters: [humanCharacter] })].join("\n");
        expect(parseChapterAssetBreakdown(`${prefix}\n最终结果：\n${assetJson}`)).toEqual(assetObject);
    });

    test("前有完整示例时采用最后一个完整资产根对象", () => {
        expect(parseChapterAssetBreakdown(`示例：\n${emptyAssets}\n实际提取：\n${assetJson}`)).toEqual(assetObject);
        expect(parseChapterAssetBreakdown(`示例：\n${assetJson}\n实际提取：\n${emptyAssets}`)).toEqual({ characters: [], scenes: [], props: [] });
    });

    test("真实根对象任意位置截断时不能回填前面的完整示例", () => {
        for (let length = 1; length < assetJson.length; length += 1) {
            const raw = `示例：\n${emptyAssets}\n实际提取：\n${assetJson.slice(0, length)}`;
            expect(() => parseChapterAssetBreakdown(raw)).toThrow("完整");
        }
    });

    test("完整闭合的角色数组不能掩盖资产根对象末尾被截断", () => {
        for (const suffix of [",\"scenes\":[", ",\"scenes\":[],\"props\":[", ",\"scenes\":[],\"props\":[]"]) {
            expect(() => parseChapterAssetBreakdown(`{"characters":[${JSON.stringify(humanCharacter)}]${suffix}`)).toThrow("完整");
        }
    });

    test("截断外层中的完整资产对象不能当作根对象捞取", () => {
        for (const raw of [`{"result":${assetJson}`, `[${assetJson}`, `{"characters":[${assetJson}],"scenes":[`]) {
            expect(() => parseChapterAssetBreakdown(raw)).toThrow("完整");
        }
    });

    test("完整包装对象或数组中的嵌套资产对象也不符合根对象合同", () => {
        for (const raw of [JSON.stringify({ result: assetObject }), JSON.stringify([assetObject]), JSON.stringify({ note: assetJson })]) {
            expect(() => parseChapterAssetBreakdown(raw)).toThrow();
        }
    });

    test("最终根对象缺少数组时不能改用前面的有效示例", () => {
        for (const raw of ['{"characters":[]}', '{"characters":[],"scenes":[],"props":null}']) {
            expect(() => parseChapterAssetBreakdown(`示例：\n${assetJson}\n实际提取：\n${raw}`)).toThrow("缺少");
        }
    });

    test("字符串里的括号和转义引号不影响完整根对象边界", () => {
        const assets = { props: [{ name: "信封", description: '标记为 "]}\\{[" 的信封', prompt: '文字 "characters": [] 只是标签' }], scenes: [], characters: [humanCharacter] };
        expect(parseChapterAssetBreakdown(`说明 aliases: []\n\`\`\`json\n${JSON.stringify(assets)}\n\`\`\`\n以上为结果。`)).toEqual(assets);
    });

    test("独立角色提取保留原有角色数组和角色卡合同", () => {
        for (const value of [[humanCharacter], [[humanCharacter]], { characters: [humanCharacter] }, [{ characters: [humanCharacter] }], { characters: { 苏夜: humanCharacter } }]) {
            expect(parseCharacterBreakdown(JSON.stringify(value))).toEqual([humanCharacter]);
        }
    });
});

describe("章节系统角色资产", () => {
    test("明确面板模式与省略参数的现有行为完全一致", () => {
        expect(parseChapterAssetBreakdown(emptyAssets, systemSource, { ...systemSettings, mode: "panel" })).toEqual(parseChapterAssetBreakdown(emptyAssets, systemSource));
    });

    test("真正的系统内容漏提时补回配置角色，不再创建面板道具", () => {
        const result = parseChapterAssetBreakdown(emptyAssets, systemSource, systemSettings);
        expect(result.characters).toHaveLength(1);
        expect(result.characters[0]!.name).toBe("小白");
        expect(result.characters[0]!.appearance).toBe(systemSettings.characterAppearance);
        expect(result.characters[0]!.voiceTimbre).toBe(systemSettings.characterVoice);
        expect(result.props).toEqual([]);
        const definition = JSON.stringify(result.characters[0]);
        for (const value of ["苏夜", "23.6%", "1280", "D级"]) expect(definition).not.toContain(value);
    });

    test.each(["【叮！任务完成，奖励已发放。】", "系统提示：进化点已到账。", "【进化系统启动中】", "苏夜眼前浮现属性面板，信息正逐行亮起。", "宿主：苏夜\n等级：D级\n进化点：0", "他眼前一亮。［叮——进化系统启动中……］［宿主：苏夜］［等级：D级］", "他停下脚步。【叮！任务完成，奖励已发放。】他愣住了。"])("纯播报和系统界面可改编成角色：%s", (source) => {
        const result = parseChapterAssetBreakdown(emptyAssets, source, systemSettings);
        expect(result.characters.map((character) => character.name)).toEqual(["小白"]);
        expect(result.props).toEqual([]);
    });

    test.each(["【恭喜宿主！获得进化点奖励。】", "【警告：宿主生命值不足。】", "【恭喜！奖励已发放。】"])("无面板和提示音的纯口播也保留系统角色：%s", (source) => {
        const result = parseChapterAssetBreakdown(emptyAssets, source, systemSettings);
        expect(result.characters.map((character) => character.name)).toEqual(["小白"]);
        expect(result.props).toEqual([]);
    });

    test("普通叙述、IT 系统、表单字段和孤立任务标签不自动变成角色", () => {
        for (const source of ["", "苏夜走进山谷。", "供电系统恢复，队长查看任务进度。", "系统提示：密码错误，请重新登录。", "管理员打开后台系统面板，检查服务器状态。", "【系统通知：软件更新已完成。】", "演员报名表\n等级：初级\n技能：骑马\n积分：0", "演员报名表\n【等级：初级】\n【技能：骑马】\n【积分：0】", "等级：初级\n技能：骑马", "【任务：回家】"]) {
            expect(parseChapterAssetBreakdown(emptyAssets, source, systemSettings).characters).toEqual([]);
        }
    });

    test("普通 IT 叙述不妨碍另一段真实系统信息的识别", () => {
        const source = `管理员重启服务器并登录后台。\n${systemSource}`;
        expect(parseChapterAssetBreakdown(emptyAssets, source, systemSettings).characters.map((character) => character.name)).toEqual(["小白"]);
    });

    test("角色模式删除模型提取的各种系统界面道具，保留普通道具与场景", () => {
        const ordinaryProps = [
            { name: "信封", description: "牛皮纸信封", prompt: "褐色信封特写" },
            { name: "控制台", description: "机械控制台", prompt: "完整控制台" },
        ];
        const scenes = [{ name: "山谷", description: "幽静山谷", prompt: "山谷全景" }];
        const panels = ["进化系统属性面板", "系统面板", "全息界面", "状态栏"].map((name) => ({ name, description: "旧系统界面", prompt: "旧面板" }));
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [], scenes, props: [ordinaryProps[0], ...panels, ordinaryProps[1]] }), systemSource, systemSettings);
        expect(result.props).toEqual(ordinaryProps);
        expect(result.scenes).toEqual(scenes);
    });

    test("按名称或别名复用配置角色的位置，稳定设定覆盖模型擅改而保留真实人物", () => {
        for (const candidate of [
            { ...humanCharacter, name: " 小白 ", aliases: ["进化系统", "系统"] },
            { ...humanCharacter, name: "进化系统", aliases: [" 小白 ", "系统"] },
        ]) {
            const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [candidate, humanCharacter], scenes: [], props: [] }), systemSource, systemSettings);
            expect(result.characters.map((character) => character.name)).toEqual(["小白", "苏夜"]);
            expect(result.characters[1]).toEqual(humanCharacter);
            const system = result.characters[0]!;
            expect(system.aliases).toContain("进化系统");
            expect(system.aliases).toContain("系统");
            expect(system.aliases).not.toContain("小白");
            expect(system.appearance).toBe(systemSettings.characterAppearance);
            expect(system.physique).toContain(systemSettings.characterAppearance);
            expect(system.voiceTimbre).toBe(systemSettings.characterVoice);
            expect(system.consistencyPrompt).toContain(systemSettings.characterAppearance);
            expect(system.multiViewPrompt).toContain(systemSettings.characterAppearance);
            expect(system.role).not.toBe(humanCharacter.role);
            expect(system.clothing).not.toBe(humanCharacter.clothing);
        }
    });

    test("原名系统、命名系统及面板人物合并为唯一配置角色，保留别名", () => {
        const candidates = [
            { ...humanCharacter, name: "进化系统", aliases: ["进化助手"] },
            { ...humanCharacter, name: "进化系统面板", aliases: [] },
            { ...humanCharacter, name: "系统", aliases: [] },
            { ...humanCharacter, name: "小白", aliases: [] },
        ];
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [humanCharacter, ...candidates], scenes: [], props: [] }), systemSource, systemSettings);
        expect(result.characters.map((character) => character.name)).toEqual(["苏夜", "小白"]);
        expect(result.characters[1]!.aliases).toEqual(expect.arrayContaining(["系统", "进化系统", "进化系统面板", "进化助手"]));
    });

    test("系统别名按现有角色名规则归一化，不重复补提", () => {
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [{ ...humanCharacter, name: "系统", aliases: ["小·白"] }], scenes: [], props: [] }), systemSource, systemSettings);
        expect(result.characters).toHaveLength(1);
        expect(result.characters[0]!.name).toBe("小白");
        expect(result.characters[0]!.aliases).not.toContain("小·白");
    });

    test("系统候选错误继承宿主别名时不吞掉真实人物", () => {
        const system = { ...humanCharacter, name: "系统", aliases: ["宿主"] };
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [system, humanCharacter], scenes: [], props: [] }), systemSource, systemSettings);
        expect(result.characters.map((character) => character.name)).toEqual(["小白", "苏夜"]);
        expect(result.characters[0]!.aliases).not.toContain("宿主");
        expect(result.characters[1]).toEqual(humanCharacter);
    });

    test("配置可完整替换模型遗漏设定的系统占位角色，普通角色仍严格校验", () => {
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [{ name: "系统" }], scenes: [], props: [] }), systemSource, systemSettings);
        expect(result.characters).toHaveLength(1);
        expect(result.characters[0]!.name).toBe("小白");
        expect(() => parseChapterAssetBreakdown(JSON.stringify({ characters: [{ name: "苏夜" }], scenes: [], props: [] }), systemSource, systemSettings)).toThrow("缺少");
        expect(() => parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[{"name":"信封"}]}', systemSource, systemSettings)).toThrow("description");
    });
});
