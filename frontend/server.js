'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
  stream.pipe(res);
}

http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const filePath = url.pathname === '/'
    ? path.join(ROOT, 'index.html')
    : path.join(ROOT, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }

  serveFile(res, filePath);
}).listen(PORT, HOST, () => {
  console.log(JSON.stringify({ ok: true, service: 'code_lounge_frontend', url: `http://${HOST}:${PORT}` }));
});
