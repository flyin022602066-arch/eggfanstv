import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { zipSync } = require('fflate');
const packages = JSON.parse(readFileSync(new URL('./bundled-skill-packages.json', import.meta.url), 'utf8'));
const [sourceRoot, destination] = process.argv.slice(2);
if (!sourceRoot || !destination) {
  throw new Error('Usage: package-bundled-skills.mjs <skill-source-root> <destination>');
}

function collectFiles(directory, relative = '') {
  const files = {};
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, collectFiles(source, name));
    } else if (entry.isFile()) {
      files[name] = [readFileSync(source), { mtime: new Date('2000-01-01T00:00:00Z') }];
    } else {
      throw new Error('Unsupported bundled skill file: ' + source);
    }
  }
  return files;
}

const archives = [];
for (const [identity, reference] of Object.entries(packages)) {
  const directory = path.join(sourceRoot, identity);
  for (const name of ['SKILL.md', reference]) {
    const source = path.join(directory, name);
    const info = statSync(source, { throwIfNoEntry: false });
    if (!info?.isFile() || info.size === 0) {
      throw new Error('Required bundled skill source missing or empty: ' + identity + '/' + name);
    }
  }
  const instruction = readFileSync(path.join(directory, 'SKILL.md'), 'utf8').replace(/^\uFEFF/, '');
  const frontmatter = instruction.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const name = frontmatter?.[1].match(/^name:[ \t]*([^\r\n]+)/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
  if (name !== path.posix.basename(identity)) {
    throw new Error('Bundled skill name mismatch: ' + identity + '/SKILL.md');
  }
  archives.push({ identity, content: zipSync(collectFiles(directory), { level: 6 }) });
}

for (const { identity, content } of archives) {
  const output = path.join(destination, identity + '.zip');
  mkdirSync(path.dirname(output), { recursive: true });
  const temporary = output + '.tmp';
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
}
process.stdout.write('Bundled skills: ' + archives.length + ' standard ZIPs in ' + destination + '\n');
