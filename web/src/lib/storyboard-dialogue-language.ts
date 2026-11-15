export const storyboardDialogueLanguageRule = "【对白语言与译文】外语剧本中的外语原对白是唯一发声文本。紧随外语对白的括号中文翻译只供理解，不是第二句台词；dialogue、videoMotionPrompt、directorScript.shots.sound 及其他声音字段只摘录外语原句，不带中文译文，不改成中文配音，不把译文再做旁白、字幕或新话轮。保持原说话人、原语言、措辞、标点和话轮顺序；完整保留台词不包含重复朗读译文。中文动作、情绪与表演括注（如‘冷漠’‘抬头’）保留到动作或导演说明，不当台词。正常中文剧本及剧本明确要求实际说出的中文台词照常保留，不按项目地域一概删中文。";

function foreignSpeech(text: string) {
    return /\p{L}/u.test(text) && (!/\p{Script=Han}/u.test(text) || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text));
}

function chineseTranslation(text: string) {
    if (!/\p{Script=Han}/u.test(text) || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return false;
    if (/^(?:中文(?:翻译|译文)?|翻译|译文|中译|译)\s*[:：]/u.test(text)) return true;
    return /[。！？!?…][”’"']?$/u.test(text.trim()) && !/^(?:(?:动作|表演|语气|情绪|镜头|音效|舞台说明)\s*[:：]|冷漠|抬头|低头|低声|轻声|大声|耳语|微笑|苦笑|冷笑|笑着|哭着|哽咽|停顿|沉默|叹气|摇头|点头|转身|皱眉|画外音|旁白|他(?:抬|低|转|走|看|望|握|伸)|她(?:抬|低|转|走|看|望|握|伸))/u.test(text.trim());
}

function parenthesisEnd(text: string, start: number) {
    const closing: string[] = [];
    for (let index = start; index < text.length; index++) {
        const character = text[index];
        if (character === "(" || character === "（") closing.push(character === "(" ? ")" : "）");
        else if (character === ")" || character === "）") {
            if (closing.pop() !== character) return -1;
            if (!closing.length) return index + 1;
        }
    }
    return -1;
}

function omitUnquotedTranslations(text: string, spoken: boolean) {
    let result = "";
    let cursor = 0;
    for (let start = 0; start < text.length; start++) {
        if (text[start] !== "(" && text[start] !== "（") continue;
        const end = parenthesisEnd(text, start);
        if (end < 0) continue;
        const prefix = text.slice(cursor, start);
        const line = prefix.slice(prefix.lastIndexOf("\n") + 1);
        const speech = line.slice(Math.max(line.lastIndexOf(":"), line.lastIndexOf("：")) + 1).trim();
        if ((spoken || /(?:声音|台词|对白|画外音|旁白)\s*[:：]/u.test(line)) && foreignSpeech(speech) && chineseTranslation(text.slice(start + 1, end - 1))) {
            result += prefix.trimEnd();
            cursor = end;
        }
        start = end - 1;
    }
    return result + text.slice(cursor);
}

export function omitChineseDialogueTranslations(text: string, options: { unquoted?: boolean } = {}): string {
    const quotes = /"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|(?<![\p{L}\p{N}])'(?:[^'\n]|(?<=\p{L})'(?=\p{L}))*'(?!\p{L})/gu;
    let result = "";
    let cursor = 0;
    for (const match of text.matchAll(quotes)) {
        const start = match.index;
        if (start < cursor) continue;
        const body = omitUnquotedTranslations(match[0].slice(1, -1), true);
        let end = start + match[0].length;
        if (foreignSpeech(body)) {
            while (end < text.length) {
                const next = end + (text.slice(end).match(/^[\t ]*/u)?.[0].length || 0);
                if (text[next] !== "(" && text[next] !== "（") break;
                const closing = parenthesisEnd(text, next);
                if (closing < 0 || !chineseTranslation(text.slice(next + 1, closing - 1))) break;
                end = closing;
            }
        }
        result += text.slice(cursor, start) + match[0][0] + body + match[0].slice(-1);
        cursor = end;
    }
    return omitUnquotedTranslations(result + text.slice(cursor), options.unquoted === true);
}

export function storyboardSourceDialogue(sourceText: string): string[] {
    return [...omitChineseDialogueTranslations(sourceText).matchAll(/(?:^|\n|[：:])\s*(?:“([^”\n]+)”|"([^"\n]+)"|‘([^’\n]+)’|'((?:[^'\n]|(?<=\p{L})'(?=\p{L}))+)'|「([^」\n]+)」|『([^』\n]+)』)/gu)]
        .map((match) => match.slice(1).find((value) => value !== undefined) || "");
}
