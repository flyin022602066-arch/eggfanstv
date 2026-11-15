export type ShotCameraLanguage = {
    shotSize: string;
    cameraAngle: string;
    cameraMovement: string;
};

type CameraRule = readonly [RegExp, Readonly<Record<string, string>>];

const cameraRules: Record<keyof ShotCameraLanguage, CameraRule> = {
    shotSize: [/大特写|极特写|特写|中近景|近景|中远景|中全景|中景|大全景|全景|大远景|远景/gu, {}],
    cameraAngle: [/过肩|平视|平拍|眼平|俯拍|俯视|仰拍|仰视|顶拍|正面|侧面|侧拍|背面|背拍|高机位|低机位/gu, { 平拍: "平视", 眼平: "平视", 俯视: "俯拍", 仰视: "仰拍", 侧拍: "侧面", 背拍: "背面" }],
    cameraMovement: [/固定机位|固定镜头|固定镜|固定|静止机位|机位锁定|锁定机位|推镜|推近|推进|前推|前移|微推|缓推|拉镜|拉远|后拉|后移|横摇|摇镜|摇摄|上摇|下摇|横移|侧移|移镜|跟拍|跟镜|随拍|环绕|绕拍|环拍|升镜|降镜|升降/gu, {
        固定机位: "固定", 固定镜头: "固定", 固定镜: "固定", 静止机位: "固定", 机位锁定: "固定", 锁定机位: "固定",
        推近: "推镜", 推进: "推镜", 前推: "推镜", 前移: "推镜", 微推: "推镜", 缓推: "推镜",
        拉远: "拉镜", 后拉: "拉镜", 后移: "拉镜", 横摇: "摇镜", 摇摄: "摇镜", 上摇: "摇镜", 下摇: "摇镜",
        横移: "移镜", 侧移: "移镜", 跟镜: "跟拍", 随拍: "跟拍", 绕拍: "环绕", 环拍: "环绕", 升镜: "升降", 降镜: "升降",
    }],
};

function cameraDescriptions(prompt: string): string[] {
    const shots = [...prompt.matchAll(/(?:^|\n)\s*镜头\s*\d+\s*[:：]([^\n]*)/gu)]
        .map((match) => match[1]!.split(/(?:起幅|过程|光学与光影|落幅|声音)\s*[:：]/u)[0]!);
    if (shots.length) return shots;
    return [...prompt.matchAll(/(?:^|\n)\s*(?:景别|机位(?:角度)?|运镜(?:方式)?)\s*[:：]([^\n]*)/gu)].map((match) => match[1]!);
}

function summarizeCamera(descriptions: readonly string[], [pattern, labels]: CameraRule): string {
    const values: string[] = [];
    for (const description of descriptions) {
        for (const match of description.matchAll(pattern)) {
            if (/(?:不|禁止|避免|无需|不得|不采用|不要)(?:使用|采用|进行)?\s*$/u.test(description.slice(0, match.index))) continue;
            const value = labels[match[0]] || match[0];
            if (values.at(-1) !== value) values.push(value);
        }
    }
    return values.join(" → ");
}

export function resolveShotCameraLanguage(input: Partial<ShotCameraLanguage> & { videoPrompt?: string; cameraDescriptions?: readonly string[] }): ShotCameraLanguage {
    const descriptions = input.cameraDescriptions?.length ? input.cameraDescriptions : cameraDescriptions(input.videoPrompt || "");
    return {
        shotSize: input.shotSize?.trim() || summarizeCamera(descriptions, cameraRules.shotSize),
        cameraAngle: input.cameraAngle?.trim() || summarizeCamera(descriptions, cameraRules.cameraAngle),
        cameraMovement: input.cameraMovement?.trim() || summarizeCamera(descriptions, cameraRules.cameraMovement),
    };
}
