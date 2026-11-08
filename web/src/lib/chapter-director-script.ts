export type ChapterDirectorShot = {
    durationSeconds: number;
    camera: string;
    start: string;
    performance: string;
    focusAndLight: string;
    end: string;
    sound: string;
};

export type ChapterDirectorScript = {
    setting: string;
    shots: ChapterDirectorShot[];
    ending: string;
};

const shotTextFields = ["camera", "start", "performance", "focusAndLight", "end", "sound"] as const;

function object(value: unknown, location: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} 必须是对象`);
    return value as Record<string, unknown>;
}

function text(value: unknown, location: string): string {
    if (typeof value !== "string") throw new Error(`${location} 必须是文本`);
    return value;
}

// 只排版模型首次返回的逐镜内容；不生成、补齐或改写任何表演和台词。
export function compileChapterDirectorScript(value: unknown, rowNumber: number) {
    const location = `第 ${rowNumber} 段`;
    const source = object(value, `${location}的 directorScript`);
    if (!Array.isArray(source.shots) || !source.shots.length) throw new Error(`${location}的 directorScript.shots 必须是非空数组`);
    const directorScript: ChapterDirectorScript = {
        setting: text(source.setting, `${location}的 setting`),
        shots: source.shots.map((value, index) => {
            const label = `${location}镜头${index + 1}的`;
            const shot = object(value, label);
            if (typeof shot.durationSeconds !== "number" || !Number.isFinite(shot.durationSeconds)) throw new Error(`${label} durationSeconds 必须是有限数字`);
            return {
                durationSeconds: shot.durationSeconds,
                ...Object.fromEntries(shotTextFields.map((field) => [field, text(shot[field], `${label} ${field}`)])) as Pick<ChapterDirectorShot, typeof shotTextFields[number]>,
            };
        }),
        ending: text(source.ending, `${location}的 ending`),
    };
    return {
        directorScript,
        videoMotionPrompt: [
            `整体设定：${directorScript.setting}`,
            ...directorScript.shots.map((shot, index) => `镜头${index + 1}：${shot.camera}\n起幅：${shot.start}\n过程：${shot.performance}\n光学与光影：${shot.focusAndLight}\n→ 落幅：${shot.end}\n声音：${shot.sound}`),
            `结尾约束：${directorScript.ending}`,
        ].join("\n\n"),
        timeBeats: directorScript.shots.map((shot, index) => `镜头${index + 1}：${shot.end}`).join("\n"),
    };
}

export function chapterDirectorScriptContent(script: ChapterDirectorScript): string {
    return [script.setting, ...script.shots.flatMap((shot) => shotTextFields.map((field) => shot[field])), script.ending].join("\n");
}

export function reviewChapterDirectorTiming(script: ChapterDirectorScript, durationSeconds: number, maxSeconds: number): string[] {
    const issues: string[] = [];
    const durations = script.shots.map((shot) => shot.durationSeconds);
    durations.forEach((seconds, index) => {
        if (seconds < 1 || seconds > maxSeconds) issues.push(`镜头${index + 1} 时长 ${seconds} 秒，需在 1–${maxSeconds} 秒内`);
        const missing = shotTextFields.filter((field) => !script.shots[index]![field].trim());
        if (missing.length) issues.push(`镜头${index + 1} 缺少逐镜内容：${missing.join("、")}`);
    });
    const total = Math.round(durations.reduce((sum, seconds) => sum + seconds, 0) * 100) / 100;
    if (Math.abs(total - durationSeconds) > 0.01) issues.push(`内部镜头合计 ${total} 秒，应为 ${durationSeconds} 秒`);
    if (durations.filter((seconds) => seconds >= 1 && seconds <= 3).length <= durations.length / 2) issues.push("内部镜头未以 1–3 秒为主，需核对快切节奏");
    return issues;
}

export function chapterDirectorScriptOutputContract(requirement: string): string {
    return [
        "【受保护输出契约】",
        "【首次拆解：结构化逐镜详稿】",
        `只返回一个JSON对象 {\"title\":string,\"rows\":object[]}。${requirement}`,
        "每条row仍是一个30秒生成单元，shotNumber从1递增。先一次写完directorScript，再摘录辅助字段；不要先写摘要再用摘要代替导演稿。",
        '每条row首先填写：shotNumber、durationSeconds=30、directorScript={"setting":string,"shots":[{"durationSeconds":number,"camera":string,"start":string,"performance":string,"focusAndLight":string,"end":string,"sound":string}],"ending":string}。shots每项是一次真实内部切角，按拍摄顺序逐项完整展开，不能合并成阶段或用“同上、其余类推”省略。',
        "setting锁定现场、人物世界位置与轴线、背景锚点、时间及统一主光；shots.durationSeconds是每镜独立的时长核算数据，通常1–3秒、最长4秒，合计必须为30，以1–3秒为主通常10–15镜，8只是数学底线。只有2–7镜的30秒段不符合要求。数字时长仅写在此字段，所有正文不写秒数或时间码，编排不得空档、重叠或重复动作。",
        "camera：当前景别、机位高度/角度、焦段与构图，一种主运镜的触发、方向和停止点；对白角度以切入清晰、随表演微推进、落点稳住为主，固定镜有具体构图目的。",
        "start：承接前镜当前动作相位、人物位置、手别与持物的可见起幅。performance：本镜实际发生的动作发起、重心/接触反馈、表演过程、明确目光对象及画内外方向、对手反应；不能只填情绪名词或动作结果。focusAndLight：当前焦平面、景深与注意力转移的依据，以及同一世界光源在脸上塑出的眼窝/颧骨/下颌层次和暗侧肤质，不只填‘背景虚化、光线统一’。",
        "end：变化后的具体落幅、触发下一切角的信息或动作接点。sound：当前声源、真实说话人、逐字原话及场景语速、情绪重音与自然气口；长句跨切用同一声轨延续，不重读、不串听者口型。无台词镜写现有动作声或原声延续，不补新台词。ending只收束连续性风险，不另加剧情。",
        "每1–3个主说话人角度穿插同现场听者、关系或有叙事作用的环境细节；切角不换地点。一个短镜一个表演重点，摄影、面部光影、呼吸和动作同时发生，描写细致不等于动作依次等待。",
        "每条row的setting、逐镜六项正文与ending合计约1000–2000字。setting通常60–120字，每镜六项合计通常80–140字，不是每项80–140字；机位与光学各一句短句，起幅与落幅各一个动作节点，表演只写一个变化。全场站位、服装、主光和禁令不逐镜重述，关键近景再补具体面部塑形；无变化的属性沿用setting。此目标不是对白上限，也不是整集总字数，不删原话或关键剧情；避免三四千字的重复解释。普通叙述不新增朗读声轨，明确OS原话及已确认旁白照常保留。",
        "本格式的directorScript就是界面‘镜头与表演’的唯一主稿来源，应用只按顺序排版原文，不会补造镜头或代写细节。不要另写videoMotionPrompt或timeBeats，避免生成两份不一致脚本。首帧imageGenerationPrompt只摘自第一镜的静态起幅；dialogue逐字收集同一声轨的原话，每个实际话轮按原顺序记录一次，同句的不同话轮不去重。",
        "其余必填字段：sceneAssetId、sceneName、sceneChange（布尔）、propNames（数组）、assetBindings（真实资产id的[{nodeId,role,priority}]）、characters（实际可见角色，数组每项为{characterName:string,characterAssetId:string,characterVersionId:string}）、plotDescription、dialogue、imageGenerationPrompt、continuityOut、systemElements（原文数组，没有为[]）。角色造型沿用提供的真实characterVersionId；对白提及不等于出镜。已有场景的sceneAssetId必须填写白名单真实ID，sceneName沿用其标准名称；确无对应场景才留空ID并写准确地点，不借其他场景冒充。每段独立绑定场景，道具亦沿用白名单，转场只在单元边界。",
        "narrativeIntent、viewerPOV、performanceBlocking、shotSize、emotion、lightingAndAtmosphere、audioEffects、camera、motion、negativePrompt、mustHave、optionalDetails仅需摘记已有设计，缺省可省略；不得在辅助字段另编剧情或挤占主稿。除明确的数字、布尔、数组和directorScript对象外字段均为字符串。",
        "在首次回复提交完整JSON前核对：每镜有六项可执行内容；时长符合1–3秒为主/最长4秒且合计30；对白逐字、人物眼线和动作接续、具体光学光影落实；每条主稿密度达标。不要返回分析、模板占位、示例剧情或待补写提纲。",
    ].join("\n");
}
