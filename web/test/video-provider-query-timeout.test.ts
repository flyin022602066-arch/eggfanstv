import { expect, test } from "bun:test";
import { apiClient } from "@/services/api/request";
import { queryFailedVideoProviderTask } from "@/services/api/task-center";

test("video result retrieval gets the recovery lease budget instead of the default four seconds", async () => {
    const previous = apiClient.defaults.adapter;
    let calls = 0;
    apiClient.defaults.adapter = async config => {
        calls += 1;
        expect(config.method).toBe("post");
        expect(config.url).toBe("/tasks/original-video/query-provider");
        expect(config.timeout).toBe(10 * 60 * 1000);
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, data: { recovered: true, providerStatus: "succeeded", task: { id: "original-video", status: "succeeded" } } } };
    };
    try {
        expect((await queryFailedVideoProviderTask("original-video")).recovered).toBe(true);
        expect(calls).toBe(1);
        expect(apiClient.defaults.timeout).toBe(4_000);
    } finally { apiClient.defaults.adapter = previous; }
});
