// Onceover — tiny zero-dependency static server.
// Everything that matters (parsing, stats) runs in the browser. This just serves files.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4321;
const ROOT = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer(function (req, res) {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  // prevent path traversal
  const filePath = path.join(ROOT, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log('');
  console.log('  Onceover is running.');
  console.log('  Open  →  http://localhost:' + PORT);
  console.log('');
  console.log('  Drop any CSV. Nothing leaves your machine.');
  console.log('');
});
