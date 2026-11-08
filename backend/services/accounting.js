// backend/services/accounting.js — القيد المزدوج والتقارير المالية
'use strict';
const { db, round2, nextNumber } = require('../db');
const { HttpError } = require('../http');

// دليل الحسابات الافتراضي لمعرض سيارات في الإمارات
const DEFAULT_ACCOUNTS = [
  ['1010', 'الصندوق (نقد)', 'asset', 'cash'],
  ['1020', 'الحساب البنكي', 'asset', 'bank'],
  ['1100', 'الذمم المدينة (العملاء)', 'asset', 'ar'],
  ['1200', 'مخزون السيارات', 'asset', 'inv_cars'],
  ['1210', 'مخزون الإكسسوارات وقطع الغيار', 'asset', 'inv_parts'],
  ['1300', 'ضريبة القيمة المضافة - مدخلات (قابلة للاسترداد)', 'asset', 'vat_in'],
  ['1400', 'مصروفات مدفوعة مقدماً', 'asset', null],
  ['1500', 'الأصول الثابتة', 'asset', null],
  ['2010', 'الذمم الدائنة (الموردون)', 'liability', 'ap'],
  ['2100', 'ضريبة القيمة المضافة - مخرجات (مستحقة)', 'liability', 'vat_out'],
  ['2200', 'عربون / دفعات مقدمة من العملاء', 'liability', null],
  ['2300', 'ضريبة الشركات المستحقة', 'liability', null],
  ['2400', 'مصروفات مستحقة', 'liability', null],
  ['3010', 'رأس المال', 'equity', 'capital'],
  ['3020', 'الأرباح المحتجزة', 'equity', null],
  ['4010', 'إيرادات بيع السيارات', 'revenue', 'rev_cars'],
  ['4020', 'إيرادات الإكسسوارات وقطع الغيار', 'revenue', 'rev_parts'],
  ['4030', 'إيرادات خدمات (تسجيل/ترخيص/تمويل)', 'revenue', null],
  ['5010', 'تكلفة السيارات المباعة', 'expense', 'cogs_cars'],
  ['5020', 'تكلفة الإكسسوارات وقطع الغيار المباعة', 'expense', 'cogs_parts'],
  ['6010', 'الرواتب والأجور', 'expense', null],
  ['6020', 'إيجار المعرض', 'expense', null],
  ['6030', 'الكهرباء والماء (هيئة كهرباء ومياه دبي/أبوظبي)', 'expense', null],
  ['6040', 'التسويق والإعلان', 'expense', null],
  ['6050', 'التأمين', 'expense', null],
  ['6060', 'رسوم حكومية (ترخيص، هيئة الطرق، تسجيل)', 'expense', null],
  ['6070', 'الصيانة والتجهيز', 'expense', null],
  ['6080', 'رسوم بنكية', 'expense', null],
  ['6090', 'مصروفات متنوعة', 'expense', null],
  ['6100', 'مصروف ضريبة الشركات', 'expense', null],
];

function seedAccounts() {
  const ins = db.prepare('INSERT OR IGNORE INTO accounts(code,name,type,system_key) VALUES(?,?,?,?)');
  for (const a of DEFAULT_ACCOUNTS) ins.run(...a);
}

const accCache = {};
function acc(key) {
  if (accCache[key]) return accCache[key];
  const r = db.prepare('SELECT id FROM accounts WHERE system_key = ? OR code = ?').get(key, key);
  if (!r) throw new HttpError(500, `الحساب النظامي غير موجود: ${key}`);
  return (accCache[key] = r.id);
}
function methodAccount(method) { return method === 'cash' ? acc('cash') : acc('bank'); }

/**
 * ترحيل قيد يومية متوازن.
 * lines: [{account: id|systemKey, debit, credit, memo}]
 */
