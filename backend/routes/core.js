// backend/routes/core.js — الدخول، الإعدادات، المستخدمون، لوحة التحكم
'use strict';
const { db, round2, getSetting, setSetting, audit } = require('../db');
const { HttpError, reqStr, optStr } = require('../http');
const A = require('../auth');
const UAE = require('../uae');
const accounting = require('../services/accounting');

const ROLES = ['admin', 'sales', 'purchasing', 'accountant', 'warehouse'];
const SETTING_KEYS = ['company_name', 'company_name_en', 'trn', 'address', 'phone', 'email', 'bank_name', 'iban', 'vat_rate'];

function companySettings() {
  const o = {};
  for (const k of SETTING_KEYS) o[k] = getSetting(k, '');
  o.vat_rate = Number(o.vat_rate || UAE.VAT_RATE);
  o.currency = 'AED';
  return o;
}

function monthRange(offset = 0) {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10);
  const e = new Date(d); e.setUTCMonth(e.getUTCMonth() + 1); e.setUTCDate(0);
  return { from, to: e.toISOString().slice(0, 10), label: from.slice(0, 7) };
}

function dashboard() {
  const m = monthRange(0);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const salesMonth = one("SELECT COALESCE(SUM(subtotal),0) v, COUNT(*) n FROM sales WHERE status != 'cancelled' AND date BETWEEN ? AND ?", m.from, m.to);
  const purchasesMonth = one("SELECT COALESCE(SUM(subtotal),0) v FROM purchases WHERE status = 'received' AND date BETWEEN ? AND ?", m.from, m.to);
  const is = accounting.incomeStatement(m.from, m.to);
  const stock = one("SELECT COALESCE(SUM(qty*cost),0) v FROM products WHERE active = 1");
  const carsInStock = one("SELECT COUNT(*) n FROM products WHERE type='car' AND active=1 AND qty>0").n;
  const receivables = one("SELECT COALESCE(SUM(total-paid),0) v FROM sales WHERE status IN ('unpaid','partial')").v;
  const payables = one("SELECT COALESCE(SUM(total-paid),0) v FROM purchases WHERE status = 'received'").v;
  const tb = accounting.trialBalance(null).rows;
  const cashBank = round2(tb.filter(r => r.code === '1010' || r.code === '1020').reduce((s, r) => s + r.debit - r.credit, 0));
  const lowStock = db.prepare("SELECT id,name,qty,min_qty,sku FROM products WHERE active=1 AND type != 'car' AND min_qty > 0 AND qty <= min_qty ORDER BY qty LIMIT 8").all();
  const recentSales = db.prepare(`SELECT s.id,s.number,s.date,s.total,s.paid,s.status,c.name AS customer_name FROM sales s JOIN customers c ON c.id=s.customer_id ORDER BY s.date DESC, s.id DESC LIMIT 8`).all();
  const overdue = one("SELECT COUNT(*) n, COALESCE(SUM(total-paid),0) v FROM sales WHERE status IN ('unpaid','partial') AND due_date < date('now')");
  const series = [];
  for (let i = -5; i <= 0; i++) {
    const r = monthRange(i);
    series.push({
      month: r.label,
      sales: one("SELECT COALESCE(SUM(subtotal),0) v FROM sales WHERE status!='cancelled' AND date BETWEEN ? AND ?", r.from, r.to).v,
      purchases: one("SELECT COALESCE(SUM(subtotal),0) v FROM purchases WHERE status='received' AND date BETWEEN ? AND ?", r.from, r.to).v,
    });
  }
  const topCustomers = db.prepare(`SELECT c.name, SUM(s.total) total FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.status!='cancelled' GROUP BY c.id ORDER BY total DESC LIMIT 5`).all();
  const vat = accounting.vatReport(m.from, m.to);
  return {
    month: m.label,
    salesMonth: salesMonth.v, salesMonthCount: salesMonth.n, purchasesMonth: purchasesMonth.v,
    grossProfitMonth: is.totals.grossProfit, netProfitMonth: is.totals.profitBeforeTax,
    stockValue: round2(stock.v), carsInStock, receivables: round2(receivables), payables: round2(payables), cashBank,
    overdueCount: overdue.n, overdueAmount: round2(overdue.v), netVatMonth: vat.netVatPayable,
    lowStock, recentSales, series, topCustomers,
  };
}

