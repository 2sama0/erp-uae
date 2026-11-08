// backend/routes/transactions.js — المبيعات والمشتريات والدفعات
'use strict';
const { db } = require('../db');
const S = require('../services/sales');
const P = require('../services/purchases');
const PAY = require('../services/payments');

const like = q => `%${String(q || '').replace(/[%_]/g, '')}%`;

module.exports = [
  // ---------- المبيعات ----------
  {
    method: 'GET', path: '/api/sales', roles: ['sales', 'accountant'], handler: ({ query }) => {
      const w = [], pr = [];
      if (query.status === 'overdue') w.push("s.status IN ('unpaid','partial') AND s.due_date < date('now')");
      else if (query.status) { w.push('s.status = ?'); pr.push(query.status); }
      if (query.customer_id) { w.push('s.customer_id = ?'); pr.push(Number(query.customer_id)); }
      if (query.from) { w.push('s.date >= ?'); pr.push(query.from); }
      if (query.to) { w.push('s.date <= ?'); pr.push(query.to); }
      if (query.q) { w.push('(s.number LIKE ? OR c.name LIKE ?)'); pr.push(like(query.q), like(query.q)); }
      return db.prepare(`SELECT s.id,s.number,s.date,s.due_date,s.payment_method,s.status,s.subtotal,s.vat,s.total,s.paid,s.total-s.paid AS remaining,
          c.name AS customer_name, (SELECT group_concat(description, '، ') FROM sale_lines WHERE sale_id = s.id) AS items
        FROM sales s JOIN customers c ON c.id = s.customer_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
        ORDER BY s.date DESC, s.id DESC LIMIT 500`).all(...pr);
    },
  },
  { method: 'GET', path: '/api/sales/:id', roles: ['sales', 'accountant'], handler: ({ params }) => S.getSale(Number(params.id)) },
  { method: 'POST', path: '/api/sales', roles: ['sales'], handler: ({ user, body }) => S.createSale(body, user) },
  { method: 'POST', path: '/api/sales/:id/cancel', roles: ['sales', 'accountant'], handler: ({ user, params }) => S.cancelSale(Number(params.id), user) },

  // ---------- المشتريات ----------
  {
    method: 'GET', path: '/api/purchases', roles: ['purchasing', 'accountant', 'warehouse'], handler: ({ query }) => {
      const w = [], pr = [];
      if (query.status) { w.push('p.status = ?'); pr.push(query.status); }
      if (query.supplier_id) { w.push('p.supplier_id = ?'); pr.push(Number(query.supplier_id)); }
      if (query.unpaid === '1') w.push("p.status = 'received' AND p.total > p.paid");
      if (query.q) { w.push('(p.number LIKE ? OR s.name LIKE ? OR p.supplier_invoice_no LIKE ?)'); pr.push(like(query.q), like(query.q), like(query.q)); }
      return db.prepare(`SELECT p.id,p.number,p.date,p.due_date,p.status,p.subtotal,p.vat,p.total,p.paid,p.total-p.paid AS remaining,p.supplier_invoice_no,
          s.name AS supplier_name, w.name AS warehouse_name, (SELECT group_concat(description, '، ') FROM purchase_lines WHERE purchase_id = p.id) AS items
        FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN warehouses w ON w.id = p.warehouse_id
        ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.date DESC, p.id DESC LIMIT 500`).all(...pr);
    },
  },
  { method: 'GET', path: '/api/purchases/:id', roles: ['purchasing', 'accountant', 'warehouse'], handler: ({ params }) => P.getPurchase(Number(params.id)) },
  { method: 'POST', path: '/api/purchases', roles: ['purchasing'], handler: ({ user, body }) => P.createPurchase(body, user) },
  { method: 'POST', path: '/api/purchases/:id/receive', roles: ['purchasing', 'warehouse'], handler: ({ user, params, body }) => P.receivePurchase(Number(params.id), body, user) },
  { method: 'POST', path: '/api/purchases/:id/cancel', roles: ['purchasing', 'accountant'], handler: ({ user, params }) => P.cancelPurchase(Number(params.id), user) },

  // ---------- الدفعات ----------
  {
    method: 'GET', path: '/api/payments', roles: ['accountant', 'sales', 'purchasing'], handler: ({ query }) => {
      const w = [], pr = [];
      if (query.type) { w.push('p.type = ?'); pr.push(query.type); }
      if (query.from) { w.push('p.date >= ?'); pr.push(query.from); }
      if (query.to) { w.push('p.date <= ?'); pr.push(query.to); }
      return db.prepare(`SELECT p.*, s.number AS sale_number, pu.number AS purchase_number, a.name AS expense_account_name
        FROM payments p LEFT JOIN sales s ON s.id = p.sale_id LEFT JOIN purchases pu ON pu.id = p.purchase_id LEFT JOIN accounts a ON a.id = p.expense_account_id
        ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.date DESC, p.id DESC LIMIT 500`).all(...pr);
    },
  },
  {
    method: 'POST', path: '/api/payments', roles: ['accountant', 'sales', 'purchasing'], handler: ({ user, body }) => {
      // أمين الصندوق حسب الدور: المبيعات تسجّل القبض فقط، والمشتريات الصرف للموردين فقط، والمحاسب الكل
      const { HttpError } = require('../http');
      if (user.role === 'sales' && body.type !== 'receipt') throw new HttpError(403, 'ليس لديك صلاحية لهذا النوع من السندات');
      if (user.role === 'purchasing' && body.type !== 'disbursement') throw new HttpError(403, 'ليس لديك صلاحية لهذا النوع من السندات');
      return PAY.recordPayment(body, user);
    },
  },
  { method: 'POST', path: '/api/payments/:id/cancel', roles: ['accountant'], handler: ({ user, params }) => PAY.cancelPayment(Number(params.id), user) },
];
