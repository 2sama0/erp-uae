// backend/services/purchases.js — أمر الشراء ثم الاستلام (يزيد المخزون ويُسجّل ذمة المورد وضريبة المدخلات)
'use strict';
const { db, tx, round2, nextNumber, getSetting, audit } = require('../db');
const { HttpError, reqDate, reqNum, reqStr, optStr } = require('../http');
const { validateVIN } = require('../uae');
const { postEntry, reverseEntries } = require('./accounting');
const { moveStock } = require('./inventory');

function cleanNewProduct(np, i) {
  if (!np || typeof np !== 'object') throw new HttpError(400, `البند ${i + 1}: بيانات المنتج الجديد ناقصة`);
  const type = np.type;
  if (!['car', 'accessory', 'part'].includes(type)) throw new HttpError(400, `البند ${i + 1}: نوع المنتج غير صالح`);
  const out = {
    type, name: reqStr(np.name, `البند ${i + 1}: اسم المنتج`, 150),
    make: optStr(np.make, 60), model: optStr(np.model, 60), year: np.year ? Number(np.year) : null,
    color: optStr(np.color, 40), condition: np.condition === 'used' ? 'used' : (type === 'car' ? 'new' : null),
    specs: optStr(np.specs, 100), mileage: np.mileage ? Number(np.mileage) : null,
    category: optStr(np.category, 60), price: Number(np.price || 0), min_qty: Number(np.min_qty || 0),
    sku: optStr(np.sku, 40), vin: null,
  };
  if (type === 'car') {
    const vin = String(np.vin || '').toUpperCase().trim();
    if (!validateVIN(vin)) throw new HttpError(400, `البند ${i + 1}: رقم الشاسيه (VIN) يجب أن يكون 17 خانة بدون I و O و Q`);
    if (db.prepare('SELECT 1 FROM products WHERE vin = ?').get(vin)) throw new HttpError(400, `رقم الشاسيه ${vin} مسجل مسبقاً`);
    out.vin = vin;
    if (!out.year || out.year < 1990 || out.year > new Date().getFullYear() + 2) throw new HttpError(400, `البند ${i + 1}: سنة الصنع غير صالحة`);
  }
  return out;
}

