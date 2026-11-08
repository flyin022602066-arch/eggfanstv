import { dirname, resolve } from "node:path";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { resolveHeavyMediaEnabled } from "./media-build-mode";
import { resolvePackagedWindowsBuild } from "./desktop-build-mode";

const webDir = dirname(fileURLToPath(import.meta.url));
const appVersion = process.env.CANVAS_BUILD_VERSION?.trim() || readFileSync(resolve(webDir, "../VERSION"), "utf8").trim();
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET?.trim() || "http://127.0.0.1:8080";
const desktopLaunchToken = process.env.VITE_DESKTOP_LAUNCH_TOKEN?.trim();
const heavyMediaEnabled = resolveHeavyMediaEnabled(process.env.BEEFTV_FULL_MEDIA_RESOURCES);
const shikiWasmModuleId = "virtual:beeftv-shiki-onig-wasm";
const resolvedShikiWasmModuleId = `\0${shikiWasmModuleId}`;

// Shiki's browser bundle base64-inlines WASM; emit it separately to keep JS chunks lean.
function shikiWasmAssetPlugin(command: "build" | "serve"): Plugin {
    const wasmModulePath = resolve(webDir, "node_modules/@shikijs/engine-oniguruma/dist/wasm-inlined.mjs");
    const wasmModule = readFileSync(wasmModulePath, "utf8");
    const encodedWasm = wasmModule.match(/Uint8Array\.from\(atob\("([^"]+)"\)/)?.[1];
    if (!encodedWasm) throw new Error("Unable to extract Shiki Oniguruma WebAssembly payload");
    const wasmBytes = Buffer.from(encodedWasm, "base64");
    let wasmReference: string | undefined;

    return {
        name: "beeftv-shiki-wasm-asset",
        resolveId(source: string) {
            if (source === shikiWasmModuleId) return resolvedShikiWasmModuleId;
        },
        buildStart() {
            if (command === "build") wasmReference = this.emitFile({ type: "asset", name: "shiki-onig.wasm", source: wasmBytes });
        },
        load(id: string) {
            if (id !== resolvedShikiWasmModuleId) return null;
            if (command === "serve") return 'export default "/__beeftv-shiki-onig.wasm";';
            if (!wasmReference) throw new Error("Shiki WebAssembly asset was not emitted");
            return `export default import.meta.ROLLUP_FILE_URL_${wasmReference};`;
        },
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                if (request.url?.split("?")[0] !== "/__beeftv-shiki-onig.wasm") return next();
                response.statusCode = 200;
                response.setHeader("Content-Type", "application/wasm");
                response.setHeader("Content-Length", String(wasmBytes.byteLength));
                response.end(wasmBytes);
            });
        },
    };
}

function pruneOptionalMediaPlugin() {
    return {
        name: "beeftv-prune-optional-media",
        closeBundle() {
            const dist = resolve(webDir, "dist");
            // The retired public welcome site is never part of the application.
            rmSync(resolve(dist, "welcome"), { recursive: true, force: true });
            if (heavyMediaEnabled) return;
            for (const directory of ["mediapipe", "lighting-presets", "three"]) {
                rmSync(resolve(dist, directory), { recursive: true, force: true });
            }
            rmSync(resolve(dist, "canvas/models/blaze-face-full-range-sparse.tflite"), { force: true });
            const staticDir = resolve(dist, "static");
            for (const file of readdirSync(staticDir)) {
                if (file.startsWith("ffmpeg-core-")) rmSync(resolve(staticDir, file), { force: true });
            }
        },
    };
}

