// ============================================================
// Local Development Server
// ============================================================
// Run with: node server.js
// Opens at http://localhost:3000
// Simulates Vercel's static + serverless function setup locally
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // ── API routes ──
  if (pathname.startsWith('/api/')) {
    try {
      const apiFile = path.join(__dirname, pathname + '.js');

      if (!fs.existsSync(apiFile)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API route not found' }));
        return;
      }

      // Clear require cache for hot reload during development
      delete require.cache[require.resolve(apiFile)];
      const handler = require(apiFile);

      // Build a minimal req/res compatible with Vercel handler format
      req.query = parsedUrl.query;

      const resProxy = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          res.writeHead(this.statusCode, {
            ...this.headers,
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify(data));
        },
        end(data) {
          res.writeHead(this.statusCode, this.headers);
          res.end(data);
        },
      };

      await handler(req, resProxy);
    } catch (err) {
      console.error('API Error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Static files ──
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } else {
      // Fallback to index.html (SPA style)
      const indexPath = path.join(__dirname, 'public', 'index.html');
      const content = fs.readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    }
  } catch (err) {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  FMCSA Carrier Finder  |  Dev Server    ║
╠══════════════════════════════════════════╣
║                                          ║
║  Local:  http://localhost:${PORT}          ║
║                                          ║
║  API:    http://localhost:${PORT}/api/     ║
║                                          ║
╚══════════════════════════════════════════╝
  `);
});
