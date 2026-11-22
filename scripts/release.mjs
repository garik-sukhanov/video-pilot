// Выпуск релиза на GitHub: сборка .dmg (для ручной установки) и .zip под arm64/x64
// (их скачивает встроенный апдейтер), затем `gh release create v<версия>`.
//
//   npm version minor --no-git-tag-version   # поднять версию
//   git commit -am "…" && git push            # релиз собирается из запушенного main
//   npm run release -- --notes "Что нового"   # или --notes-file CHANGES.md
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = `v${version}`;
const argv = process.argv.slice(2);
const notesIdx = argv.indexOf('--notes');
const fileIdx = argv.indexOf('--notes-file');

if (out('git', ['status', '--porcelain'])) {
  console.error('✗ есть незакоммиченные изменения — сначала коммит');
  process.exit(1);
}
sh('git', ['fetch', '-q', 'origin']);
if (out('git', ['rev-parse', 'HEAD']) !== out('git', ['rev-parse', 'origin/main'])) {
  console.error('✗ HEAD не совпадает с origin/main — запушь main или переключись на него');
  process.exit(1);
}
try {
  out('gh', ['release', 'view', tag]);
  console.error(`✗ релиз ${tag} уже есть — подними версию в package.json`);
  process.exit(1);
} catch {
  /* релиза ещё нет — продолжаем */
}

sh('npm', ['run', 'prepare:ffmpeg']);
sh('npx', ['electron-vite', 'build']);
sh('npx', ['electron-builder', '--mac', 'dmg', '--universal', '--publish', 'never']);
sh('npx', ['electron-builder', '--mac', 'zip', '--arm64', '--x64', '--publish', 'never']);

const files = readdirSync('dist')
  .filter((f) => f.includes(version) && (f.endsWith('.zip') || f.endsWith('.dmg')))
  .map((f) => `dist/${f}`);
console.log('файлы релиза:', files);

const notes =
  notesIdx >= 0 ? ['--notes', argv[notesIdx + 1]] : fileIdx >= 0 ? ['--notes-file', argv[fileIdx + 1]] : ['--generate-notes'];
sh('gh', ['release', 'create', tag, ...files, '--title', `VideoPilot ${version}`, '--target', 'main', ...notes]);
console.log(`✓ ${tag} опубликован — установленные VideoPilot увидят его в течение 6 часов или сразу через меню «Проверить обновления…»`);
