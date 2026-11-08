import { expect, test } from "bun:test";

import { normalizeProjectAssetMentions, projectCharacterAppearances, replaceProjectAssetMention, unresolvedProjectAssetMentions } from "@/lib/project-asset-mentions";

const assets = [{ id: "character", title: "林默" }, { id: "scene", title: "旧屋" }];

test("uses an explicit definition in another prompt field when repairing repeated references", () => {
    const source = "将@[asset:obsolete]定义为<林默>。\n表演：@[asset:obsolete]推门。";
    expect(normalizeProjectAssetMentions("表演：@[asset:obsolete]推门。", assets, source)).toBe("表演：@[asset:character]推门。");
});

test("replacing a broken reference updates every occurrence and preserves all other text", () => {
    const prompt = "将@[asset:missing]定义为<林默>。\n镜头1：@[asset:missing]推门，对白：有人吗？@[asset:scene]保持不变。";
    expect(replaceProjectAssetMention(prompt, "missing", "character")).toBe("将@[asset:character]定义为<林默>。\n镜头1：@[asset:character]推门，对白：有人吗？@[asset:scene]保持不变。");
    expect(replaceProjectAssetMention(prompt, "missing")).toBe("将定义为<林默>。\n镜头1：推门，对白：有人吗？@[asset:scene]保持不变。");
});

test("reports one repair item per invalid ID with its surrounding text", () => {
    const issues = unresolvedProjectAssetMentions("跟随@[asset:missing]，@[asset:missing]走进@[asset:scene]。", assets, ["character"]);
    expect(issues.map((issue) => [issue.assetId, issue.title])).toEqual([["missing", "未识别资产"], ["scene", "旧屋"]]);
    expect(issues[0]!.excerpt).toContain("跟随@[asset:missing]");
});

test("does not treat narrative prose or conflicting definitions as a material mapping", () => {
    const prompt = "将@[asset:missing]定义为<林默>，将@[asset:missing]定义为<旧屋>。";
    expect(normalizeProjectAssetMentions(prompt, assets)).toBe(prompt);
    const prose = "林默走近：@[asset:missing]";
    expect(normalizeProjectAssetMentions(prose, assets)).toBe(prose);
});

const cast = [{ name: "林夏", assetId: "lin" }, { name: "陈默", assetId: "chen" }, { name: "潇潇", assetId: "xiao" }];

test("ordinary sound narration cannot consume the later cast in a single rich text paragraph", () => {
    const characters = ["嬴政", "陈尧", "赵高", "李斯"].map((name) => ({ name }));
    const source = "<p>嬴政躺在龙榻上。他听见殿外的声音。男人跪了下来，这个声音在空荡的殿内显得响亮。“末学后辈陈尧……”沉默在殿内蔓延。陈尧依旧跪在地上。殿外，赵高的声音隐约传来：“陛下龙体怕是撑不过今夜了。”紧接着李斯的声音：“诏书先不要发。”嬴政松开短剑。陈尧抬起头。</p>";
    expect(projectCharacterAppearances(source, characters).map((character) => character.name)).toEqual(["嬴政", "陈尧"]);
});

test("offscreen sound ends at its quotation rather than consuming subsequent visible action", () => {
    expect(projectCharacterAppearances("林夏独坐。声音：陈默（画外音）：“我来了。”潇潇推门进入。", cast).map((character) => character.name)).toEqual(["林夏", "潇潇"]);
});

for (const action of ["摘下手套", "脱掉外套", "褪去手套", "搓了搓手", "揉着手腕", "松开控制", "捏住手套", "面朝结霜的窗站立"]) {
    test(`direct physical action is visual evidence while quoted and reported versions remain mentions: ${action}`, () => {
        const character = { name: "纪昼", assetId: "hero" };
        expect(projectCharacterAppearances(`纪昼${action}。`, [character])).toEqual([character]);
        for (const source of [`旁人提到纪昼${action}。`, `周启说：“纪昼${action}。”`, `纪昼（画外音）：正在${action}。`]) {
            expect(projectCharacterAppearances(source, [character])).toEqual([]);
        }
    });
}

test("explicit scene cast retains silent and passive characters without admitting unrelated names", () => {
    const characters = ["沈昭宁", "陆北辰", "送葬人", "抬轿人", "天道"].map((name) => ({ name }));
    const source = "乱葬岗 夜/外\n出场人物：沈昭宁 陆北辰 送葬人若干 抬轿人若干\n沈昭宁：天道把我劈下界了。";
    expect(projectCharacterAppearances(source, characters).map((item) => item.name)).toEqual(["沈昭宁", "陆北辰", "送葬人", "抬轿人"]);
});

