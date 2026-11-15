import { expect, test } from "bun:test";
import { resolveShotCameraLanguage } from "@/lib/shot-camera-language";

test("recovers missing fields from legacy numbered camera headings in order", () => {
    const videoPrompt = "整体设定：屋内。\n镜头1：平视中景，缓慢推进。\n起幅：角色坐在桌前。\n镜头2：俯拍手部特写，固定机位。\n过程：角色递信。";
    expect(resolveShotCameraLanguage({ videoPrompt })).toEqual({ shotSize: "中景 → 特写", cameraAngle: "平视 → 俯拍", cameraMovement: "推镜 → 固定" });
});

test("preserves each explicit field while filling only the missing fields", () => {
    expect(resolveShotCameraLanguage({ shotSize: " 大特写 ", cameraMovement: " 拉镜 ", cameraDescriptions: ["平视中景，缓慢推进"] })).toEqual({ shotSize: "大特写", cameraAngle: "平视", cameraMovement: "拉镜" });
});

test("does not invent defaults or extract camera instructions from acting, dialogue or asset text", () => {
    expect(resolveShotCameraLanguage({ videoPrompt: "镜头1：35mm。起幅：人物推进木箱。\n声音：林默：你去侧面跟拍。\n【角色参考】\n林默：三视图、近景头像" })).toEqual({ shotSize: "", cameraAngle: "", cameraMovement: "" });
    expect(resolveShotCameraLanguage({})).toEqual({ shotSize: "", cameraAngle: "", cameraMovement: "" });
});

test("keeps repeated consecutive camera settings compact without deleting later returns", () => {
    expect(resolveShotCameraLanguage({ cameraDescriptions: ["平拍中景，固定机位", "平视中景，固定", "俯视特写，缓推", "平视中景，固定"] })).toEqual({ shotSize: "中景 → 特写 → 中景", cameraAngle: "平视 → 俯拍 → 平视", cameraMovement: "固定 → 推镜 → 固定" });
});

test("recovers explicitly labelled legacy metadata without treating prohibited moves as instructions", () => {
    expect(resolveShotCameraLanguage({ videoPrompt: "景别：近景\n机位角度：过肩\n运镜方式：不要使用固定机位，缓慢横移" })).toEqual({ shotSize: "近景", cameraAngle: "过肩", cameraMovement: "移镜" });
});