function postEntry({ date, description, lines, refType = null, refId = null, userId = null }) {
  const clean = lines
    .map(l => ({
      account_id: typeof l.account === 'number' ? l.account : acc(l.account),
      debit: round2(l.debit || 0), credit: round2(l.credit || 0), memo: l.memo || null,
    }))
    .filter(l => l.debit > 0 || l.credit > 0);
  const d = round2(clean.reduce((s, l) => s + l.debit, 0));
  const c = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (clean.length < 2 || d !== c) throw new HttpError(400, `القيد غير متوازن: مدين ${d} ≠ دائن ${c}`);
  const number = nextNumber('journal_entries', 'JV', date);
  const r = db.prepare('INSERT INTO journal_entries(number,date,description,ref_type,ref_id,user_id) VALUES(?,?,?,?,?,?)')
    .run(number, date, description, refType, refId, userId);
  const id = Number(r.lastInsertRowid);
  const ins = db.prepare('INSERT INTO journal_lines(entry_id,account_id,debit,credit,memo) VALUES(?,?,?,?,?)');
  for (const l of clean) ins.run(id, l.account_id, l.debit, l.credit, l.memo);
  return { id, number };
}

/** عكس جميع القيود المرتبطة بمستند (عند الإلغاء) بقيود معاكسة — لا حذف إطلاقاً للحفاظ على سجل التدقيق */
function reverseEntries(refType, refId, date, userId, why) {
  const entries = db.prepare(
    "SELECT * FROM journal_entries WHERE ref_type = ? AND ref_id = ? AND description NOT LIKE 'عكس:%'").all(refType, refId);
  for (const e of entries) {
    const lines = db.prepare('SELECT * FROM journal_lines WHERE entry_id = ?').all(e.id);
    postEntry({
      date, description: `عكس: ${e.description}${why ? ' — ' + why : ''}`,
      lines: lines.map(l => ({ account: l.account_id, debit: l.credit, credit: l.debit, memo: l.memo })),
      refType: refType + '_rev', refId, userId,
    });
  }
}

// ---------------- التقارير ----------------
function balances({ from = null, to = null } = {}) {
  const where = [], params = [];
  if (from) { where.push('e.date >= ?'); params.push(from); }
  if (to) { where.push('e.date <= ?'); params.push(to); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`
    SELECT a.id, a.code, a.name, a.type,
           COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
    FROM accounts a
    LEFT JOIN (SELECT jl.* FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id ${w}) l ON l.account_id = a.id
    GROUP BY a.id ORDER BY a.code`).all(...params);
}

function trialBalance(to) {
  const rows = balances({ to }).filter(r => r.debit || r.credit).map(r => {
    const net = round2(r.debit - r.credit);
    return { ...r, balance_debit: net > 0 ? net : 0, balance_credit: net < 0 ? -net : 0 };
  });
  const totals = rows.reduce((t, r) => ({
    debit: round2(t.debit + r.debit), credit: round2(t.credit + r.credit),
    balance_debit: round2(t.balance_debit + r.balance_debit), balance_credit: round2(t.balance_credit + r.balance_credit),
  }), { debit: 0, credit: 0, balance_debit: 0, balance_credit: 0 });
  return { rows, totals, balanced: totals.balance_debit === totals.balance_credit };
}

function incomeStatement(from, to) {
  const rows = balances({ from, to });
  const rev = rows.filter(r => r.type === 'revenue').map(r => ({ code: r.code, name: r.name, amount: round2(r.credit - r.debit) })).filter(r => r.amount);
  const cogs = rows.filter(r => r.code.startsWith('5')).map(r => ({ code: r.code, name: r.name, amount: round2(r.debit - r.credit) })).filter(r => r.amount);
  const opex = rows.filter(r => r.type === 'expense' && r.code.startsWith('6') && r.code !== '6100')
    .map(r => ({ code: r.code, name: r.name, amount: round2(r.debit - r.credit) })).filter(r => r.amount);
  const sum = a => round2(a.reduce((s, r) => s + r.amount, 0));
  const revenue = sum(rev), costOfSales = sum(cogs), operating = sum(opex);
  const grossProfit = round2(revenue - costOfSales);
  const profitBeforeTax = round2(grossProfit - operating);
  // تقدير ضريبة الشركات: 9% على الأرباح فوق 375,000 درهم سنوياً (تقديري ويفترض أن الفترة سنة كاملة)
  const corporateTaxEstimate = round2(Math.max(0, profitBeforeTax - 375000) * 0.09);
  return { from, to, revenue: rev, cogs, opex, totals: { revenue, costOfSales, grossProfit, operating, profitBeforeTax, corporateTaxEstimate, netProfitAfterEstimatedTax: round2(profitBeforeTax - corporateTaxEstimate) } };
}

