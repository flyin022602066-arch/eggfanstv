import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

from windows_utf8_manifest import enable_utf8_manifest


PRIVATE_FILE_NAMES = {'.env', '.env.local', '.settings-key'}
PRIVATE_FILE_SUFFIXES = {'.key', '.pem', '.p12', '.pfx'}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def collect_runtime_tree(sources, source_root):
    required = {
        'agent-host/server.mjs': source_root / 'agent-host' / 'server.mjs',
        'agent-host/runtime/node.exe': source_root / 'agent-host' / 'runtime' / 'node.exe',
        'cli/beeftv.exe': source_root / 'cli' / 'beeftv.exe',
    }
    for name, source in required.items():
        if not source.is_file() or source.stat().st_size == 0:
            raise ValueError('Required release input missing: ' + name)
    for directory in ('agent-host', 'cli'):
        tree = source_root / directory
        for source in sorted(tree.rglob('*')):
            if not source.is_file():
                continue
            if source.name in PRIVATE_FILE_NAMES or source.suffix.lower() in PRIVATE_FILE_SUFFIXES:
                continue
            name = source.relative_to(source_root).as_posix()
            sources[name] = source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--executable', required=True, type=Path)
    parser.add_argument('--plugins', required=True, type=Path)
    parser.add_argument('--tools', required=True, type=Path)
    parser.add_argument('--notices', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    archive_path = destination.parent / (destination.name + '.zip')
    if destination.exists() or archive_path.exists():
        raise ValueError('Output already exists; choose a new release directory')
    sources = {'EggfansTV.exe': args.executable}
    for name in ['ffmpeg.exe', 'ffprobe.exe']:
        sources['.local/tools/ffmpeg/' + name] = args.tools / 'ffmpeg' / name
    whisper = args.tools / 'whisper'
    for name in ['whisper-cli.exe', 'ggml-base.bin', 'whisper.dll', 'ggml.dll', 'ggml-base.dll']:
        sources['.local/tools/whisper/' + name] = whisper / name
    cpu_backends = sorted(whisper.glob('ggml-cpu-*.dll'))
    if not cpu_backends or not (whisper / 'ggml-cpu-x64.dll').is_file():
        raise ValueError('Whisper CPU backends are missing')
    for source in cpu_backends:
        sources['.local/tools/whisper/' + source.name] = source
    plugin_ids = set()
    for source in sorted(args.plugins.glob('*.beeftv-plugin')):
        with zipfile.ZipFile(source) as archive:
            if archive.testzip() is not None:
                raise ValueError('Invalid plugin archive: ' + source.name)
            manifest = json.loads(archive.read('manifest.json'))
        if manifest['id'] in plugin_ids:
            raise ValueError('Duplicate plugin: ' + manifest['id'])
        plugin_ids.add(manifest['id'])
        sources['plugin-packages/' + source.name] = source
    if not plugin_ids:
        raise ValueError('Plugin packages are missing')
    for name in ['FFmpeg-GPL-3.0.txt', 'whisper.cpp-LICENSE.txt', 'Whisper-model-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt']:
        sources['licenses/' + name] = args.notices / name
    sources['prerequisites/VC_redist.x64.exe'] = args.notices / 'VC_redist.x64.exe'
    for name, source in sources.items():
        if not source.is_file() or source.stat().st_size == 0:
            raise ValueError('Required release input missing: ' + name)
    collect_runtime_tree(sources, args.executable.parent)
    destination.mkdir(parents=True)
    for name, source in sources.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    enable_utf8_manifest(destination / '.local/tools/whisper/whisper-cli.exe')
    launcher = '@echo off\r\nsetlocal\r\nset "CANVAS_DESKTOP_DATA_DIR=%~dp0.local\\EggfansTV"\r\nstart "Eggfans TV" "%~dp0EggfansTV.exe"\r\nendlocal\r\n'
    (destination / 'run-eggfans-tv.cmd').write_bytes(launcher.encode('ascii'))
    instructions = (
        'Eggfans TV ' + args.version + ' Windows 10/11 x64 完整便携版\r\n\r\n'
        '请完整解压到有写入权限的文件夹，然后双击 EggfansTV.exe。不要在压缩包内直接运行，也不要只复制一个 EXE。\r\n'
        f'程序、{len(plugin_ids)} 个协议插件、FFmpeg/FFprobe、本地 Whisper 语音识别引擎和多语言 base 模型均已包含。\r\n'
        '保留 .local/tools 和 plugin-packages 文件夹。本包不含开发工具，不含个人 Key、画布、项目或素材。\r\n'
        '运行后配置和素材保存在本包 .local/EggfansTV 中；升级前备份此目录，不要删除。\r\n'
        '若本地语音识别提示缺少 MSVCP140、VCRUNTIME140 或 VCOMP140，请运行 prerequisites/VC_redist.x64.exe。\r\n'
        '界面需要 Microsoft WebView2 Runtime；未安装时软件会提示安装微软运行环境。\r\n'
        '已按外发版要求隐藏新增渠道及火山 URI 配置，渠道 URL 仅在悬停图标时显示。\r\n'
        'manifest.json 记录文件大小和 SHA-256，licenses 中包含第三方许可和来源说明。\r\n'
    )
    (destination / '使用说明.txt').write_text(instructions, encoding='utf-8-sig')
    records = []
    for path in sorted(destination.rglob('*')):
        if path.is_file():
            records.append({'path': path.relative_to(destination).as_posix(), 'bytes': path.stat().st_size, 'sha256': digest(path)})
    manifest = {'version': args.version, 'platform': 'windows-amd64', 'pluginPackages': len(plugin_ids), 'files': records}
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    with zipfile.ZipFile(archive_path, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(destination.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(destination).as_posix())
    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip() is not None:
            raise ValueError('Release archive CRC verification failed')
        if set(archive.namelist()) != {record['path'] for record in records} | {'manifest.json'}:
            raise ValueError('Release archive file list mismatch')
        for record in records:
            with archive.open(record['path']) as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != record['sha256']:
                    raise ValueError('Release archive hash mismatch: ' + record['path'])
    report = {'directory': str(destination), 'archive': str(archive_path), 'exeBytes': args.executable.stat().st_size, 'unpackedBytes': sum(record['bytes'] for record in records), 'archiveBytes': archive_path.stat().st_size, 'archiveSha256': digest(archive_path), 'pluginPackages': len(plugin_ids), 'files': len(records) + 1, 'hashesVerified': True}
    print(json.dumps(report, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