function createPurchase(body, user) {
  const date = reqDate(body.date);
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND active = 1').get(Number(body.supplier_id));
  if (!supplier) throw new HttpError(400, 'المورد غير موجود أو غير نشط');
  const wh = db.prepare('SELECT * FROM warehouses WHERE id = ? AND active = 1').get(Number(body.warehouse_id));
  if (!wh) throw new HttpError(400, 'المخزن غير موجود');
  if (!Array.isArray(body.lines) || !body.lines.length) throw new HttpError(400, 'أضف بنداً واحداً على الأقل');
  const vatRate = body.import_zero_rated ? 0 : Number(getSetting('vat_rate', '0.05'));

  const vins = new Set();
  const lines = body.lines.map((l, i) => {
    const qty = reqNum(l.qty ?? 1, `البند ${i + 1}: الكمية`);
    const unitCost = reqNum(l.unit_cost, `البند ${i + 1}: سعر الشراء`, { min: 0, allowZero: true });
    let product = null, np = null, desc;
    if (l.product_id) {
      product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(l.product_id));
      if (!product) throw new HttpError(400, `البند ${i + 1}: المنتج غير موجود`);
      if (product.type === 'car') throw new HttpError(400, 'السيارات تُشترى كسجلات جديدة (برقم شاسيه) وليس بإضافة كمية');
      desc = product.name;
    } else {
      np = cleanNewProduct(l.new_product, i);
      if (np.type === 'car') {
        if (qty !== 1) throw new HttpError(400, `البند ${i + 1}: السيارة الواحدة بكمية 1 (أضف سطراً لكل سيارة)`);
        if (vins.has(np.vin)) throw new HttpError(400, `رقم الشاسيه ${np.vin} مكرر`);
        vins.add(np.vin);
      }
      desc = np.name;
    }
    const subtotal = round2(qty * unitCost);
    return { product, np, qty, unitCost, subtotal, vat: round2(subtotal * vatRate), desc };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
  const vat = round2(lines.reduce((s, l) => s + l.vat, 0));

  return tx(() => {
    const number = nextNumber('purchases', 'PO', date);
    const r = db.prepare(`INSERT INTO purchases(number,date,due_date,supplier_id,warehouse_id,vat_rate,supplier_invoice_no,subtotal,vat,total,notes,user_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(number, date, body.due_date ? reqDate(body.due_date, 'تاريخ الاستحقاق') : date, supplier.id, wh.id, vatRate, optStr(body.supplier_invoice_no, 60), subtotal, vat, round2(subtotal + vat), optStr(body.notes), user.id);
    const id = Number(r.lastInsertRowid);
    for (const l of lines) {
      db.prepare(`INSERT INTO purchase_lines(purchase_id,product_id,new_product,description,qty,unit_cost,line_subtotal,line_vat) VALUES(?,?,?,?,?,?,?,?)`)
        .run(id, l.product ? l.product.id : null, l.np ? JSON.stringify(l.np) : null, l.desc, l.qty, l.unitCost, l.subtotal, l.vat);
    }
    audit(user.id, 'create', 'purchase', id, number);
    return getPurchase(id);
  });
}

/** استلام البضاعة: إضافة للمخزون + قيد (مدين مخزون وضريبة مدخلات / دائن المورد) */
function receivePurchase(id, body, user) {
  const p = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
  if (!p) throw new HttpError(404, 'أمر الشراء غير موجود');
  if (p.status !== 'ordered') throw new HttpError(400, 'الأمر ليس في حالة «مطلوب»');
  const date = reqDate((body && body.date) || new Date().toISOString().slice(0, 10), 'تاريخ الاستلام');
  const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(p.supplier_id);

  return tx(() => {
    let invCars = 0, invParts = 0;
    for (const l of db.prepare('SELECT * FROM purchase_lines WHERE purchase_id = ?').all(id)) {
      let productId = l.product_id, type;
      if (l.new_product) {
        const np = JSON.parse(l.new_product);
        if (np.vin && db.prepare('SELECT 1 FROM products WHERE vin = ?').get(np.vin)) throw new HttpError(400, `رقم الشاسيه ${np.vin} أصبح مسجلاً`);
        const sku = np.sku || (np.type === 'car' ? `CAR-${np.vin.slice(-6)}` : `${np.type === 'part' ? 'PRT' : 'ACC'}-${Date.now().toString(36).toUpperCase()}${l.id}`);
        const r = db.prepare(`INSERT INTO products(sku,type,name,make,model,year,vin,color,condition,specs,mileage,category,warehouse_id,qty,min_qty,cost,price)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`)
          .run(sku, np.type, np.name, np.make, np.model, np.year, np.vin, np.color, np.condition, np.specs, np.mileage, np.category || (np.type === 'car' ? 'سيارات' : null), p.warehouse_id, np.min_qty || 0, l.unit_cost, np.price || round2(l.unit_cost * 1.1));
        productId = Number(r.lastInsertRowid);
        db.prepare('UPDATE purchase_lines SET product_id = ? WHERE id = ?').run(productId, l.id);
        type = np.type;
      } else {
        const cur = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        type = cur.type;
        // متوسط التكلفة المرجح
        const newCost = (cur.qty * cur.cost + l.qty * l.unit_cost) / (cur.qty + l.qty);
        db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(newCost, productId);
      }
      moveStock({ date, productId, type: 'purchase', qty: l.qty, unitCost: l.unit_cost, refType: 'purchase', refId: id, userId: user.id, warehouseId: p.warehouse_id, note: `أمر شراء ${p.number}` });
      if (type === 'car') invCars += l.line_subtotal; else invParts += l.line_subtotal;
    }
    postEntry({
      date, description: `استلام أمر شراء ${p.number} — ${supplier.name}`, refType: 'purchase', refId: id, userId: user.id,
      lines: [
        { account: 'inv_cars', debit: invCars }, { account: 'inv_parts', debit: invParts },
        { account: 'vat_in', debit: p.vat }, { account: 'ap', credit: p.total },
      ],
    });
    db.prepare("UPDATE purchases SET status = 'received', supplier_invoice_no = COALESCE(?, supplier_invoice_no) WHERE id = ?")
      .run(optStr(body && body.supplier_invoice_no, 60), id);
    audit(user.id, 'receive', 'purchase', id, p.number);
    return getPurchase(id);
  });
}

function cancelPurchase(id, user) {
  const p = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
  if (!p) throw new HttpError(404, 'أمر الشراء غير موجود');
  if (p.status === 'cancelled') throw new HttpError(400, 'الأمر ملغي مسبقاً');
  if (p.paid > 0) throw new HttpError(400, 'توجد دفعات للمورد. ألغِ سندات الصرف أولاً');
  return tx(() => {
    const date = new Date().toISOString().slice(0, 10);
    if (p.status === 'received') {
      for (const l of db.prepare('SELECT * FROM purchase_lines WHERE purchase_id = ?').all(id)) {
        moveStock({ date, productId: l.product_id, type: 'purchase_cancel', qty: -l.qty, unitCost: l.unit_cost, refType: 'purchase', refId: id, userId: user.id, note: `إلغاء أمر ${p.number}` });
        if (l.new_product) db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(l.product_id);
      }
      reverseEntries('purchase', id, date, user.id, 'إلغاء أمر الشراء');
    }
    db.prepare("UPDATE purchases SET status = 'cancelled' WHERE id = ?").run(id);
    audit(user.id, 'cancel', 'purchase', id, p.number);
    return getPurchase(id);
  });
}

function getPurchase(id) {
  const p = db.prepare(`SELECT p.*, s.name AS supplier_name, s.trn AS supplier_trn, w.name AS warehouse_name
    FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN warehouses w ON w.id = p.warehouse_id WHERE p.id = ?`).get(id);
  if (!p) throw new HttpError(404, 'أمر الشراء غير موجود');
  p.lines = db.prepare('SELECT * FROM purchase_lines WHERE purchase_id = ?').all(id)
    .map(l => ({ ...l, new_product: l.new_product ? JSON.parse(l.new_product) : null }));
  p.payments = db.prepare("SELECT * FROM payments WHERE purchase_id = ? AND status = 'posted' ORDER BY date, id").all(id);
  p.remaining = p.status === 'received' ? round2(p.total - p.paid) : 0;
  return p;
}

module.exports = { createPurchase, receivePurchase, cancelPurchase, getPurchase };
