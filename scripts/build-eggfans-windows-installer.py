import argparse
import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess

from windows_utf8_manifest import enable_utf8_manifest


PRIVATE_FILE_NAMES = {'.env', '.env.local', '.settings-key'}
PRIVATE_FILE_SUFFIXES = {'.key', '.pem', '.p12', '.pfx'}
REQUIRED_PAYLOAD_FILES = ('agent-host/server.mjs', 'agent-host/runtime/node.exe', 'cli/beeftv.exe')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_required_payload_files(records):
    by_path = {record.get('path'): record for record in records}
    for required in REQUIRED_PAYLOAD_FILES:
        record = by_path.get(required)
        if not record or int(record.get('bytes', 0)) <= 0:
            raise ValueError('Required release input missing: ' + required)


def quote(value):
    return '"' + str(value).replace('$', '$$').replace('"', '$\\"') + '"'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--payload', required=True, type=Path)
    parser.add_argument('--webview2', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--compiler', type=Path, default=Path(r'C:\Program Files (x86)\NSIS\makensis.exe'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = args.payload.resolve()
    output = args.output.resolve()
    if output.exists():
        raise ValueError('Installer already exists; choose a new output filename')
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version'].removeprefix('v')
    if re.fullmatch(r'\d+\.\d+\.\d+', version) is None or manifest['platform'] != 'windows-amd64':
        raise ValueError('Expected a stable Windows amd64 release payload')
    validate_required_payload_files(manifest['files'])
    records = []
    for record in manifest['files']:
        relative = PurePosixPath(record['path'])
        if relative.is_absolute() or any(part in ['', '.', '..'] for part in relative.parts) or '\\' in record['path'] or ':' in record['path']:
            raise ValueError('Unsafe release path')
        if relative.name in PRIVATE_FILE_NAMES or relative.suffix.lower() in PRIVATE_FILE_SUFFIXES:
            raise ValueError('Private key material must not be included: ' + record['path'])
        path = (source / Path(*relative.parts)).resolve()
        if not path.is_relative_to(source) or digest(path) != record['sha256'] or path.stat().st_size != record['bytes']:
            raise ValueError('Payload hash mismatch: ' + record['path'])
        if record['path'].startswith('.local/') and not record['path'].startswith('.local/tools/'):
            raise ValueError('User data must not be included in an installer')
        if record['path'] != '使用说明.txt':
            records.append({**record, 'source': path})
    runtime = args.webview2.resolve()
    if runtime.stat().st_size < 50_000_000 or runtime.read_bytes()[:2] != b'MZ':
        raise ValueError('Expected the complete offline WebView2 installer')
    records.append({'path': 'prerequisites/MicrosoftEdgeWebView2RuntimeInstallerX64.exe', 'source': runtime, 'bytes': runtime.stat().st_size, 'sha256': digest(runtime)})
    stage = root / '.local/cache' / ('windows-installer-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    stage.mkdir()
    for record in records:
        if record['path'] == '.local/tools/whisper/whisper-cli.exe':
            prepared = stage / 'whisper-cli.exe'
            shutil.copy2(record['source'], prepared)
            enable_utf8_manifest(prepared)
            record.update({'source': prepared, 'bytes': prepared.stat().st_size, 'sha256': digest(prepared)})
    readme = stage / '使用说明.txt'
    readme.write_text('Eggfans TV ' + version + ' Windows x64 安装版\n\n安装完成后从桌面或开始菜单打开 Eggfans TV，在模型配置中填写自己的 API Key。\n所有功能板块、协议插件、本地剪辑工具和语音识别模型均已包含。缺少的微软运行环境会在安装时自动部署。\n程序配置、项目和素材保存在安装目录 .local/EggfansTV 中。升级和卸载均保留此目录。\n外发版保留渠道 URL 的悬停显示，隐藏新增渠道和火山 URI 配置入口。\n安装程序使用文件白名单，不包含开发者的个人 Key、画布、项目或素材。\n', encoding='utf-8-sig')
    records.append({'path': readme.name, 'source': readme, 'bytes': readme.stat().st_size, 'sha256': digest(readme)})
    installed_manifest = {'version': manifest['version'], 'platform': manifest['platform'], 'pluginPackages': manifest['pluginPackages'], 'files': [{key: value for key, value in record.items() if key != 'source'} for record in records]}
    installed_manifest_path = stage / 'manifest.json'
    installed_manifest_path.write_text(json.dumps(installed_manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    records.append({'path': 'manifest.json', 'source': installed_manifest_path, 'bytes': installed_manifest_path.stat().st_size, 'sha256': digest(installed_manifest_path)})
    directories = {str(PurePosixPath(record['path']).parent) for record in records}
    include = ['!macro InstallPayload']
    for directory in sorted(directories):
        windows_directory = '' if directory == '.' else '\\' + directory.replace('/', '\\')
        include.append('SetOutPath "$INSTDIR' + windows_directory + '"')
        for record in sorted(records, key=lambda item: item['path']):
            if str(PurePosixPath(record['path']).parent) == directory:
                include.append('File ' + quote('/oname=' + PurePosixPath(record['path']).name) + ' ' + quote(record['source']))
    include.extend(['!macroend', '!macro UninstallPayload'])
    for record in records:
        include.append('Delete "$INSTDIR\\' + record['path'].replace('/', '\\') + '"')
    parent_directories = set()
    for directory in directories:
        current = PurePosixPath(directory)
        while str(current) != '.':
            parent_directories.add(str(current))
            current = current.parent
    for directory in sorted(parent_directories, key=lambda name: (name.count('/'), name), reverse=True):
        include.append('RMDir "$INSTDIR\\' + directory.replace('/', '\\') + '"')
    include.append('!macroend')
    payload_include = stage / 'payload.nsh'
    payload_include.write_text('\n'.join(include) + '\n', encoding='utf-8-sig')
    output.parent.mkdir(parents=True, exist_ok=True)
    arguments = [str(args.compiler), '/V3', '/INPUTCHARSET', 'UTF8', '/DAPP_VERSION=' + version, '/DVERSION_QUAD=' + version + '.0', '/DSETUP_OUTPUT=' + str(output), '/DPAYLOAD_INCLUDE=' + str(payload_include), '/DAPP_ICON=' + str(root / 'backend/cmd/desktop/build/windows/icon.ico'), '/DINSTALL_SIZE_KIB=' + str(sum(record['bytes'] for record in records) // 1024), str(root / 'scripts/windows-installer/eggfans-tv.nsi')]
    subprocess.run(arguments, cwd=stage, check=True)
    assert output.is_file() and output.stat().st_size > 100_000_000
    report = {'installer': str(output), 'bytes': output.stat().st_size, 'sha256': digest(output), 'version': manifest['version'], 'payloadFiles': len(records), 'pluginPackages': manifest['pluginPackages'], 'unpackedBytes': sum(record['bytes'] for record in records), 'stage': str(stage), 'webview2Sha256': digest(runtime)}
    report_path = args.report.resolve() if args.report else root / '.local/cache/windows-installer-build.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
