import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, resolve, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const argumentIndex = process.argv.indexOf('--port');
const port = Number(argumentIndex >= 0 ? process.argv[argumentIndex + 1] : process.env.PORT ?? 5179);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.otf': 'font/otf', '.ttf': 'font/ttf', '.pec': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const inside = relative(root, path);
    if (inside.startsWith('..') || isAbsolute(inside)) { response.writeHead(403); response.end(); return; }
    const info = await stat(path);
    if (!info.isFile()) { response.writeHead(404); response.end(); return; }
    const headers = { 'Content-Type': mime[extname(path).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    let start = 0;
    let end = info.size - 1;
    if (range) {
      start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = Math.max(0, end - start + 1);
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD' || !info.size) response.end();
    else createReadStream(path, { start, end }).on('error', () => response.destroy()).pipe(response);
  } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end('File unavailable'); }
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`PhiEditer PE Web: ${url}\nPress Ctrl+C to stop.`);
  if (process.argv.includes('--open') && process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Run node server.mjs --port ${port + 1}` : error.message); process.exitCode = 1; });
