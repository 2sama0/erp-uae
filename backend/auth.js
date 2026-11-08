// backend/auth.js — المصادقة والجلسات والصلاحيات
'use strict';
const crypto = require('crypto');
const { db } = require('./db');
const { HttpError } = require('./http');

const SESSION_MS = (Number(process.env.SESSION_HOURS) || 12) * 3600 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const good = Buffer.from(hash, 'hex');
  return good.length === test.length && crypto.timingSafeEqual(good, test);
}
function checkPasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'كلمة المرور يجب ألا تقل عن 8 أحرف');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'كلمة المرور يجب أن تحتوي حروفاً وأرقاماً');
}

// منع تخمين كلمات المرور: 8 محاولات فاشلة / 15 دقيقة لكل (IP + مستخدم)
const attempts = new Map();
function checkRate(key) {
  const now = Date.now();
  const rec = (attempts.get(key) || []).filter(t => now - t < 15 * 60 * 1000);
  attempts.set(key, rec);
  if (rec.length >= 8) throw new HttpError(429, 'محاولات كثيرة. حاول بعد 15 دقيقة');
}
function failAttempt(key) { attempts.get(key).push(Date.now()); }
function clearAttempts(key) { attempts.delete(key); }

function login(username, password, ip) {
  const key = `${ip}|${String(username).toLowerCase()}`;
  checkRate(key);
  const u = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username || '').trim());
  if (!u || !u.active || !verifyPassword(String(password || ''), u.password_hash)) {
    failAttempt(key);
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  clearAttempts(key);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, u.id, Date.now() + SESSION_MS);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return { token, user: publicUser(u) };
}
function publicUser(u) { return { id: u.id, username: u.username, full_name: u.full_name, role: u.role }; }

function userFromToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s || s.expires_at < Date.now()) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(s.user_id);
  return u ? publicUser(u) : null;
}
function logout(token) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); }

/** الصلاحيات: المدير يملك كل شيء، وباقي الأدوار حسب القائمة */
function requireRole(user, roles) {
  if (!roles || user.role === 'admin' || roles.includes(user.role)) return;
  throw new HttpError(403, 'ليس لديك صلاحية لهذه العملية');
}

module.exports = { hashPassword, verifyPassword, checkPasswordPolicy, login, logout, userFromToken, requireRole };
