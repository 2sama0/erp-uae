// backend/services/sales.js — الفاتورة الضريبية: تخرج من المخزن وتُرحّل للحسابات وتحتسب VAT
'use strict';
const { db, tx, round2, nextNumber, getSetting, audit } = require('../db');
const { HttpError, reqDate, reqNum, optStr } = require('../http');
const { postEntry, reverseEntries } = require('./accounting');
const { moveStock } = require('./inventory');
const { recordPayment } = require('./payments');

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'financing'];

function vatRateFor(body) {
  // تصدير خارج الدولة = معدّل بنسبة 0%
  if (body.export_zero_rated) return 0;
  return Number(getSetting('vat_rate', '0.05'));
}

function createSale(body, user) {
  const date = reqDate(body.date);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(Number(body.customer_id));
  if (!customer) throw new HttpError(400, 'العميل غير موجود أو غير نشط');
  if (!PAYMENT_METHODS.includes(body.payment_method)) throw new HttpError(400, 'طريقة الدفع غير صالحة');
  if (!Array.isArray(body.lines) || !body.lines.length) throw new HttpError(400, 'أضف منتجاً واحداً على الأقل');
  if (body.lines.length > 50) throw new HttpError(400, 'عدد البنود كبير جداً');
  const vatRate = vatRateFor(body);

  const seen = new Set();
  const lines = body.lines.map((l, i) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(l.product_id));
    if (!p) throw new HttpError(400, `البند ${i + 1}: المنتج غير موجود`);
    if (seen.has(p.id)) throw new HttpError(400, `المنتج «${p.name}» مكرر في الفاتورة`);
    seen.add(p.id);
    const qty = reqNum(l.qty ?? 1, `كمية «${p.name}»`);
    if (p.type === 'car' && qty !== 1) throw new HttpError(400, `السيارة «${p.name}» وحدة واحدة`);
    if (p.qty < qty) throw new HttpError(400, `«${p.name}» غير متوفر بالكمية المطلوبة (المتوفر ${p.qty})`);
    const price = l.unit_price === undefined || l.unit_price === '' ? p.price : reqNum(l.unit_price, `سعر «${p.name}»`, { min: 0, allowZero: true });
    const discount = round2(Number(l.discount || 0));
    const gross = round2(qty * price);
    if (discount < 0 || discount > gross) throw new HttpError(400, `خصم «${p.name}» غير صالح`);
    const subtotal = round2(gross - discount);
    return { p, qty, price, discount, subtotal, vat: round2(subtotal * vatRate) };
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
  const vat = round2(lines.reduce((s, l) => s + l.vat, 0));
  const total = round2(subtotal + vat);
  const paidNow = round2(Number(body.paid_now || 0));
  if (paidNow < 0 || paidNow > total) throw new HttpError(400, 'المبلغ المدفوع الآن غير صالح');
  if (paidNow > 0 && !['cash', 'bank_transfer', 'cheque', 'card'].includes(body.paid_method || body.payment_method)) {
    throw new HttpError(400, 'حدّد طريقة دفع الدفعة المقدمة');
  }
  if (Number(customer.credit_limit) > 0) {
    const out = db.prepare("SELECT COALESCE(SUM(total-paid),0) o FROM sales WHERE customer_id=? AND status IN ('unpaid','partial')").get(customer.id).o;
    if (out + total - paidNow > customer.credit_limit) {
      throw new HttpError(400, `تجاوز الحد الائتماني للعميل (${customer.credit_limit} د.إ)`);
    }
  }

  return tx(() => {
    const number = nextNumber('sales', 'INV', date);
    const r = db.prepare(`INSERT INTO sales(number,date,due_date,customer_id,payment_method,vat_rate,subtotal,vat,total,notes,user_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(number, date, body.due_date ? reqDate(body.due_date, 'تاريخ الاستحقاق') : date, customer.id, body.payment_method, vatRate, subtotal, vat, total, optStr(body.notes), user.id);
    const saleId = Number(r.lastInsertRowid);

    let revCars = 0, revParts = 0, cogsCars = 0, cogsParts = 0;
    for (const l of lines) {
      db.prepare(`INSERT INTO sale_lines(sale_id,product_id,description,qty,unit_price,discount,line_subtotal,line_vat,unit_cost)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(saleId, l.p.id, l.p.name, l.qty, l.price, l.discount, l.subtotal, l.vat, l.p.cost);
      moveStock({ date, productId: l.p.id, type: 'sale', qty: -l.qty, unitCost: l.p.cost, refType: 'sale', refId: saleId, userId: user.id, note: `فاتورة ${number}` });
      const cost = round2(l.qty * l.p.cost);
      if (l.p.type === 'car') { revCars += l.subtotal; cogsCars += cost; } else { revParts += l.subtotal; cogsParts += cost; }
    }
    postEntry({
      date, description: `فاتورة بيع ${number} — ${customer.name}`, refType: 'sale', refId: saleId, userId: user.id,
      lines: [
        { account: 'ar', debit: total },
        { account: 'rev_cars', credit: revCars }, { account: 'rev_parts', credit: revParts },
        { account: 'vat_out', credit: vat },
        { account: 'cogs_cars', debit: cogsCars }, { account: 'inv_cars', credit: cogsCars },
        { account: 'cogs_parts', debit: cogsParts }, { account: 'inv_parts', credit: cogsParts },
      ],
    });
    if (paidNow > 0) {
      recordPayment({ type: 'receipt', sale_id: saleId, date, amount: paidNow, method: body.paid_method || body.payment_method, reference: body.paid_reference, description: 'دفعة مقدمة عند البيع' }, user);
    }
    audit(user.id, 'create', 'sale', saleId, `${number} ${total}`);
    return getSale(saleId);
  });
}