test("quoted cast lists and audio-only entries cannot establish visual presence", () => {
    for (const source of ["林夏说：‘出场人物：陈默、潇潇’", "【资产参考】\n出场人物：陈默、潇潇", "出场人物：陈默（画外音）、潇潇（电话声音）", "出场人物：陈默然"]) {
        expect(projectCharacterAppearances(source, [cast[1]!, cast[2]!])).toEqual([]);
    }
});

for (const description of ["陆北辰胸前虽有旧伤，面色却鲜活如生。", "轿子里坐着南楚将军陆北辰，长发用银簪绾着。", "一顶花轿被面无血色的抬轿人扛出。"]) {
    test(`visible static descriptions and passive actions are not dropped: ${description}`, () => {
        const characters = ["陆北辰", "抬轿人", "林夏"].map((name) => ({ name }));
        const expected = description.includes("抬轿人") ? [characters[1]!] : [characters[0]!];
        expect(projectCharacterAppearances(description, characters)).toEqual(expected);
        for (const source of [`旁人提到${description}`, `林夏：${description}`, `林夏说：“${description}”`]) {
            expect(projectCharacterAppearances(source, characters).filter((character) => character.name !== "林夏")).toEqual([]);
        }
    });
}

test("rich text paragraph and line breaks preserve the boundary between speech and action", () => {
    const source = '<p>林夏：陈默明天回来。<br>潇潇推开门。</p><p>陈默（画外音）：到了。</p>';
    expect(projectCharacterAppearances(source, cast).map((item) => item.name)).toEqual(["林夏", "潇潇"]);
});

for (const action of ["守在训练墙侧面", "仰着头观察横杆", "按停计时器", "向前一步托住同伴的后背"]) {
    test(`visible training actions establish presence without admitting reported dialogue: ${action}`, () => {
        const character = { name: "教练", assetId: "coach" };
        expect(projectCharacterAppearances(`教练${action}。`, [character])).toEqual([character]);
        for (const mention of [`旁人提到教练${action}。`, `林夏说：“教练${action}。”`, `教练（画外音）：我还${action}。`]) {
            expect(projectCharacterAppearances(mention, [character])).toEqual([]);
        }
    });
}

test("training partners remain visible while the classmate's mentioned sister stays offscreen", () => {
    const characters = ["纪昼", "周启", "韩策", "许南枝", "许南乔", "程野"].map((name) => ({ name }));
    const source = "周启守在侧面，神色专注。韩策仰着头，等得有些不耐烦。纪昼坐在垫子上。许南枝坐在纪昼旁边。许南乔给妹妹准备东西，一向恨不得把医务楼一起塞进去。程野穿着训练服。";
    expect(projectCharacterAppearances(source, characters).map((item) => item.name)).toEqual(["纪昼", "周启", "韩策", "许南枝", "程野"]);
});

for (const appearance of ["穿白衣", "戴白帽", "披斗篷", "背书包"]) {
    const character = { name: "苏卉", assetId: "su", aliases: ["卉卉"] };
    test(`basic appearance verb establishes visible character evidence: ${appearance}`, () => {
        for (const identity of ["苏卉", "卉卉", "@[asset:su]"]) {
            expect(projectCharacterAppearances(`${identity}${appearance}。`, [character])).toEqual([character]);
        }
    });

    test(`speech and reference-only appearance verbs cannot establish visibility: ${appearance}`, () => {
        for (const source of [
            `他提到'苏卉${appearance}'。`,
            `他提到苏卉${appearance}。`,
            `林夏：苏卉${appearance}。`,
            `他提到@[asset:su]${appearance}。`,
            `【角色参考】\n苏卉：@[asset:su]\n苏卉${appearance}。`,
            `【资产参考】\n- 苏卉：人物参考：@图片1\n  本镜造型：苏卉${appearance}。`,
        ]) {
            expect(projectCharacterAppearances(source, [character, ...cast])).toEqual(source.startsWith("林夏：") ? [cast[0]!] : []);
        }
    });
}

