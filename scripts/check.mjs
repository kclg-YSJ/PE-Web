import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

let errors = 0;
for (const folder of ['src', 'scripts', 'tests', '.']) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(mjs|js)$/.test(entry.name)) continue;
    const path = resolve(folder, entry.name);
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status !== 0) { errors++; console.error(result.stderr); }
  }
}
JSON.parse(await readFile('assets/catalog.json', 'utf8'));
console.log(errors ? `${errors} syntax errors` : 'All JavaScript syntax checks passed.');
process.exitCode = errors ? 1 : 0;