function getSale(id) {
  const s = db.prepare(`SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.emirates_id, c.trn AS customer_trn, c.type AS customer_type, c.address AS customer_address, c.emirate AS customer_emirate
    FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`).get(id);
  if (!s) throw new HttpError(404, 'الفاتورة غير موجودة');
  s.lines = db.prepare(`SELECT l.*, p.type, p.vin, p.make, p.model, p.year, p.color, p.sku FROM sale_lines l JOIN products p ON p.id = l.product_id WHERE l.sale_id = ?`).all(id);
  s.payments = db.prepare("SELECT * FROM payments WHERE sale_id = ? AND status = 'posted' ORDER BY date, id").all(id);
  s.remaining = round2(s.total - s.paid);
  return s;
}

function cancelSale(id, user) {
  const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!s) throw new HttpError(404, 'الفاتورة غير موجودة');
  if (s.status === 'cancelled') throw new HttpError(400, 'الفاتورة ملغاة مسبقاً');
  if (s.paid > 0) throw new HttpError(400, 'توجد دفعات مسجلة على هذه الفاتورة. ألغِ سندات القبض أولاً ثم ألغِ الفاتورة');
  return tx(() => {
    const date = new Date().toISOString().slice(0, 10);
    for (const l of db.prepare('SELECT * FROM sale_lines WHERE sale_id = ?').all(id)) {
      moveStock({ date, productId: l.product_id, type: 'sale_cancel', qty: l.qty, unitCost: l.unit_cost, refType: 'sale', refId: id, userId: user.id, note: `إلغاء فاتورة ${s.number}` });
    }
    reverseEntries('sale', id, date, user.id, 'إلغاء الفاتورة');
    db.prepare("UPDATE sales SET status = 'cancelled' WHERE id = ?").run(id);
    audit(user.id, 'cancel', 'sale', id, s.number);
    return getSale(id);
  });
}

module.exports = { createSale, getSale, cancelSale, PAYMENT_METHODS };
