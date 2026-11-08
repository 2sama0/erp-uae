// backend/routes/master.js — العملاء، الموردون، المخازن، المنتجات
'use strict';
const { db, round2, audit } = require('../db');
const { HttpError, reqStr, optStr, reqNum } = require('../http');
const UAE = require('../uae');
const { adjustStock, transferStock } = require('../services/inventory');

const SALES = ['sales'], PURCH = ['purchasing'], WH = ['warehouse', 'purchasing', 'sales'], ACC = ['accountant'];
const like = q => `%${String(q || '').replace(/[%_]/g, '')}%`;

function cleanParty(body, kind) {
  const o = {
    name: reqStr(body.name, 'الاسم', 150),
    email: optStr(body.email, 120), address: optStr(body.address, 200), emirate: optStr(body.emirate, 40),
    notes: optStr(body.notes, 500), phone: null, trn: null,
  };
  if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) throw new HttpError(400, 'البريد الإلكتروني غير صالح');
  if (body.phone) {
    o.phone = UAE.normalizePhone(body.phone);
    if (!o.phone) throw new HttpError(400, 'رقم الهاتف غير صالح. مثال: 050 123 4567 أو +971 4 123 4567');
  }
  if (o.emirate && !UAE.EMIRATES.includes(o.emirate)) throw new HttpError(400, 'الإمارة غير صالحة');
  if (body.trn) {
    if (!UAE.validateTRN(body.trn)) throw new HttpError(400, 'الرقم الضريبي (TRN) يجب أن يتكون من 15 رقماً');
    o.trn = String(body.trn).replace(/\s/g, '');
  }
  if (kind === 'customer') {
    o.type = body.type === 'company' ? 'company' : 'individual';
    o.emirates_id = null; o.trade_license = null;
    if (o.type === 'individual' && body.emirates_id) {
      if (!UAE.validateEmiratesId(body.emirates_id)) throw new HttpError(400, 'رقم الهوية الإماراتية غير صالح (784-YYYY-NNNNNNN-C)');
      o.emirates_id = UAE.formatEmiratesId(body.emirates_id);
    }
    if (o.type === 'company') o.trade_license = optStr(body.trade_license, 60);
    o.credit_limit = round2(Number(body.credit_limit || 0));
    if (o.credit_limit < 0) throw new HttpError(400, 'الحد الائتماني غير صالح');
  }
  return o;
}

function nextCode(table, prefix) {
  const r = db.prepare(`SELECT code FROM ${table} WHERE code LIKE ? ORDER BY id DESC LIMIT 1`).get(prefix + '-%');
  return `${prefix}-${String(r ? parseInt(r.code.split('-')[1], 10) + 1 : 1).padStart(4, '0')}`;
}

function customerRow(id) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'العميل غير موجود');
  const agg = db.prepare("SELECT COALESCE(SUM(total),0) t, COALESCE(SUM(total-paid),0) b, COUNT(*) n FROM sales WHERE customer_id = ? AND status != 'cancelled'").get(id);
  return { ...c, total_purchases: round2(agg.t), balance: round2(agg.b), sales_count: agg.n };
}