export default defineConfig(({ command, mode }) => ({
    plugins: [shikiWasmAssetPlugin(command), react(), pruneOptionalMediaPlugin()],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        __BEEFTV_HEAVY_MEDIA_ENABLED__: JSON.stringify(heavyMediaEnabled),
        __BEEFTV_PACKAGED_WINDOWS__: JSON.stringify(resolvePackagedWindowsBuild(command, mode, process.platform)),
        "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    },
    server: {
        proxy: {
            "/api": {
                target: apiProxyTarget,
                changeOrigin: true,
                xfwd: true,
                ...(desktopLaunchToken ? { headers: { "X-Desktop-Token": desktopLaunchToken } } : {}),
            },
        },
    },
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    build: {
        // Keep the SPA route `/assets` distinct from Vite's emitted static files.
        // Otherwise vite preview treats `/assets` as the physical asset directory
        // and a direct refresh of the asset library can return 404.
        assetsDir: "static",
        rolldownOptions: {
            output: {
                strictExecutionOrder: true,
                codeSplitting: {
                    // Keep route-level lazy imports isolated. Recursively merging dependencies
                    // pulls unrelated pages into the initial modulepreload graph.
                    includeDependenciesRecursively: false,
                    minSize: 40 * 1024,
                    maxSize: 450 * 1024,
                    groups: [
                        {
                            name: "canvas-runtime",
                            test: /src[\\/]components[\\/]canvas[\\/]|src[\\/]pages[\\/]canvas[\\/](?!project\.tsx$)|src[\\/]lib[\\/]canvas[\\/]|src[\\/]lib[\\/]art-critique[\\/]|src[\\/]services[\\/]canvas[^\\/]*|src[\\/]stores[\\/]canvas[\\/]/,
                            minSize: 0,
                            maxSize: 450 * 1024,
                            entriesAware: true,
                            priority: 35,
                        },
                        {
                            name: "vendor-three",
                            test: /node_modules[\\/]three[\\/]/,
                            minSize: 0,
                            maxSize: 450 * 1024,
                            entriesAware: true,
                            priority: 25,
                        },
                        {
                            name: "vendor-leafer",
                            test: /node_modules[\\/](?:@leafer(?:-ui)?[\\/][^\\/]+|leafer-ui)[\\/]/,
                            minSize: 0,
                            maxSize: 450 * 1024,
                            entriesAware: true,
                            priority: 24,
                        },
                        {
                            name: "vendor-charts",
                            test: /node_modules[\\/](?:recharts|decimal\.js-light)[\\/]/,
                            minSize: 0,
                            maxSize: 450 * 1024,
                            entriesAware: true,
                            priority: 23,
                        },
                        {
                            name: "vendor-state",
                            test: /node_modules[\\/](?:@reduxjs[\\/]toolkit|immer|react-redux|reselect)[\\/]/,
                            minSize: 0,
                            maxSize: 450 * 1024,
                            entriesAware: true,
                            priority: 22,
                        },
                        {
                            name: "vendor-shiki-languages",
                            test: /node_modules[\\/]@shikijs[\\/]langs[\\/]/,
                            minSize: 0,
                            maxSize: 450 * 1024,
                            entriesAware: true,
                            priority: 18,
                        },
                        {
                            name: "vendor-pako",
                            test: /node_modules[\\/]pako[\\/]/,
                            minSize: 0,
                            maxSize: 450 * 1024,
                            entriesAware: true,
                            priority: 17,
                        },
                        {
                            // Shared interop helpers must not be emitted into a route entry:
                            // AntD would import that entry back and execute its bootstrap early.
                            name: "vendor-babel-runtime",
                            minSize: 0,
                            test: /node_modules[\\/]@babel[\\/]runtime[\\/]/,
                            priority: 40,
                        },
                        {
                            name: "vendor-react",
                            test: /node_modules[\\/](?:react(?:-dom|-router|-router-dom)?|scheduler|zustand|use-sync-external-store|@tanstack[\\/](?:query-core|react-query))[\\/]/,
                            priority: 30,
                        },
                        {
                            name: "vendor-icons",
                            test: /node_modules[\\/](?:lucide-react|@ant-design[\\/]icons)[\\/]/,
                            priority: 20,
                            entriesAware: true,
                            entriesAwareMergeThreshold: 48 * 1024,
                        },
                        {
                            name: "vendor-antd",
                            test: /node_modules[\\/](?:antd|@ant-design|@rc-component|rc-[^\\/]+|dayjs)[\\/]/,
                            priority: 10,
                            entriesAware: true,
                            entriesAwareMergeThreshold: 80 * 1024,
                        },
                    ],
                },
            },
        },
    },
}));
