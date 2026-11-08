// backend/routes/accounting.js — دليل الحسابات، قيود اليومية، التقارير المالية
'use strict';
const { db, tx, audit } = require('../db');
const { HttpError, reqDate, reqStr, today } = require('../http');
const A = require('../services/accounting');

const ACC = ['accountant'];
const like = q => `%${String(q || '').replace(/[%_]/g, '')}%`;
const range = q => {
  const to = q.to ? reqDate(q.to, 'إلى تاريخ') : today();
  const from = q.from ? reqDate(q.from, 'من تاريخ') : to.slice(0, 4) + '-01-01';
  return { from, to };
};

module.exports = [
  { method: 'GET', path: '/api/accounts', roles: ACC, handler: () => db.prepare('SELECT * FROM accounts ORDER BY code').all() },
  {
    method: 'GET', path: '/api/accounts/expense', roles: ['accountant', 'purchasing', 'sales'], handler: () =>
      db.prepare("SELECT id,code,name FROM accounts WHERE type='expense' AND active=1 AND code NOT IN ('5010','5020','6100') ORDER BY code").all(),
  },
  {
    method: 'POST', path: '/api/accounts', roles: ACC, handler: ({ user, body }) => {
      const code = reqStr(body.code, 'رمز الحساب', 10);
      if (!/^\d{4,8}$/.test(code)) throw new HttpError(400, 'رمز الحساب أرقام فقط (4 إلى 8)');
      if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(body.type)) throw new HttpError(400, 'نوع الحساب غير صالح');
      if (db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(code)) throw new HttpError(400, 'رمز الحساب مستخدم');
      const r = db.prepare('INSERT INTO accounts(code,name,type) VALUES(?,?,?)').run(code, reqStr(body.name, 'اسم الحساب', 120), body.type);
      audit(user.id, 'create', 'account', Number(r.lastInsertRowid), code);
      return db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(r.lastInsertRowid));
    },
  },
  {
    method: 'PUT', path: '/api/accounts/:id', roles: ACC, handler: ({ user, params, body }) => {
      const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(params.id));
      if (!a) throw new HttpError(404, 'الحساب غير موجود');
      if (a.system_key && body.active === false) throw new HttpError(400, 'لا يمكن تعطيل حساب نظامي');
      db.prepare('UPDATE accounts SET name = ?, active = ? WHERE id = ?').run(reqStr(body.name ?? a.name, 'اسم الحساب', 120), body.active === false ? 0 : 1, a.id);
      audit(user.id, 'update', 'account', a.id);
      return db.prepare('SELECT * FROM accounts WHERE id = ?').get(a.id);
    },
  },

  {
    method: 'GET', path: '/api/journal', roles: ACC, handler: ({ query }) => {
      const w = [], pr = [];
      if (query.from) { w.push('e.date >= ?'); pr.push(query.from); }
      if (query.to) { w.push('e.date <= ?'); pr.push(query.to); }
      if (query.q) { w.push('(e.number LIKE ? OR e.description LIKE ?)'); pr.push(like(query.q), like(query.q)); }
      const entries = db.prepare(`SELECT e.*, (SELECT SUM(debit) FROM journal_lines WHERE entry_id = e.id) AS total FROM journal_entries e
        ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY e.date DESC, e.id DESC LIMIT 300`).all(...pr);
      const linesStmt = db.prepare('SELECT l.*, a.code, a.name AS account_name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id');
      return entries.map(e => ({ ...e, lines: linesStmt.all(e.id) }));
    },
  },
  {
    // قيد يدوي (تسويات، رأس مال افتتاحي...). القيود الآلية لا تُعدّل ولا تُحذف
    method: 'POST', path: '/api/journal', roles: ACC, handler: ({ user, body }) => {
      const date = reqDate(body.date);
      if (!Array.isArray(body.lines) || body.lines.length < 2) throw new HttpError(400, 'القيد يحتاج سطرين على الأقل');
      const lines = body.lines.map(l => {
        const acc = db.prepare('SELECT id FROM accounts WHERE id = ? AND active = 1').get(Number(l.account_id));
        if (!acc) throw new HttpError(400, 'حساب غير صالح في القيد');
        const debit = Number(l.debit || 0), credit = Number(l.credit || 0);
        if (debit < 0 || credit < 0 || (debit > 0 && credit > 0)) throw new HttpError(400, 'كل سطر إما مدين أو دائن');
        return { account: acc.id, debit, credit, memo: l.memo };
      });
      return tx(() => {
        const r = A.postEntry({ date, description: reqStr(body.description, 'وصف القيد', 200), lines, refType: 'manual', userId: user.id });
        audit(user.id, 'create', 'journal', r.id, r.number);
        return r;
      });
    },
  },

  { method: 'GET', path: '/api/reports/trial-balance', roles: ACC, handler: ({ query }) => A.trialBalance(query.to ? reqDate(query.to) : today()) },
  { method: 'GET', path: '/api/reports/income-statement', roles: ACC, handler: ({ query }) => { const r = range(query); return A.incomeStatement(r.from, r.to); } },
  { method: 'GET', path: '/api/reports/balance-sheet', roles: ACC, handler: ({ query }) => A.balanceSheet(query.to ? reqDate(query.to) : today()) },
  { method: 'GET', path: '/api/reports/vat', roles: ACC, handler: ({ query }) => { const r = range(query); return A.vatReport(r.from, r.to); } },
  {
    method: 'GET', path: '/api/reports/ledger', roles: ACC, handler: ({ query }) => {
      const r = range(query); return A.ledger(Number(query.account_id), r.from, r.to);
    },
  },
  {
    // أعمار الديون: المبالغ المستحقة على العملاء حسب مدة التأخر
    method: 'GET', path: '/api/reports/receivables-aging', roles: ['accountant', 'sales'], handler: () => {
      const rows = db.prepare(`SELECT s.id, s.number, s.date, s.due_date, s.total-s.paid AS remaining, c.name AS customer_name,
          CAST(julianday('now') - julianday(s.due_date) AS INTEGER) AS days_overdue
        FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('unpaid','partial') ORDER BY s.due_date`).all();
      const b = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
      for (const r of rows) {
        const d = r.days_overdue;
        if (d <= 0) b.current += r.remaining; else if (d <= 30) b.d1_30 += r.remaining; else if (d <= 60) b.d31_60 += r.remaining; else if (d <= 90) b.d61_90 += r.remaining; else b.over90 += r.remaining;
      }
      for (const k in b) b[k] = Math.round(b[k] * 100) / 100;
      return { buckets: b, rows };
    },
  },
  {
    // مطابقة المخزون مع الحسابات: قيمة المخزون الفعلية يجب أن تساوي رصيد حسابي المخزون
    method: 'GET', path: '/api/reports/inventory-reconciliation', roles: ACC, handler: () => {
      const stock = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='car' THEN qty*cost END),0) cars, COALESCE(SUM(CASE WHEN type!='car' THEN qty*cost END),0) parts FROM products").get();
      const tb = A.trialBalance(today()).rows;
      const bal = code => { const r = tb.find(x => x.code === code); return r ? Math.round((r.debit - r.credit) * 100) / 100 : 0; };
      const o = { cars: { stock: Math.round(stock.cars * 100) / 100, ledger: bal('1200') }, parts: { stock: Math.round(stock.parts * 100) / 100, ledger: bal('1210') } };
      o.cars.diff = Math.round((o.cars.stock - o.cars.ledger) * 100) / 100;
      o.parts.diff = Math.round((o.parts.stock - o.parts.ledger) * 100) / 100;
      return o;
    },
  },
];
