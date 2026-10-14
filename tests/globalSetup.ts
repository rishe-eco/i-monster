// Builds the admin bundle once before the unit and integration suites, so the
// shell's pages can name it and the assets test can serve it (plan B4b). The
// server renders everything else with no build, so this is the only one. A
// bundle at least as new as every file it is built from is left alone: a lane
// running one test file shouldn't wait on Vite.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SOURCES = [join(ROOT, 'admin'), join(ROOT, 'lib', 'limits.ts'), join(ROOT, 'lib', 'passkey-name.ts'), join(ROOT, 'lib', 'dates.ts'), join(ROOT, 'lib', 'env.ts'), join(ROOT, 'package-lock.json')];

function newest(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(stat.mtimeMs, ...readdirSync(path).map((name) => newest(join(path, name))));
}

export default function setup(): void {
  const built = ['admin.js', 'admin.css'].map((file) => join(ROOT, 'dist', 'admin', file));
  const stale = !built.every(existsSync) || Math.min(...built.map((file) => statSync(file).mtimeMs)) < Math.max(...SOURCES.map(newest));
  if (!stale) return;
  const result = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', join(ROOT, 'admin', 'vite.config.ts')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`The admin bundle did not build:\n${result.stdout}\n${result.stderr}`);
}
