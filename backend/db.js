// backend/db.js — الاتصال بقاعدة البيانات (SQLite) وتعريف الجداول
'use strict';
const path = require('path');
const fs = require('fs');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('❌ هذا المشروع يحتاج Node.js إصدار 22.13 أو أحدث (يحتوي مكتبة SQLite مدمجة).');
  process.exit(1);
}

const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || 'backend/data/erp.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','sales','purchasing','accountant','warehouse')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  type TEXT NOT NULL DEFAULT 'individual' CHECK (type IN ('individual','company')),
  name TEXT NOT NULL,
  phone TEXT, email TEXT,
  emirates_id TEXT, trade_license TEXT, trn TEXT,
  emirate TEXT, address TEXT,
  credit_limit REAL NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT, email TEXT, trn TEXT,
  emirate TEXT, address TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emirate TEXT, location TEXT,
  capacity INTEGER NOT NULL DEFAULT 0,
  manager TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- كل سيارة سجل مستقل (برقم شاسيه VIN)، أما الإكسسوارات وقطع الغيار فبالكمية
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('car','accessory','part')),
  name TEXT NOT NULL,
  make TEXT, model TEXT, year INTEGER,
  vin TEXT UNIQUE,
  color TEXT,
  condition TEXT CHECK (condition IN ('new','used') OR condition IS NULL),
  specs TEXT,
  mileage INTEGER,
  plate_emirate TEXT, plate_no TEXT,
  category TEXT,
  warehouse_id INTEGER REFERENCES warehouses(id),
  qty REAL NOT NULL DEFAULT 0,
  min_qty REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  warehouse_id INTEGER REFERENCES warehouses(id),
  type TEXT NOT NULL CHECK (type IN ('purchase','sale','sale_cancel','transfer','adjustment','purchase_cancel')),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  ref_type TEXT, ref_id INTEGER,
  user_id INTEGER, note TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL, due_date TEXT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank_transfer','cheque','card','financing')),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','cancelled')),
  vat_rate REAL NOT NULL DEFAULT 0.05,   -- 0.05 عادي، 0 للتصدير خارج الدولة
  subtotal REAL NOT NULL, vat REAL NOT NULL, total REAL NOT NULL,
  paid REAL NOT NULL DEFAULT 0,
  notes TEXT, user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  description TEXT,
  qty REAL NOT NULL, unit_price REAL NOT NULL, discount REAL NOT NULL DEFAULT 0,
  line_subtotal REAL NOT NULL, line_vat REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL, due_date TEXT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','received','cancelled')),
  supplier_invoice_no TEXT,
  vat_rate REAL NOT NULL DEFAULT 0.05,
  subtotal REAL NOT NULL, vat REAL NOT NULL, total REAL NOT NULL,
  paid REAL NOT NULL DEFAULT 0,
  notes TEXT, user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchase_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  new_product TEXT,
  description TEXT,
  qty REAL NOT NULL, unit_cost REAL NOT NULL,
  line_subtotal REAL NOT NULL, line_vat REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  system_key TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  ref_type TEXT, ref_id INTEGER,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  memo TEXT,
  CHECK (debit >= 0 AND credit >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('receipt','disbursement','expense')),
  sale_id INTEGER REFERENCES sales(id),
  purchase_id INTEGER REFERENCES purchases(id),
  amount REAL NOT NULL,
  vat_amount REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','cheque','card')),
  reference TEXT,
  expense_account_id INTEGER REFERENCES accounts(id),
  payee TEXT, description TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','cancelled')),
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id INTEGER, detail TEXT
);

CREATE INDEX IF NOT EXISTS ix_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS ix_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS ix_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS ix_jl_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS ix_jl_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS ix_moves_product ON stock_movements(product_id);
`);

// ---------- أدوات مساعدة ----------
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** تنفيذ مجموعة عمليات كمعاملة واحدة (تُلغى كلها عند أي خطأ). تدعم الاستدعاء المتداخل. */
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn(); // داخل معاملة قائمة: أي خطأ سيُلغي المعاملة الخارجية كلها
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    txDepth--;
  }
}

/** توليد رقم مسلسل مثل INV-2026-0001 */
function nextNumber(table, prefix, date) {
  const year = String(date || new Date().toISOString()).slice(0, 4);
  const like = `${prefix}-${year}-%`;
  const row = db.prepare(`SELECT number FROM ${table} WHERE number LIKE ? ORDER BY id DESC LIMIT 1`).get(like);
  const n = row ? parseInt(row.number.split('-').pop(), 10) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
function audit(userId, action, entity, entityId, detail) {
  db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?)')
    .run(userId || null, action, entity || null, entityId || null, detail ? String(detail).slice(0, 500) : null);
}

module.exports = { db, tx, round2, nextNumber, getSetting, setSetting, audit, DB_PATH };
