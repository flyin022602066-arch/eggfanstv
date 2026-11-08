import { expect, test } from "bun:test";
import { AxiosError, CanceledError } from "axios";
import { captureUserScope } from "@/lib/user-scope-guard";
import { ApiError, apiClient } from "@/services/api/request";
import { getProjectCore, getProjectUnitWorkspace, listProjectUnits } from "@/services/api/projects";
import { isProjectAccessError, projectReadBlocksView, projectReadErrorDescription, retryProjectRead } from "@/pages/projects/detail/project-workspace-query";

test("cached project reads survive transient errors but uncached reads show a retry state", () => {
    for (const error of [new ApiError("temporary", { status: 503 }), new AxiosError("timeout", "ECONNABORTED"), new AxiosError("offline", "ERR_NETWORK")]) {
        expect(projectReadBlocksView({ isError: true, data: { project: { id: "project" } }, error })).toBe(false);
        expect(projectReadBlocksView({ isError: true, data: undefined, error })).toBe(true);
        expect(projectReadErrorDescription(error)).toContain("重试");
        expect(projectReadErrorDescription(error)).not.toContain("权限");
    }
    expect(projectReadBlocksView({ isError: false, data: { project: {} }, error: null })).toBe(false);
});

test("real access errors block cached project content regardless of error representation", () => {
    for (const status of [401, 403, 404]) {
        for (const error of [new ApiError("denied", { status }), new ApiError("denied", { status: 200, code: status })]) {
            expect(isProjectAccessError(error)).toBe(true);
            expect(projectReadBlocksView({ isError: true, data: { project: {} }, error })).toBe(true);
            expect(retryProjectRead(0, error)).toBe(false);
        }
    }
    for (const reason of ["unauthorized", "forbidden", "not_found"]) {
        const error = new ApiError("denied", { status: 200, code: 40301, reason });
        expect(projectReadBlocksView({ isError: true, data: { project: {} }, error })).toBe(true);
        expect(retryProjectRead(0, error)).toBe(false);
    }
});

test("only transient read failures retry, with a two-retry bound and cancellation preserved", () => {
    for (const error of [new ApiError("busy", { status: 503 }), new ApiError("limited", { status: 429 }), new ApiError("timeout", { cause: new AxiosError("timeout", "ETIMEDOUT") }), new AxiosError("offline", "ERR_NETWORK")]) {
        expect(retryProjectRead(0, error)).toBe(true);
        expect(retryProjectRead(1, error)).toBe(true);
        expect(retryProjectRead(2, error)).toBe(false);
    }
    for (const error of [new ApiError("bad request", { status: 400 }), new DOMException("cancelled", "AbortError"), new CanceledError(), new Error("unexpected")]) {
        expect(retryProjectRead(0, error)).toBe(false);
    }
});

test("project reads allow slow local responses and forward cancellation without changing other API budgets", async () => {
    const previous = apiClient.defaults.adapter;
    const defaultTimeout = apiClient.defaults.timeout;
    const controller = new AbortController();
    const scope = captureUserScope();
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(config.url || "");
        expect(config.timeout).toBe(30_000);
        expect(config.signal).toBe(controller.signal);
        if (config.url?.endsWith("/core")) expect((config as typeof config & { expectedScope: typeof scope }).expectedScope).toEqual(scope);
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, data: { project: { id: "project" }, units: [], unit: { id: "chapter" } }, msg: "" } };
    };
    try {
        await getProjectCore("project", scope, controller.signal);
        await listProjectUnits("project", controller.signal);
        await getProjectUnitWorkspace("project", "chapter", controller.signal);
        expect(requests).toEqual(["/projects/project/core", "/projects/project/units", "/projects/project/units/chapter/workspace"]);
        expect(apiClient.defaults.timeout).toBe(defaultTimeout);
    } finally {
        apiClient.defaults.adapter = previous;
    }
});
