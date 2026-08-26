// Local development server: serves public/ statically and mounts the Vercel
// serverless handlers at /api/* through a tiny req/res shim, so the app runs
// with plain Node (no Vercel CLI). Usage: `npm run dev` (PORT env optional).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import quakesHandler from './api/quakes.js';
import damagingHandler from './api/damaging.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const API_ROUTES = {
  '/api/quakes': quakesHandler,
  '/api/damaging': damagingHandler
};

/** Minimal Vercel-style res shim on top of node:http ServerResponse. */
function shimRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => {
    res.end(body);
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  const apiHandler = API_ROUTES[pathname.replace(/\/$/, '')];
  if (apiHandler) {
    try {
      await apiHandler(req, shimRes(res));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'internal_error', detail: err.message }));
    }
    return;
  }

  // Static files from public/, defaulting to index.html.
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = normalize(join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  try {
    const data = await readFile(filePath);
    res.setHeader('Content-Type', MIME[extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Sismos dev server running at http://localhost:${PORT}`);
});
