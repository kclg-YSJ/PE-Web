import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

test('static server supports seekable audio, HEAD, ranges and read-only access', async context => {
  const child = spawn(process.execPath, ['server.mjs', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  context.after(() => child.kill());
  const url = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Server exited: ${code}`)));
  });
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('PhiEditer'));
  const audio = await readFile('assets/original/SE/tap.mp3');
  const head = await fetch(`${url}/assets/original/SE/tap.mp3`, { method: 'HEAD' });
  assert.equal(Number(head.headers.get('content-length')), audio.length);
  const range = await fetch(`${url}/assets/original/SE/tap.mp3`, { headers: { Range: 'bytes=0-49' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), audio.subarray(0, 50));
  const suffix = await fetch(`${url}/assets/original/SE/tap.mp3`, { headers: { Range: 'bytes=-10' } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), audio.subarray(-10));
  const invalid = await fetch(`${url}/assets/original/SE/tap.mp3`, { headers: { Range: 'bytes=99999999-' } });
  assert.equal(invalid.status, 416);
  assert.equal((await fetch(url, { method: 'POST', body: 'unchanged' })).status, 405);
  assert.ok([403, 404].includes((await fetch(`${url}/%2e%2e%5cpackage.json`)).status));
});
