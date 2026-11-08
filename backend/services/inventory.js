// backend/services/inventory.js — حركة المخزون (ربط المخازن بالمبيعات والمشتريات والحسابات)
'use strict';
const { db, round2, audit } = require('../db');
const { HttpError, reqDate, reqNum, reqStr, optStr } = require('../http');
const { postEntry } = require('./accounting');

const invKey = type => (type === 'car' ? 'inv_cars' : 'inv_parts');

/** تغيير كمية منتج وتسجيل الحركة. qty موجب = دخول، سالب = خروج */
function moveStock({ date, productId, type, qty, unitCost = 0, refType = null, refId = null, userId = null, note = null, warehouseId = null }) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  const newQty = round2(p.qty + qty);
  if (newQty < 0) throw new HttpError(400, `الكمية غير كافية للمنتج «${p.name}» (المتوفر ${p.qty})`);
  db.prepare('UPDATE products SET qty = ? WHERE id = ?').run(newQty, productId);
  db.prepare(`INSERT INTO stock_movements(date,product_id,warehouse_id,type,qty,unit_cost,ref_type,ref_id,user_id,note)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(date, productId, warehouseId ?? p.warehouse_id, type, qty, unitCost, refType, refId, userId, note);
  return p;
}

/** تسوية جرد: تضبط الكمية الفعلية وتُرحّل فرق القيمة في الحسابات */
function adjustStock(body, user) {
  const date = reqDate(body.date);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(body.product_id));
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  const actual = reqNum(body.actual_qty, 'الكمية الفعلية', { min: 0, allowZero: true });
  if (p.type === 'car' && actual > 1) throw new HttpError(400, 'السيارة وحدة واحدة (كمية 0 أو 1)');
  const delta = round2(actual - p.qty);
  if (delta === 0) throw new HttpError(400, 'لا يوجد فرق في الكمية');
  const reason = reqStr(body.reason, 'سبب التسوية');
  moveStock({ date, productId: p.id, type: 'adjustment', qty: delta, unitCost: p.cost, userId: user.id, note: reason });
  const value = round2(Math.abs(delta) * p.cost);
  if (value > 0) {
    postEntry({
      date, description: `تسوية جرد: ${p.name} (${reason})`, refType: 'adjustment', refId: p.id, userId: user.id,
      lines: delta < 0
        ? [{ account: '6090', debit: value }, { account: invKey(p.type), credit: value }]
        : [{ account: invKey(p.type), debit: value }, { account: '6090', credit: value }],
    });
  }
  audit(user.id, 'adjust', 'product', p.id, `${p.qty} → ${actual}`);
  return db.prepare('SELECT * FROM products WHERE id = ?').get(p.id);
}

/** نقل منتج (أو سيارة) إلى مخزن آخر */
function transferStock(body, user) {
  const date = reqDate(body.date);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(body.product_id));
  const to = db.prepare('SELECT * FROM warehouses WHERE id = ? AND active = 1').get(Number(body.to_warehouse_id));
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  if (!to) throw new HttpError(404, 'المخزن الهدف غير موجود');
  if (p.warehouse_id === to.id) throw new HttpError(400, 'المنتج موجود أصلاً في هذا المخزن');
  const from = db.prepare('SELECT name FROM warehouses WHERE id = ?').get(p.warehouse_id);
  db.prepare('UPDATE products SET warehouse_id = ? WHERE id = ?').run(to.id, p.id);
  db.prepare(`INSERT INTO stock_movements(date,product_id,warehouse_id,type,qty,unit_cost,user_id,note) VALUES(?,?,?,?,?,?,?,?)`)
    .run(date, p.id, to.id, 'transfer', 0, p.cost, user.id, `نقل من «${from ? from.name : '—'}» إلى «${to.name}»${optStr(body.note) ? ' — ' + optStr(body.note) : ''}`);
  audit(user.id, 'transfer', 'product', p.id, `→ ${to.name}`);
  return db.prepare('SELECT * FROM products WHERE id = ?').get(p.id);
}

module.exports = { moveStock, adjustStock, transferStock, invKey };
