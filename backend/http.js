// backend/http.js — أدوات مشتركة للطلبات والأخطاء والتحقق من المدخلات
'use strict';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function reqDate(v, label = 'التاريخ') {
  if (!DATE_RE.test(String(v || '')) || isNaN(new Date(v))) throw new HttpError(400, `${label} غير صالح (الصيغة YYYY-MM-DD)`);
  return v;
}
function today() { return new Date().toISOString().slice(0, 10); }
function reqNum(v, label, { min = 0, allowZero = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || (!allowZero && n === 0 && min === 0)) throw new HttpError(400, `${label} غير صالح`);
  return n;
}
function reqStr(v, label, max = 200) {
  const s = String(v ?? '').trim();
  if (!s) throw new HttpError(400, `${label} مطلوب`);
  if (s.length > max) throw new HttpError(400, `${label} طويل جداً`);
  return s;
}
function optStr(v, max = 500) {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

module.exports = { HttpError, reqDate, today, reqNum, reqStr, optStr };