module.exports = [
  { method: 'POST', path: '/api/auth/login', public: true, handler: ({ body, ip }) => A.login(body.username, body.password, ip) },
  { method: 'POST', path: '/api/auth/logout', handler: ({ token }) => { A.logout(token); return { ok: true }; } },
  { method: 'GET', path: '/api/auth/me', handler: ({ user }) => user },
  {
    method: 'POST', path: '/api/auth/password', handler: ({ user, body }) => {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      if (!A.verifyPassword(String(body.current || ''), row.password_hash)) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
      A.checkPasswordPolicy(body.next);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(A.hashPassword(body.next), user.id);
      audit(user.id, 'password', 'user', user.id);
      return { ok: true };
    },
  },
  { method: 'GET', path: '/api/meta', handler: () => ({ settings: companySettings(), emirates: UAE.EMIRATES, roles: ROLES }) },

  { method: 'GET', path: '/api/settings', roles: ['admin'], handler: () => companySettings() },
  {
    method: 'PUT', path: '/api/settings', roles: ['admin'], handler: ({ user, body }) => {
      if (body.trn && !UAE.validateTRN(body.trn)) throw new HttpError(400, 'الرقم الضريبي (TRN) يجب أن يتكون من 15 رقماً');
      if (body.vat_rate !== undefined) {
        const v = Number(body.vat_rate);
        if (!(v >= 0 && v <= 0.25)) throw new HttpError(400, 'نسبة الضريبة غير صالحة');
        body.vat_rate = v;
      }
      for (const k of SETTING_KEYS) if (body[k] !== undefined) setSetting(k, String(body[k]).trim().slice(0, 200));
      audit(user.id, 'update', 'settings', null);
      return companySettings();
    },
  },

  { method: 'GET', path: '/api/users', roles: ['admin'], handler: () => db.prepare('SELECT id,username,full_name,role,active,created_at FROM users ORDER BY id').all() },
  {
    method: 'POST', path: '/api/users', roles: ['admin'], handler: ({ user, body }) => {
      const username = reqStr(body.username, 'اسم المستخدم', 40);
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'اسم المستخدم: أحرف إنجليزية وأرقام فقط (3 أحرف على الأقل)');
      if (!ROLES.includes(body.role)) throw new HttpError(400, 'الدور غير صالح');
      A.checkPasswordPolicy(body.password);
      if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) throw new HttpError(400, 'اسم المستخدم مستخدم مسبقاً');
      const r = db.prepare('INSERT INTO users(username,full_name,password_hash,role) VALUES(?,?,?,?)')
        .run(username, reqStr(body.full_name, 'الاسم الكامل', 100), A.hashPassword(body.password), body.role);
      audit(user.id, 'create', 'user', Number(r.lastInsertRowid), username);
      return db.prepare('SELECT id,username,full_name,role,active FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
    },
  },
  {
    method: 'PUT', path: '/api/users/:id', roles: ['admin'], handler: ({ user, params, body }) => {
      const id = Number(params.id);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!u) throw new HttpError(404, 'المستخدم غير موجود');
      if (id === user.id && (body.active === false || (body.role && body.role !== 'admin'))) throw new HttpError(400, 'لا يمكنك تعطيل نفسك أو تغيير دورك');
      if (body.role && !ROLES.includes(body.role)) throw new HttpError(400, 'الدور غير صالح');
      if (body.password) { A.checkPasswordPolicy(body.password); db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(A.hashPassword(body.password), id); }
      db.prepare('UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?')
        .run(optStr(body.full_name, 100) || u.full_name, body.role || u.role, body.active === undefined ? u.active : (body.active ? 1 : 0), id);
      if (body.active === false) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit(user.id, 'update', 'user', id);
      return db.prepare('SELECT id,username,full_name,role,active FROM users WHERE id = ?').get(id);
    },
  },
  {
    method: 'GET', path: '/api/audit', roles: ['admin'], handler: () =>
      db.prepare('SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200').all(),
  },
  { method: 'GET', path: '/api/dashboard', handler: () => dashboard() },
];

module.exports.companySettings = companySettings;