function balanceSheet(to) {
  const rows = balances({ to });
  const assets = rows.filter(r => r.type === 'asset').map(r => ({ code: r.code, name: r.name, amount: round2(r.debit - r.credit) })).filter(r => r.amount);
  const liabilities = rows.filter(r => r.type === 'liability').map(r => ({ code: r.code, name: r.name, amount: round2(r.credit - r.debit) })).filter(r => r.amount);
  const equity = rows.filter(r => r.type === 'equity').map(r => ({ code: r.code, name: r.name, amount: round2(r.credit - r.debit) })).filter(r => r.amount);
  const earnings = round2(rows.filter(r => r.type === 'revenue').reduce((s, r) => s + r.credit - r.debit, 0)
    - rows.filter(r => r.type === 'expense').reduce((s, r) => s + r.debit - r.credit, 0));
  if (earnings) equity.push({ code: '—', name: 'أرباح (خسائر) الفترة الحالية', amount: earnings });
  const sum = a => round2(a.reduce((s, r) => s + r.amount, 0));
  const t = { assets: sum(assets), liabilities: sum(liabilities), equity: sum(equity) };
  return { to, assets, liabilities, equity, totals: { ...t, balanced: round2(t.assets - t.liabilities - t.equity) === 0 } };
}

/** ملخص ضريبة القيمة المضافة (مرجع لإقرار VAT 201 لدى الهيئة الاتحادية للضرائب) */
function vatReport(from, to) {
  const rows = balances({ from, to });
  const by = code => rows.find(r => r.code === code) || { debit: 0, credit: 0 };
  const outputVat = round2(by('2100').credit - by('2100').debit);
  const inputVat = round2(by('1300').debit - by('1300').credit);
  const taxableSales = round2(rows.filter(r => r.type === 'revenue').reduce((s, r) => s + r.credit - r.debit, 0));
  const taxablePurchases = round2(rows.filter(r => r.code === '1200' || r.code === '1210').reduce((s, r) => s + r.debit, 0));
  return { from, to, taxableSales, outputVat, taxablePurchases, inputVat, netVatPayable: round2(outputVat - inputVat) };
}

function ledger(accountId, from, to) {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!a) throw new HttpError(404, 'الحساب غير موجود');
  const debitNormal = a.type === 'asset' || a.type === 'expense';
  const open = db.prepare(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=? AND e.date < ?`).get(accountId, from || '0000-00-00');
  let bal = round2(debitNormal ? open.d - open.c : open.c - open.d);
  const opening = bal;
  const where = ['l.account_id = ?']; const params = [accountId];
  if (from) { where.push('e.date >= ?'); params.push(from); }
  if (to) { where.push('e.date <= ?'); params.push(to); }
  const lines = db.prepare(`SELECT e.date, e.number, e.description, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE ${where.join(' AND ')} ORDER BY e.date, e.id, l.id`).all(...params)
    .map(l => { bal = round2(bal + (debitNormal ? l.debit - l.credit : l.credit - l.debit)); return { ...l, balance: bal }; });
  return { account: a, opening, lines, closing: bal };
}

module.exports = { seedAccounts, acc, methodAccount, postEntry, reverseEntries, trialBalance, incomeStatement, balanceSheet, vatReport, ledger, DEFAULT_ACCOUNTS };
