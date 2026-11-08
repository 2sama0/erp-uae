// backend/seed.js — بيانات تجريبية واقعية لمعرض سيارات في الإمارات
// الاستخدام:  npm run seed        (يعمل فقط إذا كانت القاعدة فارغة)
//            npm run reset       (يمسح القاعدة ويعيد إنشاءها)
'use strict';
const fs = require('fs');
const path = require('path');

if (process.argv.includes('--reset')) {
  const p = path.resolve(process.cwd(), process.env.DB_PATH || 'backend/data/erp.db');
  for (const f of [p, p + '-wal', p + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
}

const { db, setSetting, tx } = require('./db');
const { hashPassword } = require('./auth');
const UAE = require('./uae');
const accounting = require('./services/accounting');
const { createSale } = require('./services/sales');
const { createPurchase, receivePurchase } = require('./services/purchases');
const { recordPayment } = require('./services/payments');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@2026';
const daysAgo = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
let seedState = 42;
const rnd = () => (seedState = (seedState * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];

function emiratesId(year, serial) {
  const body = `784${year}${String(serial).padStart(7, '0')}`;
  return body + UAE.luhnCheckDigit(body);
}

function seed() {
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    console.log('⚠️  قاعدة البيانات تحتوي بيانات مسبقاً. استخدم:  npm run reset');
    return false;
  }
  tx(() => {
    accounting.seedAccounts();
    setSetting('company_name', 'معرض السيارات (غيّر الاسم من الإعدادات)');
    setSetting('company_name_en', 'Car Showroom LLC');
    setSetting('trn', '100234567800003');   // رقم تجريبي — استبدله برقمك الضريبي الحقيقي
    setSetting('address', 'شارع الشيخ زايد، دبي، الإمارات العربية المتحدة');
    setSetting('phone', '+97144001234');
    setSetting('email', 'info@example.ae');
    setSetting('bank_name', 'اسم البنك');
    setSetting('iban', 'AE000000000000000000000');
    setSetting('vat_rate', String(UAE.VAT_RATE));

    const ins = db.prepare('INSERT INTO users(username,full_name,password_hash,role) VALUES(?,?,?,?)');
    const pw = hashPassword(DEMO_PASSWORD);
    ins.run('admin', 'مدير النظام', pw, 'admin');
    ins.run('sales1', 'خالد الشامسي (المبيعات)', pw, 'sales');
    ins.run('purchasing1', 'سالم الكعبي (المشتريات)', pw, 'purchasing');
    ins.run('accountant1', 'مريم المهيري (المحاسبة)', pw, 'accountant');
    ins.run('warehouse1', 'راشد النعيمي (المخازن)', pw, 'warehouse');
  });

  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  const U = { id: admin.id, role: 'admin' };

  // رأس المال الافتتاحي
  accounting.postEntry({ date: daysAgo(190), description: 'قيد افتتاحي: رأس المال المدفوع', refType: 'manual', userId: U.id,
    lines: [{ account: 'bank', debit: 3000000 }, { account: 'capital', credit: 3000000 }] });

  // المخازن
  const wh = db.prepare('INSERT INTO warehouses(name,emirate,location,capacity,manager) VALUES(?,?,?,?,?)');
  const W = {
    dubai: Number(wh.run('المعرض الرئيسي - دبي', 'دبي', 'القوز، شارع الشيخ زايد', 40, 'راشد النعيمي').lastInsertRowid),
    ad: Number(wh.run('مخزن أبوظبي', 'أبوظبي', 'مصفح الصناعية', 30, 'عبدالله المنصوري').lastInsertRowid),
    shj: Number(wh.run('مخزن الشارقة', 'الشارقة', 'المنطقة الصناعية 5', 25, 'ماجد القاسمي').lastInsertRowid),
    acc: Number(wh.run('مخزن الإكسسوارات وقطع الغيار - دبي', 'دبي', 'القوز الصناعية 3', 2000, 'يوسف البلوشي').lastInsertRowid),
  };

  // العملاء (هويات إماراتية صحيحة حسابياً، أرقام هواتف بصيغة الدولة)
  const cust = db.prepare('INSERT INTO customers(code,type,name,phone,email,emirates_id,trade_license,trn,emirate,address,credit_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const people = [
    ['محمد علي الكعبي', '+971501234567', 'dubai', 'دبي', 1985], ['خالد سعيد المنصوري', '+971527654321', 'ad', 'أبوظبي', 1979],
    ['فاطمة أحمد الشامسي', '+971555551234', 'shj', 'الشارقة', 1990], ['عبدالله راشد النعيمي', '+971504448899', 'ajm', 'عجمان', 1988],
    ['سلطان حمد الظاهري', '+971565551212', 'ad', 'أبوظبي', 1982], ['Ahmed Khan', '+971529990011', 'dubai', 'دبي', 1987],
    ['Sara Thomas', '+971581112233', 'dubai', 'دبي', 1993], ['ماجد جمعة السويدي', '+971544005566', 'rak', 'رأس الخيمة', 1984],
  ];
  people.forEach((p, i) => cust.run(`C-${String(i + 1).padStart(4, '0')}`, 'individual', p[0], p[1], null, UAE.formatEmiratesId(emiratesId(p[4], 1000000 + i * 7919)), null, null, p[3], null, 0));
  cust.run('C-0009', 'company', 'شركة الخليج للنقل والخدمات ذ.م.م', '+97143335566', 'fleet@gulf-transport.example', null, 'CN-1234567', '100345678900003', 'دبي', 'ديرة، دبي', 2000000);
  cust.run('C-0010', 'company', 'مؤسسة النخبة للسياحة', '+97126667788', 'info@elite-tours.example', null, 'CN-7654321', '100456789000003', 'أبوظبي', 'المرور، أبوظبي', 1000000);

  // الموردون
  const sup = db.prepare('INSERT INTO suppliers(code,name,phone,email,trn,emirate,address) VALUES(?,?,?,?,?,?,?)');
  const S = [
    sup.run('S-0001', 'الوكالة الخليجية للسيارات', '+97143001122', 'sales@gulf-agency.example', '100567890100003', 'دبي', 'جبل علي').lastInsertRowid,
    sup.run('S-0002', 'مزاد الإمارات للسيارات المستعملة', '+97165552233', 'auction@emirates-auction.example', '100678901200003', 'الشارقة', 'سوق السيارات - الشارقة').lastInsertRowid,
    sup.run('S-0003', 'الإمارات لقطع الغيار والإكسسوارات', '+97143334455', 'parts@uae-parts.example', '100789012300003', 'دبي', 'القوز الصناعية').lastInsertRowid,
    sup.run('S-0004', 'شركة النور للتظليل والحماية', '+97126001122', 'info@alnoor-ppf.example', '100890123400003', 'أبوظبي', 'مصفح').lastInsertRowid,
  ].map(Number);

  // ---------- مشتريات السيارات ----------
  const cars = [
    ['JTM', 'Toyota', 'Land Cruiser GXR', 2025, 'أبيض', 245000, 268000, 'new', W.dubai],
    ['JN8', 'Nissan', 'Patrol SE', 2025, 'أسود', 215000, 238000, 'new', W.dubai],
    ['JTJ', 'Lexus', 'LX 600', 2025, 'رمادي', 430000, 468000, 'new', W.dubai],
    ['WDC', 'Mercedes-Benz', 'G 63 AMG', 2025, 'أسود', 690000, 740000, 'new', W.ad],
    ['5UX', 'BMW', 'X5 xDrive40i', 2025, 'أزرق', 285000, 318000, 'new', W.dubai],
    ['SAL', 'Land Rover', 'Range Rover Sport', 2025, 'رمادي', 380000, 415000, 'new', W.ad],
    ['4T1', 'Toyota', 'Camry SE', 2025, 'فضي', 92000, 104000, 'new', W.shj],
    ['1HG', 'Honda', 'Accord Sport', 2025, 'أبيض', 98000, 108000, 'new', W.shj],
    ['7SA', 'Tesla', 'Model Y Long Range', 2025, 'أبيض', 150000, 172000, 'new', W.dubai],
    ['KND', 'Kia', 'Sportage GT-Line', 2025, 'أحمر', 82000, 92000, 'new', W.shj],
    ['KM8', 'Hyundai', 'Tucson Limited', 2025, 'رمادي', 78000, 88000, 'new', W.shj],
    ['WP1', 'Porsche', 'Cayenne', 2024, 'أسود', 310000, 345000, 'used', W.dubai, 41000],
    ['1GN', 'Chevrolet', 'Tahoe LT', 2024, 'أبيض', 150000, 172000, 'used', W.ad, 38000],
    ['JMB', 'Mitsubishi', 'Pajero GLS', 2024, 'فضي', 88000, 102000, 'used', W.shj, 52000],
  ];
  const carPurchaseDates = [172, 170, 168, 160, 158, 150, 142, 140, 135, 128, 126, 120, 118, 115];
  const carIds = [];
  cars.forEach((c, i) => {
    const date = daysAgo(carPurchaseDates[i]);
    const po = createPurchase({
      date, supplier_id: c[7] === 'used' || c[7] === undefined ? S[0] : S[0], warehouse_id: c[8], supplier_invoice_no: `SI-${1000 + i}`,
      due_date: daysAgo(carPurchaseDates[i] - 30),
      lines: [{ qty: 1, unit_cost: c[5], new_product: {
        type: 'car', name: `${c[1]} ${c[2]} ${c[3]}`, make: c[1], model: c[2], year: c[3], color: c[4], condition: c[7], specs: 'مواصفات خليجية (GCC)',
        mileage: c[9] || 0, price: c[6], vin: `${c[0]}${String(100000 + i * 137).padStart(14, '0')}`, category: 'سيارات' } }],
    }, U);
    receivePurchase(po.id, { date }, U);
    // دفع المورد: كامل للأقدم، جزئي للأحدث
    const full = po.total;
    const toPay = i < 9 ? full : Math.round(full * 0.5 * 100) / 100;
    recordPayment({ type: 'disbursement', purchase_id: po.id, date: daysAgo(Math.max(carPurchaseDates[i] - 20, 5)), amount: toPay, method: 'bank_transfer', reference: `TRF-${2000 + i}` }, U);
  });

  // ---------- مشتريات الإكسسوارات وقطع الغيار ----------
  const parts = [
    ['accessory', 'جلد حماية PPF للسيارة كاملة', 'تغليف', 4000, 6500, 5, 10, S[3]],
    ['accessory', 'نانو سيراميك', 'حماية', 1800, 3200, 5, 12, S[3]],
    ['accessory', 'طقم حصائر أرضية', 'إكسسوارات', 250, 450, 10, 40, S[2]],
    ['accessory', 'كاميرا خلفية مع حساسات', 'إلكترونيات', 600, 1100, 5, 15, S[2]],
    ['accessory', 'طقم إطارات 20 بوصة', 'إطارات', 2400, 3600, 4, 12, S[2]],
    ['part', 'زيت محرك 5W-30 (4 لتر)', 'زيوت', 90, 160, 20, 80, S[2]],
    ['part', 'فلتر زيت', 'فلاتر', 18, 40, 30, 120, S[2]],
    ['part', 'بطارية 70 أمبير', 'بطاريات', 320, 520, 6, 20, S[2]],
    ['part', 'أقراص فرامل أمامية', 'فرامل', 420, 700, 6, 16, S[2]],
  ];
  const partIds = [];
  for (const [i, p] of parts.entries()) {
    const date = daysAgo(125 - i);
    const po = createPurchase({ date, supplier_id: p[7], warehouse_id: W.acc, supplier_invoice_no: `PI-${500 + i}`,
      lines: [{ qty: p[6], unit_cost: p[3], new_product: { type: p[0], name: p[1], category: p[2], price: p[4], min_qty: p[5] } }] }, U);
    receivePurchase(po.id, { date }, U);
    recordPayment({ type: 'disbursement', purchase_id: po.id, date: daysAgo(100 - i), amount: po.total, method: 'cheque', reference: `CHQ-${300 + i}` }, U);
  }
  for (const r of db.prepare("SELECT id FROM products WHERE type != 'car' ORDER BY id").all()) partIds.push(r.id);

  // ---------- المبيعات ----------
  const customers = db.prepare('SELECT id, type FROM customers ORDER BY id').all();
  const methods = ['cash', 'bank_transfer', 'cheque', 'card', 'financing'];
  const soldCarOrder = [6, 1, 4, 0, 8, 9, 3, 7, 12]; // فهارس السيارات المباعة (الباقي يبقى في المخزون)
  const carRows = db.prepare("SELECT id, price FROM products WHERE type='car' ORDER BY id").all();
  const sales = [];
  soldCarOrder.forEach((ci, k) => {
    const date = daysAgo(100 - k * 11);
    const car = carRows[ci];
    const c = customers[k % customers.length];
    const method = k % 3 === 0 ? 'financing' : pick(methods);
    const lines = [{ product_id: car.id, qty: 1, unit_price: car.price, discount: k % 2 ? 2000 : 0 }];
    if (k % 2 === 0) lines.push({ product_id: partIds[0], qty: 1 });
    if (k % 3 === 1) lines.push({ product_id: partIds[2], qty: 2 });
    if (k % 4 === 2) lines.push({ product_id: partIds[5], qty: 1 }, { product_id: partIds[6], qty: 1 });
    const s = createSale({ date, customer_id: c.id, payment_method: method, lines, due_date: daysAgo(100 - k * 11 - 14),
      export_zero_rated: k === 7 }, U);
    sales.push(s);
  });
  // قطع وإكسسوارات بيع مباشر
  for (let k = 0; k < 8; k++) {
    const date = daysAgo(70 - k * 8);
    const s = createSale({ date, customer_id: customers[(k + 3) % customers.length].id, payment_method: pick(['cash', 'card']),
      lines: [{ product_id: pick(partIds), qty: 1 + Math.floor(rnd() * 3) }], paid_now: 0 }, U);
    sales.push(s);
  }
  // تحصيلات: معظم الفواتير تُسدد، وبعضها يبقى مفتوحاً/متأخراً
  sales.forEach((s, idx) => {
    if (s.status === 'paid') return;
    const days = Math.max(Math.round((Date.now() - new Date(s.date)) / 864e5) - 5, 1);
    if (idx % 5 === 4) return;                                   // فاتورة بلا تحصيل (متأخرة)
    const partial = idx % 5 === 3;
    const amount = partial ? Math.round(s.total * 0.4 * 100) / 100 : s.total;
    recordPayment({ type: 'receipt', sale_id: s.id, date: daysAgo(Math.max(days - 3, 0)), amount, method: s.payment_method === 'financing' ? 'bank_transfer' : (s.payment_method === 'card' ? 'card' : s.payment_method === 'cheque' ? 'cheque' : 'bank_transfer'), reference: `R-${s.number}` }, U);
  });

  // ---------- مصروفات شهرية ----------
  const exp = code => db.prepare('SELECT id FROM accounts WHERE code = ?').get(code).id;
  for (let m = 5; m >= 0; m--) {
    const base = m * 30;
    const mk = (acct, payee, amount, vat, desc, off) => recordPayment({ type: 'expense', date: daysAgo(Math.max(base - off, 0)), expense_account_id: exp(acct), payee, amount, vat_amount: vat, method: 'bank_transfer', description: desc }, U);
    mk('6020', 'مالك مبنى المعرض', 36750, 1750, 'إيجار المعرض الشهري', 0);
    mk('6010', 'كشف الرواتب (نظام حماية الأجور)', 48000, 0, 'رواتب الموظفين', 2);
    mk('6030', 'هيئة كهرباء ومياه دبي', 4200, 200, 'فاتورة الكهرباء والماء', 5);
    if (m % 2 === 0) mk('6040', 'وكالة إعلانات', 8400, 400, 'حملة إعلانية', 8);
    if (m % 3 === 0) mk('6060', 'هيئة الطرق والمواصلات', 2300, 0, 'رسوم ترخيص وتسجيل', 10);
  }
  return true;
}

if (require.main === module) {
  if (seed()) {
    console.log('✅ تم إنشاء البيانات التجريبية.');
    console.log(`   المستخدمون: admin / sales1 / purchasing1 / accountant1 / warehouse1`);
    if (process.env.DEMO_PASSWORD) console.log('   كلمة المرور: راجع متغير DEMO_PASSWORD في إعدادات النشر.');
    else console.log(`   كلمة المرور التجريبية لجميعهم: ${DEMO_PASSWORD}  (غيّرها فوراً قبل الاستخدام الفعلي)`);
  }
}
module.exports = { seed, DEMO_PASSWORD };
