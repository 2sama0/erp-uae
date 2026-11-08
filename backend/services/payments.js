// backend/services/payments.js — سندات القبض (من العملاء) والصرف (للموردين) والمصروفات
'use strict';
const { db, round2, nextNumber, audit } = require('../db');
const { HttpError, reqDate, reqNum, reqStr, optStr } = require('../http');
const { postEntry, reverseEntries, methodAccount } = require('./accounting');

const METHODS = ['cash', 'bank_transfer', 'cheque', 'card'];
const PREFIX = { receipt: 'RCV', disbursement: 'PAY', expense: 'EXP' };

function refreshStatus(table, id) {
  const d = db.prepare(`SELECT total, paid, status FROM ${table} WHERE id = ?`).get(id);
  if (d.status === 'cancelled') return;
  if (table === 'sales') {
    const st = d.paid <= 0 ? 'unpaid' : d.paid + 0.004 >= d.total ? 'paid' : 'partial';
    db.prepare('UPDATE sales SET status = ? WHERE id = ?').run(st, id);
  }
}

function recordPayment(body, user) {
  const type = body.type;
  if (!PREFIX[type]) throw new HttpError(400, 'نوع السند غير صالح');
  const date = reqDate(body.date);
  const method = body.method;
  if (!METHODS.includes(method)) throw new HttpError(400, 'طريقة الدفع غير صالحة');
  const amount = round2(reqNum(body.amount, 'المبلغ'));
  const number = nextNumber('payments', PREFIX[type], date);
  let saleId = null, purchaseId = null, expenseAccount = null, vatAmount = 0, payee = optStr(body.payee, 150);

  if (type === 'receipt') {
    const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(body.sale_id));
    if (!s) throw new HttpError(404, 'فاتورة البيع غير موجودة');
    if (s.status === 'cancelled') throw new HttpError(400, 'الفاتورة ملغاة');
    const remaining = round2(s.total - s.paid);
    if (amount > remaining) throw new HttpError(400, `المبلغ أكبر من المتبقي على الفاتورة (${remaining})`);
    saleId = s.id;
    payee = db.prepare('SELECT name FROM customers WHERE id = ?').get(s.customer_id).name;
  } else if (type === 'disbursement') {
    const p = db.prepare('SELECT * FROM purchases WHERE id = ?').get(Number(body.purchase_id));
    if (!p) throw new HttpError(404, 'أمر الشراء غير موجود');
    if (p.status !== 'received') throw new HttpError(400, 'لا يمكن الدفع قبل استلام البضاعة وتسجيل فاتورة المورد');
    const remaining = round2(p.total - p.paid);
    if (amount > remaining) throw new HttpError(400, `المبلغ أكبر من المتبقي للمورد (${remaining})`);
    purchaseId = p.id;
    payee = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(p.supplier_id).name;
  } else {
    const a = db.prepare("SELECT * FROM accounts WHERE id = ? AND type = 'expense' AND active = 1").get(Number(body.expense_account_id));
    if (!a) throw new HttpError(400, 'حساب المصروف غير صالح');
    expenseAccount = a.id;
    vatAmount = round2(Number(body.vat_amount || 0));
    if (vatAmount < 0 || vatAmount >= amount) throw new HttpError(400, 'مبلغ الضريبة غير صالح');
    payee = reqStr(body.payee, 'المستفيد', 150);
  }

  const description = optStr(body.description) || (type === 'receipt' ? 'دفعة من عميل' : type === 'disbursement' ? 'دفعة لمورد' : 'مصروف');

  return require('../db').tx(() => {
    const r = db.prepare(`INSERT INTO payments(number,date,type,sale_id,purchase_id,amount,vat_amount,method,reference,expense_account_id,payee,description,user_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(number, date, type, saleId, purchaseId, amount, vatAmount, method, optStr(body.reference, 100), expenseAccount, payee, description, user.id);
    const id = Number(r.lastInsertRowid);
    const cash = methodAccount(method);
    if (type === 'receipt') {
      postEntry({ date, description: `سند قبض ${number} — ${payee}`, refType: 'payment', refId: id, userId: user.id,
        lines: [{ account: cash, debit: amount }, { account: 'ar', credit: amount }] });
      db.prepare('UPDATE sales SET paid = ? WHERE id = ?').run(round2(db.prepare('SELECT paid FROM sales WHERE id=?').get(saleId).paid + amount), saleId);
      refreshStatus('sales', saleId);
    } else if (type === 'disbursement') {
      postEntry({ date, description: `سند صرف ${number} — ${payee}`, refType: 'payment', refId: id, userId: user.id,
        lines: [{ account: 'ap', debit: amount }, { account: cash, credit: amount }] });
      db.prepare('UPDATE purchases SET paid = ? WHERE id = ?').run(round2(db.prepare('SELECT paid FROM purchases WHERE id=?').get(purchaseId).paid + amount), purchaseId);
    } else {
      postEntry({ date, description: `مصروف ${number} — ${payee}: ${description}`, refType: 'payment', refId: id, userId: user.id,
        lines: [{ account: expenseAccount, debit: round2(amount - vatAmount) }, { account: 'vat_in', debit: vatAmount }, { account: cash, credit: amount }] });
    }
    audit(user.id, 'create', 'payment', id, `${number} ${amount}`);
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  });
}

function cancelPayment(id, user) {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!p) throw new HttpError(404, 'السند غير موجود');
  if (p.status === 'cancelled') throw new HttpError(400, 'السند ملغي مسبقاً');
  return require('../db').tx(() => {
    const date = new Date().toISOString().slice(0, 10);
    reverseEntries('payment', p.id, date, user.id, 'إلغاء السند');
    db.prepare("UPDATE payments SET status = 'cancelled' WHERE id = ?").run(id);
    if (p.sale_id) {
      db.prepare('UPDATE sales SET paid = ? WHERE id = ?').run(round2(db.prepare('SELECT paid FROM sales WHERE id=?').get(p.sale_id).paid - p.amount), p.sale_id);
      refreshStatus('sales', p.sale_id);
    }
    if (p.purchase_id) {
      db.prepare('UPDATE purchases SET paid = ? WHERE id = ?').run(round2(db.prepare('SELECT paid FROM purchases WHERE id=?').get(p.purchase_id).paid - p.amount), p.purchase_id);
    }
    audit(user.id, 'cancel', 'payment', id, p.number);
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  });
}

module.exports = { recordPayment, cancelPayment, METHODS };
