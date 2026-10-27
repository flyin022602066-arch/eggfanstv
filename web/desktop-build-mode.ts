export function resolvePackagedWindowsBuild(command: string, mode: string, platform: string) {
    return command === "build" && mode === "desktop" && platform === "win32";
}
