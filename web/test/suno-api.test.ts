import { expect, test } from "bun:test";

import { parseSunoReply, SunoApiRejection, sunoBaseUrl } from "../src/services/api/suno";

test("Suno root routes never inherit an OpenAI v1 prefix", () => {
    expect(sunoBaseUrl()).toBe("https://api.eggfans.com");
    expect(sunoBaseUrl("https://api.eggfans.com/v1/")).toBe("https://api.eggfans.com");
    expect(sunoBaseUrl("https://api.eggfans.org/suno")).toBe("https://api.eggfans.org");
    expect(sunoBaseUrl("https://gateway.example/proxy/v1")).toBe("https://gateway.example/proxy");
    expect(() => sunoBaseUrl("https://api.eggfans.com?api_key=fixture")).toThrow();
    expect(() => sunoBaseUrl("https://user:password@api.eggfans.com")).toThrow();
});

test("submission returns a string task ID without inventing a song clip ID", () => {
    const reply = parseSunoReply({ code: "success", data: "1268154180129529857" });
    expect(reply.taskId).toBe("1268154180129529857");
    expect(reply.clips).toEqual([]);
    expect(() => parseSunoReply({ code: "success", data: { task_id: 1268154180129529857 } })).toThrow("精度");
});

test("a successful envelope can contain a failed upstream task", () => {
    const reply = parseSunoReply({ code: "success", data: { task_id: "task", status: "failed", fail_reason: "Fixture rejection" } });
    expect(reply.status).toBe("failed");
    expect(reply.error).toBe("Fixture rejection");
    expect(() => parseSunoReply({ code: "insufficient_quota", message: "Fixture quota" })).toThrow(SunoApiRejection);
});

test("all song outputs survive parsing and remain distinct from the task ID", () => {
    const reply = parseSunoReply({ code: "success", data: { task_id: "task", status: "success", data: [
        { id: "clip-a", title: "A", audio_url: "https://cdn.example/a.mp3", metadata: { duration: 123.5, prompt: "lyrics", tags: "piano" } },
        { clipId: "clip-b", title: "B", cld2AudioUrl: "https://cdn.example/b.mp3", image_url: "javascript:alert(1)" },
    ] } });
    expect(reply.status).toBe("succeeded");
    expect(reply.taskId).toBe("task");
    expect(reply.clips.map((clip) => clip.id)).toEqual(["clip-a", "clip-b"]);
    expect(reply.clips[0].duration).toBe(123.5);
    expect(reply.clips[0].lyrics).toBe("lyrics");
    expect(reply.clips[1].imageUrl).toBeUndefined();
});

test("streaming URLs and partial batch completion do not imply final success", () => {
    expect(parseSunoReply({ code: 200, data: [{ id: "first", status: "complete", audio_url: "https://cdn.example/a.mp3" }, { id: "second", status: "streaming", audio_url: "https://cdn.example/b.mp3" }] }).status).not.toBe("succeeded");
    expect(parseSunoReply({ code: "success", data: { task_id: "task", status: "processing", data: [{ id: "clip", audio_url: "https://cdn.example/partial.mp3" }] } }).status).toBe("running");
});

test("unpublished status shapes are not silently classified as complete", () => {
    const reply = parseSunoReply({ code: 200, data: [] });
    expect(reply.status).toBeUndefined();
    expect(reply.taskId).toBeUndefined();
});

test("batch text tasks aggregate completion and retain non-first failure reasons", () => {
    const entries = [{ task_id: "task-a", status: "success", data: { text: "Verse A" } }, { task_id: "task-b", status: "success", data: { text: "Verse B" } }];
    const complete = parseSunoReply({ code: "success", data: entries });
    expect(complete.status).toBe("succeeded");
    expect(complete.taskId).toBeUndefined();
    expect(complete.taskIds).toEqual(["task-a", "task-b"]);
    expect(parseSunoReply({ code: "success", data: [entries[0], { ...entries[1], status: "processing" }] }).status).toBe("running");
    const rejected = parseSunoReply({ code: "success", data: [entries[0], { ...entries[1], status: "failed", fail_reason: "Fixture second task rejected" }] });
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toBe("Fixture second task rejected");
});

test("persistable results and error text exclude echoed channel credentials", () => {
    const secret = "synthetic-secret-key";
    const reply = parseSunoReply({ code: "success", data: { task_id: "task", status: "failed", fail_reason: `Rejected ${secret}`, api_key: secret, headers: { Authorization: secret } } }, secret);
    expect(reply.error).not.toContain(secret);
    expect(JSON.stringify(reply)).not.toContain(secret);
    expect(reply.error).toContain("Rejected");
});

test("fetch decodes Base64 UTF8 and string JSON without losing paid song outputs", () => {
    const songs = [{ id: "clip-a", title: "原创音乐", audio_url: "https://cdn.example/a.mp3" }, { id: "clip-b", audio_url: "https://cdn.example/b.mp3" }];
    for (const data of [JSON.stringify(songs), Buffer.from(JSON.stringify(songs)).toString("base64")]) {
        const reply = parseSunoReply({ code: "success", data: { task_id: "1268154180129529857", status: "success", data } });
        expect(reply.clips.map((clip) => clip.id)).toEqual(["clip-a", "clip-b"]);
        expect(reply.clips[0].title).toBe("原创音乐");
        expect(reply.status).toBe("succeeded");
    }
    expect(() => parseSunoReply({ code: "success", data: { status: "success", data: btoa('{"code":401,"msg":"401"}') } })).toThrow(SunoApiRejection);
});
