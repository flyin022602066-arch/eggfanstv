export type ProjectAssetMentionAsset = { id: string; title: string; category?: string };
export type ProjectAssetMentionIssue = { assetId: string; title: string; excerpt: string };
export const shotAssetPromptFields = ["videoPrompt", "plotDescription", "action", "dialogue", "imagePrompt", "continuityNotes", "negativePrompt", "shotSize", "cameraAngle", "cameraMovement"] as const;

type ProjectCharacterIdentity = { name: string; aliases?: unknown; assetId?: string };

export function projectCharacterAppearances<T extends ProjectCharacterIdentity>(source: string, characters: T[]): T[] {
    const names = (character: T) => [character.name, ...(Array.isArray(character.aliases) ? character.aliases.filter((alias): alias is string => typeof alias === "string" && !/^(?:我|你|他|她|它|他们|她们|它们|主角|男主|女主|男主角|女主角|主人公|说话人|人物|角色)$/u.test(alias.trim())) : [])].map(normalizeName).filter(Boolean);
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const identities = new Map(characters.filter((character) => character.assetId).map((character) => [character.assetId!, character.name]));
    let text = source.normalize("NFKC")
        .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/giu, "\n")
        .replace(/<\/?(?:p|div|li|h[1-6]|span|strong|em|b|i|u)(?:\s[^>]*)?>/giu, "")
        .replace(/^[\t ]*【(?:资产参考|角色参考|场景与道具参考|角色定义|人物定义|本章角色定义)】[^\n]*(?:\n(?![\t ]*【)[^\n]*)*/gmu, "\n")
        .replace(/^[\t ]*(?:[-*][\t ]*)?(?:人物参考|角色参考|角色定义|人物定义|资产定义|素材定义|角色清单|人物清单|声音参考)[：:][^\n]*/gmu, "")
        .replace(/(?:将)?@\[asset:[^\]]+\]\s*定义为\s*(?:<[^<>\n]+>|《[^《》\n]+》|「[^「」\n]+」|[^，,。；;\n]+)/gu, "")
        .replace(/^[\t ]*(?:[-*][\t ]*)?[^@\n：:]+[：:]\s*(?:(?:人物|角色|图片)参考\s*[：:]\s*)?@\[asset:[^\]]+\]\s*$/gmu, "")
        .replace(/@\[asset:([^\]]+)\]/gu, (_token, assetId: string) => identities.get(assetId.trim()) || "");
    const speakerNames = [...new Set(characters.flatMap(names))].sort((left, right) => right.length - left.length).map(escape).join("|");
    if (speakerNames) {
        text = text.replace(new RegExp(`(?:画外音|场外声音|仅声音)[\\t ]*(?:${speakerNames})[\\t ]*[：:][^\\n]*`, "gu"), "\n");
        text = text.replace(new RegExp(`(?:${speakerNames})\\s*[（(][^）)\\n]*(?:画外|场外|电话|旁白|仅声音|未出镜|OS|O\\.S\\.|V\\.O\\.)[^）)\\n]*[）)][^。！？；\\n]*`, "giu"), "\n");
    }
    const audioEnd = "(?=\\n|→|(?:起幅|过程|落幅|动作(?:与表情)?|画面|镜头[0-9]+|结尾约束)[：:]|$)";
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:声音(?:或台词)?|音频台词|对白|台词|旁白|画外音|场外声音|仅声音)[\\t ]*[：:][\\s\\S]*?${audioEnd}`, "gu"), "\n");
    text = text.replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gu, (quote: string, offset: number, original: string) => {
        const value = normalizeName(quote.slice(1, -1));
        return characters.some((character) => names(character).includes(value)) && /照片|画像|肖像|屏幕|影像/u.test(original.slice(Math.max(0, offset - 24), offset)) ? quote.slice(1, -1) : "〈台词结束〉";
    });
    if (speakerNames) {
        text = text
            .replace(new RegExp(`(?:${speakerNames})\\s*(?:在|从)?(?:电话|通话|对讲机|耳机)(?:的)?(?:另一端|那头|里|中)[^\\n]*?(?:〈台词结束〉|(?=\\n|$))`, "giu"), "\n")
            .replace(new RegExp(`((?:听见|听到)\\s*)(?:${speakerNames})(?=\\s*(?:说|问|喊|叫|回答|答道|道\\s*[：:]))`, "giu"), "$1")
            .replace(new RegExp(`((?:${speakerNames}|他|她|旁人)\\s*(?:[（(][^）)\\n]*[）)]\\s*)?)(?:(?:说|问|答|喊|叫)(?:道)?|道)?\\s*[：:][^\\n]*?(?:〈台词结束〉|(?=\\n|$))`, "giu"), "$1〈可见〉");
    }
    text = text.replaceAll("〈台词结束〉", "。");
    text = text
        .replace(/(?:说出|讲出|念出)(?:前半|后半|这|那|一整|下一|前一)?(?:段|句)(?:话|台词|对白)/gu, "〈可见〉")
        .replace(/(?:(?<![小传假学解评论听据])说(?:道)?(?!完|明|服|唱|书|法)|问(?:道)?(?!题|候)|答(?:道)?(?!案)|喊(?:道)?|叫(?:道)?|回应|回答|嘀咕|念叨|解释|叮嘱|提醒|提起|谈起|提到|听说|据说|想起|想念|回想|以为|假设|如果)(?!完)[：:\s]*[^。！？；\n]*/gu, "〈可见〉")
        .replace(/(?:传来|听见|听到|响起)[^。！？；\n]*(?:声音|嗓音|喊声)[^。！？；\n]*/gu, "〈可见〉");
    const declaredCast = new Set([...text.matchAll(/^[\t ]*(?:[△▲]\s*)?(?:出场人物|出场角色|出镜人物|本场人物|人物)\s*[：:]([^\n]+)/gmu)].flatMap((match) => match[1]!
        .replace(/[（(](?![^）)]*(?:画外|场外|电话|旁白|仅声音|未出镜|OS|O\.S\.|V\.O\.))[^）)]*[）)]/giu, "")
        .split(/[\s、，,；;\/|]+/u)
        .filter((entry) => !/画外|场外|电话|旁白|仅声音|未出镜|OS|O\.S\.|V\.O\./iu.test(entry))
        .map((entry) => normalizeName(entry.replace(/[（(][^）)]*[）)]/gu, "").replace(/(?:若干|数名|多名|群演|若干人)$/u, "")))));
    return characters.filter((character) => names(character).some((name) => {
        if (declaredCast.has(name)) return true;
        const pattern = new RegExp(`(?<![a-z0-9])${escape(name)}(?![a-z0-9])`, "giu");
        for (const match of text.matchAll(pattern)) {
            const before = text.slice(0, match.index).split(/[。！？；，,\n]/u).at(-1) || "";
            const after = text.slice(match.index! + match[0].length);
            if (/(?:明天|明日|将来|以后|下一章|下章|次日|假如|如果|尚未|未见|没有|不见|等待|等着|寻找|寻找着)[^。！？；，,\n]*$/u.test(before)) continue;
            if (/^\s*(?:不在|未在|未到|未出现|并未|尚未|没有|不曾|未曾|将会|才会|会在|明天|明日|的(?:父亲|母亲|女儿|儿子|名字|传闻|声音|消息|信|故事|来信))/u.test(after)) continue;
            const action = after.replace(/^[\s）)]+/u, "").split(/[。！？；，,\n]/u)[0] || "";
            const collectiveAction = action.replace(/^(?:们)?(?:(?:也|都|均|皆|依旧|一同|一起|一齐|齐声|齐齐|纷纷|相继|互相|相互|随之|随即|接着|同时|安静地?|静静地?)\s*)+/u, "");
            const physicalAction = /^(?:〈可见〉|正|正在|仍|依然|已经|已|突然|随后|缓缓|慢慢|轻轻|微微|默默|低声|高声|大声|小声|独自|独|一边|一手|双手|身穿|身着|穿|戴|披|背|在|站|坐|躺|卧|走|跑|奔|迈|踏|跨|停|靠|倚|蹲|跪|起|退|转|抬|低|垂|摇|点|伸|收|握|拿|提|抱|扶|推|拉|开|关|举|挥|拔|望|看|注视|凝视|盯|瞥|闭|睁|皱|露|笑|哭|流泪|叹|呼|吸|喘|沉思|愣|怔|惊|颤|打|击|砍|刺|踢|摔|扑|揽|捂|摸|触|碰|拍|递|接|取|拾|掏|翻|读|写|签|吃|喝|吞|咽|咬|嚼|听|等待|等候|出现在|出现|可见|入镜|出镜|交谈|说完|面无表情|面色|脸色|神色|面容|身形|的(?:脸|面容|身影|轮廓|手|眼|头发|背影))/u;
            const expressiveAction = /^(?:守在|仰(?:着|起|头)|按(?:下|住|停|着)|(?:摘|脱|褪|卸)(?:下|去|掉|除|开|手|衣|帽)|(?:搓|揉|捏)(?:了|着|住|紧|手|指)|松(?:开|手)|面(?:朝|向)|向(?:前|后|左|右)(?:一|两|半|迈|走|跨|退|移|挪|伸)|一(?:怔|愣|惊|颤|笑|叹)|(?:的)?(?:睫毛|眉梢|嘴角|嘴唇|指尖|肩膀)(?:轻轻|微微|轻|微)?(?:颤|抖|扬|垂|动|紧|勾))/u;
            const visibleState = /^(?:的)?(?:(?:胸前|胸口|额头|脸上|肩头|身上|手上|身旁)(?:虽|却|仍|还|已|正)?(?:有|留|露|浮现|泛起|缠绕)|呈(?:半?弧形|扇形|一字形|环形)(?:围站|站|围坐|坐)|围站|肩宽|腰窄|面无血色|双目紧闭|昏迷|沉睡|被(?:抬|抱|扶|推|拉|绑|捆)|扛(?:着|出|起|住))/u;
            const placedCharacter = /(?:坐着|躺着|站着|卧着)(?:[^。！？；，,\n]{0,20})$/u.test(before) && /^[\s，,。！？；\n]|^$/u.test(after);
            if (physicalAction.test(collectiveAction) || expressiveAction.test(collectiveAction) || visibleState.test(collectiveAction) || placedCharacter || /(?:看向|望向|对着|注视|凝视|盯着|扶着|拥抱|抱住|拽住|拉住|推向|看见|看到)\s*$/u.test(before) || /照片|画像|肖像|屏幕|影像|回忆画面|闪回画面/u.test(before)) return true;
            if (/^[与和跟、]/u.test(action) && /交谈|对视|并肩|站|坐|走|握手|拥抱|挥手|争吵|推|拉|打/u.test(action)) return true;
            if (normalizeName(source) === name) return true;
        }
        return false;
    }));
}

export function normalizeProjectAssetMentions(prompt: string, assets: ProjectAssetMentionAsset[], declarations = prompt) {
    const catalog = new Map(assets.map((asset) => [asset.id, asset]));
    const names = explicitMentionNames(declarations);
    return prompt.replace(/@\[asset:([^\]]+)\]/gu, (token, rawId: string) => {
        const assetId = rawId.trim();
        if (catalog.has(assetId)) return `@[asset:${assetId}]`;
        const declaredNames = names.get(assetId);
        if (declaredNames?.size !== 1) return token;
        const name = [...declaredNames][0];
        const matches = [...catalog.values()].filter((asset) => (!asset.category || ["character", "environment", "prop"].includes(asset.category)) && normalizeName(asset.title) === name);
        return matches.length === 1 ? `@[asset:${matches[0]!.id}]` : token;
    });
}

export function pruneUnboundGeneratedCharacterReferences(prompt: string, assets: ProjectAssetMentionAsset[], boundAssetIds: string[]) {
    const bound = new Set(boundAssetIds);
    const unbound = assets.filter((asset) => asset.category === "character" && !bound.has(asset.id));
    if (!unbound.length) return prompt;
    const staleNames = new Set(unbound.map((asset) => normalizeName(asset.title)).filter((name) => !assets.some((asset) => bound.has(asset.id) && normalizeName(asset.title) === name)));
    let section = "";
    let staleCompiledRow = false;
    return prompt.split("\n").filter((line) => {
        const heading = line.match(/^[\t ]*【([^】]+)】[\t \r]*$/u);
        if (heading) {
            section = heading[1]!;
            staleCompiledRow = false;
            return true;
        }
        if (section === "角色参考") {
            const row = line.match(/^([^@\r\n：:]+)[：:]@\[asset:([^\]]+)\][\t \r]*$/u);
            if (row && unbound.some((asset) => asset.id === row[2]!.trim() && normalizeName(asset.title) === normalizeName(row[1]!))) return false;
        }
        if (section === "资产参考") {
            const row = line.match(/^- ([^\r\n：:]+)[：:]人物参考[：:]@?图片[1-9][0-9]*(?:；声音参考[：:]@?音频[1-9][0-9]*)?[\t \r]*$/u);
            if (row) {
                staleCompiledRow = staleNames.has(normalizeName(row[1]!));
                return !staleCompiledRow;
            }
            if (staleCompiledRow && /^ {2}(?:本镜造型|声音画像|镜头台词)[：:]/u.test(line)) return false;
        }
        staleCompiledRow = false;
        return true;
    }).join("\n");
}

export function unresolvedProjectAssetMentions(prompt: string, assets: ProjectAssetMentionAsset[], boundAssetIds: string[]): ProjectAssetMentionIssue[] {
    const normalized = normalizeProjectAssetMentions(prompt, assets);
    const bound = new Set(boundAssetIds);
    const catalog = new Map(assets.map((asset) => [asset.id, asset]));
    const issues = new Map<string, ProjectAssetMentionIssue>();
    for (const match of normalized.matchAll(/@\[asset:([^\]]+)\]/gu)) {
        const assetId = match[1]!.trim();
        if (bound.has(assetId) || issues.has(assetId)) continue;
        const position = match.index || 0;
        issues.set(assetId, {
            assetId,
            title: catalog.get(assetId)?.title || "未识别资产",
            excerpt: normalized.slice(Math.max(0, position - 40), position + match[0].length + 40),
        });
    }
    return [...issues.values()];
}

export function replaceProjectAssetMention(prompt: string, assetId: string, replacementAssetId?: string) {
    return prompt.replace(/@\[asset:([^\]]+)\]/gu, (token, rawId: string) => rawId.trim() === assetId
        ? replacementAssetId ? `@[asset:${replacementAssetId}]` : ""
        : token);
}

function explicitMentionNames(prompt: string) {
    const names = new Map<string, Set<string>>();
    const add = (assetId: string, name: string) => {
        const key = assetId.trim();
        const values = names.get(key) || new Set<string>();
        values.add(normalizeName(name));
        names.set(key, values);
    };
    for (const match of prompt.matchAll(/@\[asset:([^\]]+)\]\s*定义为\s*(?:<([^<>\n]+)>|《([^《》\n]+)》|「([^「」\n]+)」|([^，,。；;\n]+))/gu)) {
        add(match[1]!, match[2] || match[3] || match[4] || match[5]!);
    }
    for (const match of prompt.matchAll(/^[\t ]*(?:[-*][\t ]*)?([^@\n：:]+?)[\t ]*[：:][\t ]*(?:(?:人物|角色|场景|道具|图片)参考[\t ]*[：:][\t ]*)?@\[asset:([^\]]+)\][\t ]*$/gmu)) {
        add(match[2]!, match[1]!);
    }
    return names;
}

function normalizeName(value: string) {
    return value.normalize("NFKC").trim().toLocaleLowerCase();
}
