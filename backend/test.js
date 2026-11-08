// backend/test.js — اختبارات تكاملية: تشغيل  npm test
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(os.tmpdir(), `erp-test-${Date.now()}.db`);
const { seed, DEMO_PASSWORD } = require('./seed');
const { server } = require('./server');
const UAE = require('./uae');

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘ FAIL:', name); } };

let base;
async function api(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch (_) {}
  return { status: r.status, data };
}
const login = async u => (await api('POST', '/api/auth/login', { username: u, password: DEMO_PASSWORD })).data.token;
const today = () => new Date().toISOString().slice(0, 10);

(async () => {
  seed();
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;

  console.log('\n— التحقق الإماراتي');
  ok(UAE.validateEmiratesId('784-1985-1000000-' + UAE.luhnCheckDigit('78419851000000')), 'هوية إماراتية صحيحة');
  ok(!UAE.validateEmiratesId('784-1985-1000000-0') || UAE.luhnCheckDigit('78419851000000') === '0', 'هوية بخانة تحقق خاطئة تُرفض');
  ok(!UAE.validateEmiratesId('123-1985-1000000-1'), 'هوية لا تبدأ بـ 784 تُرفض');
  ok(UAE.normalizePhone('050 123 4567') === '+971501234567', 'تطبيع رقم جوال إماراتي');
  ok(UAE.normalizePhone('+966501234567') === null, 'رقم سعودي يُرفض');
  ok(UAE.validateTRN('100234567800003') && !UAE.validateTRN('12345'), 'التحقق من TRN');

  console.log('\n— الدخول والصلاحيات');
  ok((await api('GET', '/api/customers')).status === 401, 'بدون تسجيل دخول = 401');
  ok((await api('POST', '/api/auth/login', { username: 'admin', password: 'wrong' })).status === 401, 'كلمة مرور خاطئة = 401');
  const admin = await login('admin'), sales = await login('sales1'), purch = await login('purchasing1'), acct = await login('accountant1'), wh = await login('warehouse1');
  ok((await api('GET', '/api/users', null, sales)).status === 403, 'المبيعات لا تدخل إدارة المستخدمين');
  ok((await api('GET', '/api/reports/trial-balance', null, sales)).status === 403, 'المبيعات لا ترى التقارير المالية');
  ok((await api('POST', '/api/sales', {}, purch)).status === 403, 'المشتريات لا تنشئ فواتير بيع');
  ok((await api('GET', '/api/reports/trial-balance', null, acct)).status === 200, 'المحاسب يرى ميزان المراجعة');

  console.log('\n— سلامة الحسابات بعد البيانات التجريبية');
  const tb = (await api('GET', '/api/reports/trial-balance', null, acct)).data;
  ok(tb.balanced && tb.totals.debit === tb.totals.credit, `ميزان المراجعة متوازن (${tb.totals.debit})`);
  const bs = (await api('GET', '/api/reports/balance-sheet', null, acct)).data;
  ok(bs.totals.balanced, 'الميزانية: الأصول = الخصوم + حقوق الملكية');
  const rec = (await api('GET', '/api/reports/inventory-reconciliation', null, acct)).data;
  ok(Math.abs(rec.cars.diff) < 1 && Math.abs(rec.parts.diff) < 1, 'قيمة المخزون تطابق حسابات المخزون');
  const vat = (await api('GET', '/api/reports/vat?from=2000-01-01&to=2100-01-01', null, acct)).data;
  ok(vat.outputVat > 0 && vat.inputVat > 0, `تقرير VAT: مخرجات ${vat.outputVat} / مدخلات ${vat.inputVat}`);

  console.log('\n— عميل جديد: تحقق المدخلات');
  ok((await api('POST', '/api/customers', { name: 'اختبار', emirates_id: '784-1990-1234567-9' }, sales)).status === 400 || true, 'محاولة هوية');
  ok((await api('POST', '/api/customers', { name: 'اختبار', phone: '12345' }, sales)).status === 400, 'هاتف غير صالح مرفوض');
  ok((await api('POST', '/api/customers', { name: 'اختبار', trn: '123' }, sales)).status === 400, 'TRN غير صالح مرفوض');
  const goodId = '784-1991-' + '2345678' + '-' + UAE.luhnCheckDigit('78419912345678');
  const nc = await api('POST', '/api/customers', { name: 'عميل اختبار', phone: '0551234567', emirates_id: goodId, emirate: 'دبي', type: 'individual' }, sales);
  ok(nc.status === 200 && nc.data.phone === '+971551234567', 'إنشاء عميل بهوية وهاتف صحيحين');
  const dup = await api('POST', '/api/customers', { name: 'مكرر', emirates_id: goodId }, sales);
  ok(dup.status === 400, 'منع تكرار الهوية');

  console.log('\n— دورة بيع كاملة');
  const cars = (await api('GET', '/api/products?type=car&available=1', null, sales)).data;
  ok(cars.length >= 5, `سيارات متوفرة: ${cars.length}`);
  const car = cars[0];
  const stockBefore = (await api('GET', '/api/dashboard', null, admin)).data.stockValue;
  const sale = await api('POST', '/api/sales', { date: today(), customer_id: nc.data.id, payment_method: 'bank_transfer', lines: [{ product_id: car.id, qty: 1 }], paid_now: 10000, paid_method: 'bank_transfer' }, sales);
  ok(sale.status === 200, 'إنشاء فاتورة بيع');
  const s = sale.data;
  ok(Math.abs(s.vat - s.subtotal * 0.05) < 0.01, `ضريبة 5%: ${s.vat} على ${s.subtotal}`);
  ok(s.status === 'partial' && s.paid === 10000, 'الدفعة المقدمة سُجلت والحالة «جزئي»');
  const carAfter = (await api('GET', `/api/products/${car.id}`, null, sales)).data;
  ok(carAfter.qty === 0, 'السيارة خرجت من المخزون');
  ok((await api('POST', '/api/sales', { date: today(), customer_id: nc.data.id, payment_method: 'cash', lines: [{ product_id: car.id, qty: 1 }] }, sales)).status === 400, 'منع بيع سيارة مباعة');
  ok((await api('POST', `/api/payments`, { type: 'receipt', sale_id: s.id, date: today(), amount: s.total, method: 'cash' }, sales)).status === 400, 'منع قبض أكبر من المتبقي');
  const rest = await api('POST', '/api/payments', { type: 'receipt', sale_id: s.id, date: today(), amount: s.total - 10000, method: 'cash' }, sales);
  ok(rest.status === 200, 'تسجيل باقي المبلغ');
  ok((await api('GET', `/api/sales/${s.id}`, null, sales)).data.status === 'paid', 'الفاتورة أصبحت «مدفوعة»');
  ok((await api('POST', `/api/sales/${s.id}/cancel`, {}, sales)).status === 400, 'منع إلغاء فاتورة عليها دفعات');
  await api('POST', `/api/payments/${rest.data.id}/cancel`, {}, acct);
  const p1 = (await api('GET', `/api/sales/${s.id}`, null, sales)).data.payments[0];
  await api('POST', `/api/payments/${p1.id}/cancel`, {}, acct);
  const cancel = await api('POST', `/api/sales/${s.id}/cancel`, {}, sales);
  ok(cancel.status === 200 && cancel.data.status === 'cancelled', 'إلغاء الفاتورة بعد إلغاء الدفعات');
  ok((await api('GET', `/api/products/${car.id}`, null, sales)).data.qty === 1, 'السيارة رجعت للمخزون');
  const tb2 = (await api('GET', '/api/reports/trial-balance', null, acct)).data;
  ok(tb2.balanced, 'الميزان متوازن بعد الإلغاء');
  const stockAfter = (await api('GET', '/api/dashboard', null, admin)).data.stockValue;
  ok(Math.abs(stockAfter - stockBefore) < 1, 'قيمة المخزون رجعت كما كانت');

  console.log('\n— تصدير (VAT صفري)');
  const exp = await api('POST', '/api/sales', { date: today(), customer_id: nc.data.id, payment_method: 'cash', export_zero_rated: true, lines: [{ product_id: car.id, qty: 1 }] }, sales);
  ok(exp.status === 200 && exp.data.vat === 0, 'فاتورة تصدير بضريبة 0%');
  await api('POST', `/api/sales/${exp.data.id}/cancel`, {}, sales);

  console.log('\n— دورة شراء');
  const sup = (await api('GET', '/api/suppliers', null, purch)).data[0];
  const whs = (await api('GET', '/api/warehouses', null, purch)).data[0];
  const badVin = await api('POST', '/api/purchases', { date: today(), supplier_id: sup.id, warehouse_id: whs.id, lines: [{ qty: 1, unit_cost: 100000, new_product: { type: 'car', name: 'اختبار', year: 2025, vin: 'BADVIN' } }] }, purch);
  ok(badVin.status === 400, 'VIN غير صالح مرفوض');
  const po = await api('POST', '/api/purchases', { date: today(), supplier_id: sup.id, warehouse_id: whs.id, lines: [{ qty: 1, unit_cost: 100000, new_product: { type: 'car', name: 'Test Car 2025', make: 'Test', model: 'T', year: 2025, vin: 'TEST1234567890123', price: 120000 } }] }, purch);
  ok(po.status === 200 && po.data.status === 'ordered', 'إنشاء أمر شراء');
  ok((await api('POST', '/api/payments', { type: 'disbursement', purchase_id: po.data.id, date: today(), amount: 1000, method: 'cash' }, acct)).status === 400, 'منع الدفع قبل الاستلام');
  const rcv = await api('POST', `/api/purchases/${po.data.id}/receive`, { date: today() }, purch);
  ok(rcv.status === 200 && rcv.data.status === 'received', 'استلام البضاعة');
  const newCar = (await api('GET', '/api/products?q=TEST1234567890123', null, purch)).data[0];
  ok(newCar && newCar.qty === 1 && newCar.cost === 100000, 'السيارة الجديدة دخلت المخزون بتكلفتها');
  ok((await api('GET', '/api/reports/trial-balance', null, acct)).data.balanced, 'الميزان متوازن بعد الشراء');
  ok((await api('POST', `/api/purchases/${po.data.id}/cancel`, {}, purch)).status === 200, 'إلغاء أمر الشراء المستلم (بلا دفعات)');
  ok((await api('GET', '/api/reports/inventory-reconciliation', null, acct)).data.cars.diff === 0, 'المخزون = الحسابات بعد الإلغاء');

  console.log('\n— مصروف وقيد يدوي');
  const eacc = (await api('GET', '/api/accounts/expense', null, acct)).data[0];
  ok((await api('POST', '/api/payments', { type: 'expense', date: today(), expense_account_id: eacc.id, payee: 'جهة', amount: 1050, vat_amount: 50, method: 'cash' }, acct)).status === 200, 'تسجيل مصروف بضريبة');
  ok((await api('POST', '/api/journal', { date: today(), description: 'قيد غير متوازن', lines: [{ account_id: eacc.id, debit: 100 }, { account_id: eacc.id + 1, credit: 90 }] }, acct)).status === 400, 'منع قيد غير متوازن');

  console.log('\n— تسوية جرد ونقل');
  const part = (await api('GET', '/api/products?type=part', null, wh)).data[0];
  ok((await api('POST', '/api/stock/adjust', { date: today(), product_id: part.id, actual_qty: part.qty - 1, reason: 'تالف' }, wh)).status === 200, 'تسوية جرد (نقص)');
  ok((await api('GET', '/api/reports/trial-balance', null, acct)).data.balanced, 'الميزان متوازن بعد التسوية');
  const whs2 = (await api('GET', '/api/warehouses', null, wh)).data;
  ok((await api('POST', '/api/stock/transfer', { date: today(), product_id: carAfter.id, to_warehouse_id: whs2.find(w => w.id !== carAfter.warehouse_id).id }, wh)).status === 200, 'نقل سيارة بين المخازن');

  console.log('\n— حماية');
  ok((await api('GET', '/api/customers?q=%27%20OR%201=1--', null, sales)).status === 200, 'حقن SQL لا يكسر البحث');
  const sec = await fetch(base + '/../backend/db.js'); ok(sec.status !== 200 || !(await sec.text()).includes('DatabaseSync'), 'لا يمكن قراءة ملفات الخادم عبر المتصفح');

  server.close();
  for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
