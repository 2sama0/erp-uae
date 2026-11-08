// backend/server.js — الخادم (بدون أي مكتبات خارجية)
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

// تحميل ملف .env بدون مكتبة dotenv
try {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (_) { /* تجاهل */ }

const { db } = require('./db');
const { HttpError } = require('./http');
const { userFromToken, requireRole } = require('./auth');
const accounting = require('./services/accounting');

accounting.seedAccounts();

const routes = [
  ...require('./routes/core'),
  ...require('./routes/master'),
  ...require('./routes/transactions'),
  ...require('./routes/accounting'),
].map(r => {
  const keys = [];
  const re = new RegExp('^' + r.path.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { ...r, re, keys };
});

const FRONTEND = path.join(__dirname, '..', 'frontend');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const CSP = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
function secHeaders(extra = {}) {
  return { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': CSP, ...extra };
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, secHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'الطلب كبير جداً')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'صيغة JSON غير صالحة')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const route = routes.find(r => r.method === req.method && r.re.test(url.pathname));
  if (!route) {
    if (routes.some(r => r.re.test(url.pathname))) throw new HttpError(405, 'الطريقة غير مسموحة');
    throw new HttpError(404, 'المسار غير موجود');
  }
  const m = url.pathname.match(route.re);
  const params = {}; route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  let user = null;
  if (!route.public) {
    user = userFromToken(token);
    if (!user) throw new HttpError(401, 'انتهت الجلسة. سجّل الدخول من جديد');
    requireRole(user, route.roles);
  }
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
  const query = Object.fromEntries(url.searchParams);
  const out = await route.handler({ req, body, query, params, user, token, ip: req.socket.remoteAddress });
  send(res, 200, out === undefined ? { ok: true } : out);
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(FRONTEND, rel));
  if (!file.startsWith(FRONTEND + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, secHeaders({ 'Content-Type': 'text/plain; charset=utf-8' })); return res.end('الصفحة غير موجودة'); }
    res.writeHead(200, secHeaders({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }));
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else throw new HttpError(405, 'الطريقة غير مسموحة');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    if (e && /UNIQUE constraint/.test(e.message)) return send(res, 400, { error: 'قيمة مكررة: السجل موجود مسبقاً' });
    if (e && /constraint/i.test(e.message)) return send(res, 400, { error: 'بيانات غير صالحة' });
    console.error('❌', req.method, req.url, e);
    send(res, 500, { error: 'حدث خطأ غير متوقع في الخادم' });
  }
});

const PORT = Number(process.env.PORT) || 5000;
if (require.main === module) {
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) console.log('ℹ️  قاعدة البيانات فارغة. شغّل:  npm run seed   لإنشاء بيانات تجريبية ومستخدم المدير.');
  server.listen(PORT, () => console.log(`🚀 النظام يعمل على: http://localhost:${PORT}`));
}
module.exports = { server };