for (const [source, name] of [["苏卉一怔。", "苏卉"], ["陈默道：我来了。", "陈默"], ["林夏睫毛轻颤。", "林夏"], ["林夏的睫毛微微颤动。", "林夏"]]) {
    test(`natural reactions and actual speakers remain visible: ${source}`, () => {
        const character = { name: name!, assetId: "present" };
        expect(projectCharacterAppearances(source!, [character])).toEqual([character]);
    });

    test(`reported natural reactions and speakers remain mentions only: ${source}`, () => {
        const character = { name: name!, assetId: "mentioned" };
        for (const mention of [`他提到'${source}'。`, `他提到${source}`, `旁人：${source}`, `【资产参考】\n  本镜造型：${source}`]) {
            expect(projectCharacterAppearances(mention, [character])).toEqual([]);
        }
    });
}

test("a natural speech verb does not reveal mentioned characters or audio-only speakers", () => {
    expect(projectCharacterAppearances("陈默道：潇潇一怔。林夏睫毛轻颤。", cast).map((character) => character.name)).toEqual(["陈默"]);
    expect(projectCharacterAppearances("陈默道：‘潇潇一怔。’林夏睫毛轻颤。", cast).map((character) => character.name)).toEqual(["林夏", "陈默"]);
    for (const source of ["林夏听见陈默道：我来了。", "林夏听到陈默答道：我来了。", "林夏独坐。陈默（画外音）道：我来了。", "林夏独坐。陈默在电话那头道：我来了。"]) {
        expect(projectCharacterAppearances(source, cast).map((character) => character.name)).toEqual(["林夏"]);
    }
    expect(projectCharacterAppearances("陈默道具很多。林夏睫毛的颜色。潇潇一事无成。", cast)).toEqual([]);
});

test("appearance evidence ignores reference appendices and names embedded in another person's name", () => {
    for (const source of ["林夏抬头。\n人物参考：潇潇。\n角色定义：陈默。", "林夏推门，潇潇然低着头。", "林夏推门。角色潇潇，女主角。"]) {
        expect(projectCharacterAppearances(source, cast).map((character) => character.name)).toEqual(["林夏"]);
    }
});

test("audio-only speakers and remembered names do not become visual appearances", () => {
    for (const source of ["林夏抬头。陈默（电话另一端）：潇潇还好吗？", "林夏听见陈默的声音。", "林夏在读陈默的信。", "林夏提到陈默，想起潇潇。", "林夏抬头，陈默在电话另一端说道：明天见。", "林夏听见陈默说：潇潇站在门外。"]) {
        expect(projectCharacterAppearances(source, cast).map((character) => character.name)).toEqual(["林夏"]);
    }
});

test("every sentence in a labelled dialogue stays speech rather than inventing a cutaway", () => {
    expect(projectCharacterAppearances("林夏：我昨天见过陈默。陈默站在门边，潇潇靠在窗前。", cast).map((character) => character.name)).toEqual(["林夏"]);
    expect(projectCharacterAppearances("林夏：‘陈默明天见。’陈默推门进入。", cast).map((character) => character.name)).toEqual(["林夏", "陈默"]);
});

test("visible interactions survive speech verbs inside ordinary words", () => {
    for (const source of ["林夏翻开小说，陈默在窗边站立。", "林夏与陈默交谈。", "林夏说完后看向陈默，陈默点头。", "林夏面无表情，陈默的脸出现在屏幕里。"]) {
        expect(projectCharacterAppearances(source, cast).map((character) => character.name)).toEqual(["林夏", "陈默"]);
    }
});

test("generic pronoun aliases cannot establish an invented named identity", () => {
    expect(projectCharacterAppearances("林夏抬头，她推开窗户。", [...cast, { name: "陌生人", assetId: "unknown", aliases: ["她", "女主", "主角"] }]).map((character) => character.name)).toEqual(["林夏"]);
});

test("injected character and compiled image references cannot prove their own appearance", () => {
    for (const appendix of [
        "【角色参考】\n潇潇：@[asset:xiao]",
        "【资产参考】\n\n- 潇潇：人物参考：图片1\n  本镜造型：潇潇站在镜头中央。\n  声音画像：陈默低声说话。\n  镜头台词：潇潇：林夏站在门外。",
        "【资产参考】\n\n- 潇潇：人物参考：@图片1；声音参考：@音频1",
    ]) {
        expect(projectCharacterAppearances(`林夏独坐。\n\n${appendix}`, cast).map((character) => character.name)).toEqual(["林夏"]);
        expect(projectCharacterAppearances(`林夏独坐。\n\n${appendix}\n\n【画面】\n陈默推门进入。`, cast).map((character) => character.name)).toEqual(["林夏", "陈默"]);
    }
    expect(projectCharacterAppearances("@[asset:lin]抬头，@[asset:chen]推门进入。", cast).map((character) => character.name)).toEqual(["林夏", "陈默"]);
});