module.exports = [
  // ---------- العملاء ----------
  {
    method: 'GET', path: '/api/customers', roles: [...SALES, ...ACC], handler: ({ query }) => {
      const rows = db.prepare(`SELECT c.*, COALESCE(SUM(CASE WHEN s.status!='cancelled' THEN s.total END),0) AS total_purchases,
          COALESCE(SUM(CASE WHEN s.status IN ('unpaid','partial') THEN s.total-s.paid END),0) AS balance, COUNT(s.id) AS sales_count
        FROM customers c LEFT JOIN sales s ON s.customer_id = c.id
        WHERE (? = '' OR c.name LIKE ? OR c.phone LIKE ? OR c.code LIKE ? OR c.emirates_id LIKE ?) AND (? = '' OR c.type = ?) AND (? = 'all' OR c.active = 1)
        GROUP BY c.id ORDER BY c.id DESC`)
        .all(query.q || '', like(query.q), like(query.q), like(query.q), like(query.q), query.type || '', query.type || '', query.include_inactive ? 'all' : '');
      return rows;
    },
  },
  { method: 'GET', path: '/api/customers/:id', roles: [...SALES, ...ACC], handler: ({ params }) => ({ ...customerRow(Number(params.id)), sales: db.prepare('SELECT id,number,date,total,paid,status FROM sales WHERE customer_id = ? ORDER BY date DESC, id DESC').all(Number(params.id)) }) },
  {
    method: 'POST', path: '/api/customers', roles: SALES, handler: ({ user, body }) => {
      const c = cleanParty(body, 'customer');
      if (c.emirates_id && db.prepare('SELECT 1 FROM customers WHERE emirates_id = ?').get(c.emirates_id)) throw new HttpError(400, 'رقم الهوية مسجل لعميل آخر');
      const r = db.prepare(`INSERT INTO customers(code,type,name,phone,email,emirates_id,trade_license,trn,emirate,address,credit_limit,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(nextCode('customers', 'C'), c.type, c.name, c.phone, c.email, c.emirates_id, c.trade_license, c.trn, c.emirate, c.address, c.credit_limit, c.notes);
      audit(user.id, 'create', 'customer', Number(r.lastInsertRowid), c.name);
      return customerRow(Number(r.lastInsertRowid));
    },
  },
  {
    method: 'PUT', path: '/api/customers/:id', roles: SALES, handler: ({ user, params, body }) => {
      const id = Number(params.id); customerRow(id);
      const c = cleanParty(body, 'customer');
      if (c.emirates_id && db.prepare('SELECT 1 FROM customers WHERE emirates_id = ? AND id != ?').get(c.emirates_id, id)) throw new HttpError(400, 'رقم الهوية مسجل لعميل آخر');
      db.prepare(`UPDATE customers SET type=?,name=?,phone=?,email=?,emirates_id=?,trade_license=?,trn=?,emirate=?,address=?,credit_limit=?,notes=?,active=? WHERE id=?`)
        .run(c.type, c.name, c.phone, c.email, c.emirates_id, c.trade_license, c.trn, c.emirate, c.address, c.credit_limit, c.notes, body.active === false ? 0 : 1, id);
      audit(user.id, 'update', 'customer', id);
      return customerRow(id);
    },
  },
  {
    method: 'DELETE', path: '/api/customers/:id', roles: SALES, handler: ({ user, params }) => {
      const id = Number(params.id); customerRow(id);
      if (db.prepare('SELECT 1 FROM sales WHERE customer_id = ?').get(id)) {
        db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(id);
        audit(user.id, 'deactivate', 'customer', id); return { deactivated: true };
      }
      db.prepare('DELETE FROM customers WHERE id = ?').run(id);
      audit(user.id, 'delete', 'customer', id); return { deleted: true };
    },
  },

  // ---------- الموردون ----------
  {
    method: 'GET', path: '/api/suppliers', roles: [...PURCH, ...ACC], handler: ({ query }) =>
      db.prepare(`SELECT s.*, COALESCE(SUM(CASE WHEN p.status='received' THEN p.total END),0) AS total_purchases,
          COALESCE(SUM(CASE WHEN p.status='received' THEN p.total-p.paid END),0) AS balance, COUNT(p.id) AS orders_count
        FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id
        WHERE (? = '' OR s.name LIKE ? OR s.phone LIKE ? OR s.code LIKE ?) AND (? = 'all' OR s.active = 1)
        GROUP BY s.id ORDER BY s.id DESC`).all(query.q || '', like(query.q), like(query.q), like(query.q), query.include_inactive ? 'all' : ''),
  },
  {
    method: 'POST', path: '/api/suppliers', roles: PURCH, handler: ({ user, body }) => {
      const s = cleanParty(body, 'supplier');
      const r = db.prepare('INSERT INTO suppliers(code,name,phone,email,trn,emirate,address,notes) VALUES(?,?,?,?,?,?,?,?)')
        .run(nextCode('suppliers', 'S'), s.name, s.phone, s.email, s.trn, s.emirate, s.address, s.notes);
      audit(user.id, 'create', 'supplier', Number(r.lastInsertRowid), s.name);
      return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(r.lastInsertRowid));
    },
  },
  {
    method: 'PUT', path: '/api/suppliers/:id', roles: PURCH, handler: ({ user, params, body }) => {
      const id = Number(params.id);
      if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(id)) throw new HttpError(404, 'المورد غير موجود');
      const s = cleanParty(body, 'supplier');
      db.prepare('UPDATE suppliers SET name=?,phone=?,email=?,trn=?,emirate=?,address=?,notes=?,active=? WHERE id=?')
        .run(s.name, s.phone, s.email, s.trn, s.emirate, s.address, s.notes, body.active === false ? 0 : 1, id);
      audit(user.id, 'update', 'supplier', id);
      return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    },
  },
  {
    method: 'DELETE', path: '/api/suppliers/:id', roles: PURCH, handler: ({ user, params }) => {
      const id = Number(params.id);
      if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(id)) throw new HttpError(404, 'المورد غير موجود');
      if (db.prepare('SELECT 1 FROM purchases WHERE supplier_id = ?').get(id)) {
        db.prepare('UPDATE suppliers SET active = 0 WHERE id = ?').run(id); audit(user.id, 'deactivate', 'supplier', id); return { deactivated: true };
      }
      db.prepare('DELETE FROM suppliers WHERE id = ?').run(id); audit(user.id, 'delete', 'supplier', id); return { deleted: true };
    },
  },

  // ---------- المخازن ----------
  {
    method: 'GET', path: '/api/warehouses', handler: () =>
      db.prepare(`SELECT w.*, COALESCE(SUM(p.qty),0) AS used, COUNT(CASE WHEN p.qty>0 THEN 1 END) AS items, COALESCE(SUM(p.qty*p.cost),0) AS value
        FROM warehouses w LEFT JOIN products p ON p.warehouse_id = w.id AND p.active = 1 WHERE w.active = 1 GROUP BY w.id ORDER BY w.id`).all(),
  },
  {
    method: 'POST', path: '/api/warehouses', roles: ['warehouse'], handler: ({ user, body }) => {
      const e = optStr(body.emirate, 40); if (e && !UAE.EMIRATES.includes(e)) throw new HttpError(400, 'الإمارة غير صالحة');
      const r = db.prepare('INSERT INTO warehouses(name,emirate,location,capacity,manager) VALUES(?,?,?,?,?)')
        .run(reqStr(body.name, 'اسم المخزن', 100), e, optStr(body.location, 150), Math.max(0, parseInt(body.capacity, 10) || 0), optStr(body.manager, 100));
      audit(user.id, 'create', 'warehouse', Number(r.lastInsertRowid));
      return db.prepare('SELECT * FROM warehouses WHERE id = ?').get(Number(r.lastInsertRowid));
    },
  },
  {
    method: 'PUT', path: '/api/warehouses/:id', roles: ['warehouse'], handler: ({ user, params, body }) => {
      const id = Number(params.id);
      if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(id)) throw new HttpError(404, 'المخزن غير موجود');
      const e = optStr(body.emirate, 40); if (e && !UAE.EMIRATES.includes(e)) throw new HttpError(400, 'الإمارة غير صالحة');
      db.prepare('UPDATE warehouses SET name=?,emirate=?,location=?,capacity=?,manager=? WHERE id=?')
        .run(reqStr(body.name, 'اسم المخزن', 100), e, optStr(body.location, 150), Math.max(0, parseInt(body.capacity, 10) || 0), optStr(body.manager, 100), id);
      audit(user.id, 'update', 'warehouse', id);
      return db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id);
    },
  },

  // ---------- المنتجات (سيارات / إكسسوارات / قطع غيار) ----------
  {
    method: 'GET', path: '/api/products', handler: ({ query }) => {
      const w = ['p.active = 1'], pr = [];
      if (query.type) { w.push('p.type = ?'); pr.push(query.type); }
      if (query.warehouse_id) { w.push('p.warehouse_id = ?'); pr.push(Number(query.warehouse_id)); }
      if (query.available === '1') w.push('p.qty > 0');
      if (query.low === '1') w.push("p.type != 'car' AND p.min_qty > 0 AND p.qty <= p.min_qty");
      if (query.q) { w.push('(p.name LIKE ? OR p.vin LIKE ? OR p.sku LIKE ? OR p.make LIKE ? OR p.model LIKE ?)'); pr.push(...Array(5).fill(like(query.q))); }
      return db.prepare(`SELECT p.*, w.name AS warehouse_name FROM products p LEFT JOIN warehouses w ON w.id = p.warehouse_id WHERE ${w.join(' AND ')} ORDER BY p.id DESC LIMIT 500`).all(...pr);
    },
  },
  {
    method: 'GET', path: '/api/products/:id', handler: ({ params }) => {
      const p = db.prepare('SELECT p.*, w.name AS warehouse_name FROM products p LEFT JOIN warehouses w ON w.id = p.warehouse_id WHERE p.id = ?').get(Number(params.id));
      if (!p) throw new HttpError(404, 'المنتج غير موجود');
      p.movements = db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 50').all(p.id);
      return p;
    },
  },
  {
    // السيارات تدخل المخزون فقط عبر أمر شراء (حتى تبقى الحسابات متوافقة مع المخزون)
    method: 'POST', path: '/api/products', roles: ['warehouse', 'purchasing'], handler: ({ user, body }) => {
      if (!['accessory', 'part'].includes(body.type)) throw new HttpError(400, 'السيارات تُضاف عبر «أمر شراء» برقم الشاسيه. هنا يمكن إضافة إكسسوار أو قطعة غيار فقط');
      const wh = db.prepare('SELECT id FROM warehouses WHERE id = ? AND active = 1').get(Number(body.warehouse_id));
      if (!wh) throw new HttpError(400, 'اختر المخزن');
      const sku = optStr(body.sku, 40) || `${body.type === 'part' ? 'PRT' : 'ACC'}-${Date.now().toString(36).toUpperCase()}`;
      if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku)) throw new HttpError(400, 'رمز المنتج (SKU) مستخدم');
      const r = db.prepare('INSERT INTO products(sku,type,name,category,warehouse_id,min_qty,price) VALUES(?,?,?,?,?,?,?)')
        .run(sku, body.type, reqStr(body.name, 'اسم المنتج', 150), optStr(body.category, 60), wh.id, Math.max(0, Number(body.min_qty || 0)), round2(reqNum(body.price, 'سعر البيع', { min: 0, allowZero: true })));
      audit(user.id, 'create', 'product', Number(r.lastInsertRowid), sku);
      return db.prepare('SELECT * FROM products WHERE id = ?').get(Number(r.lastInsertRowid));
    },
  },
  {
    method: 'PUT', path: '/api/products/:id', roles: ['warehouse', 'purchasing', 'sales'], handler: ({ user, params, body }) => {
      const id = Number(params.id);
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!p) throw new HttpError(404, 'المنتج غير موجود');
      db.prepare('UPDATE products SET name=?,color=?,specs=?,category=?,price=?,min_qty=?,mileage=?,plate_emirate=?,plate_no=? WHERE id=?')
        .run(optStr(body.name, 150) || p.name, optStr(body.color, 40), optStr(body.specs, 100), optStr(body.category, 60),
          round2(reqNum(body.price ?? p.price, 'سعر البيع', { min: 0, allowZero: true })), Math.max(0, Number(body.min_qty ?? p.min_qty)),
          body.mileage ? Number(body.mileage) : null, optStr(body.plate_emirate, 40), optStr(body.plate_no, 20), id);
      audit(user.id, 'update', 'product', id);
      return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    },
  },
  {
    method: 'GET', path: '/api/stock-movements', handler: ({ query }) => {
      const w = [], pr = [];
      if (query.product_id) { w.push('m.product_id = ?'); pr.push(Number(query.product_id)); }
      if (query.type) { w.push('m.type = ?'); pr.push(query.type); }
      return db.prepare(`SELECT m.*, p.name AS product_name, p.sku, wh.name AS warehouse_name, u.full_name AS user_name
        FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN warehouses wh ON wh.id = m.warehouse_id LEFT JOIN users u ON u.id = m.user_id
        ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY m.id DESC LIMIT 300`).all(...pr);
    },
  },
  { method: 'POST', path: '/api/stock/adjust', roles: ['warehouse'], handler: ({ user, body }) => adjustStock(body, user) },
  { method: 'POST', path: '/api/stock/transfer', roles: ['warehouse'], handler: ({ user, body }) => transferStock(body, user) },
];
