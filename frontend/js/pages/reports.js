// التقارير المالية والضريبية (قائمة الدخل، المركز المالي، ضريبة القيمة المضافة، أعمار الديون، مطابقة المخزون)
App.init({ key: 'reports', title: 'التقارير المالية والضريبة', roles: ['accountant'] }, async (root, { meta }) => {
  let tab = 'is';
  const tabs = [['is', 'قائمة الدخل'], ['bs', 'المركز المالي'], ['vat', 'ضريبة القيمة المضافة'], ['aging', 'أعمار الديون'], ['inv', 'مطابقة المخزون']];
  root.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div class="toolbar"><label>من</label><input type="date" id="from" class="form-control" style="width:auto" value="${F.yearStart()}"><label>إلى</label><input type="date" id="to" class="form-control" style="width:auto" value="${F.today()}">
    <button class="btn btn-outline no-print" id="print"><i class="fas fa-print"></i> طباعة</button></div><div id="pane"></div>`;
  const pane = root.querySelector('#pane'), $ = s => root.querySelector(s);
  const q = () => ({ from: $('#from').value, to: $('#to').value });
  const section = (title, rows, key = 'amount') => `<tr class="section"><td colspan="2">${title}</td></tr>` + (rows.length ? rows.map(r => `<tr><td class="indent">${F.esc(r.code)} — ${F.esc(r.name)}</td><td class="amount">${F.money(r[key])}</td></tr>`).join('') : '<tr><td class="indent" colspan="2">—</td></tr>');
  const total = (label, v) => `<tr class="total"><td>${label}</td><td class="amount">${F.money(v)}</td></tr>`;
  const wrap = (title, body) => `<div class="table-container"><div class="table-header"><h2>${title}</h2><span>${F.esc(meta.settings.company_name)} — TRN ${F.esc(meta.settings.trn)}</span></div><table class="data-table report-table"><tbody>${body}</tbody></table></div>`;

  async function show() {
    if (tab === 'is') { const r = await API.get('/api/reports/income-statement', q()), t = r.totals;
      pane.innerHTML = wrap(`قائمة الدخل من ${F.date(r.from)} إلى ${F.date(r.to)}`, section('الإيرادات', r.revenue) + total('إجمالي الإيرادات', t.revenue) + section('تكلفة المبيعات', r.cogs) + total('إجمالي تكلفة المبيعات', t.costOfSales) + total('مجمل الربح', t.grossProfit) +
        section('المصروفات التشغيلية', r.opex) + total('إجمالي المصروفات', t.operating) + total('صافي الربح قبل ضريبة الشركات', t.profitBeforeTax) +
        `<tr><td class="indent">تقدير ضريبة الشركات (9% على ما يزيد عن 375,000 د.إ سنوياً)</td><td class="amount">${F.money(t.corporateTaxEstimate)}</td></tr>` + total('الربح بعد الضريبة التقديرية', t.netProfitAfterEstimatedTax)) +
        '<div class="note" style="margin-top:1rem">تقدير ضريبة الشركات للاسترشاد فقط ويفترض أن الفترة سنة مالية كاملة؛ الاحتساب الفعلي يتم عبر محاسب قانوني وفق أحكام الهيئة الاتحادية للضرائب.</div>'; }
    if (tab === 'bs') { const r = await API.get('/api/reports/balance-sheet', { to: $('#to').value }), t = r.totals;
      pane.innerHTML = `<div class="${t.balanced ? 'ok-box' : 'bad-box'}">${t.balanced ? '✔ الأصول = الخصوم + حقوق الملكية' : '✘ المركز المالي غير متوازن'}</div>` + wrap(`المركز المالي كما في ${F.date(r.to)}`,
        section('الأصول', r.assets) + total('إجمالي الأصول', t.assets) + section('الخصوم', r.liabilities) + total('إجمالي الخصوم', t.liabilities) + section('حقوق الملكية', r.equity) + total('إجمالي حقوق الملكية', t.equity) + total('الخصوم + حقوق الملكية', t.liabilities + t.equity)); }
    if (tab === 'vat') { const r = await API.get('/api/reports/vat', q());
      pane.innerHTML = wrap(`ملخص ضريبة القيمة المضافة (${F.date(r.from)} — ${F.date(r.to)})`,
        `<tr class="section"><td colspan="2">ضريبة المخرجات (على المبيعات)</td></tr><tr><td class="indent">قيمة المبيعات الخاضعة (قبل الضريبة)</td><td class="amount">${F.money(r.taxableSales)}</td></tr><tr><td class="indent">ضريبة المخرجات المستحقة</td><td class="amount">${F.money(r.outputVat)}</td></tr>
         <tr class="section"><td colspan="2">ضريبة المدخلات (على المشتريات والمصروفات)</td></tr><tr><td class="indent">قيمة المشتريات من المخزون (قبل الضريبة)</td><td class="amount">${F.money(r.taxablePurchases)}</td></tr><tr><td class="indent">ضريبة المدخلات القابلة للاسترداد</td><td class="amount">${F.money(r.inputVat)}</td></tr>` + total(r.netVatPayable >= 0 ? 'صافي الضريبة المستحقة للهيئة' : 'صافي الضريبة القابلة للاسترداد', Math.abs(r.netVatPayable))) +
        '<div class="note" style="margin-top:1rem">هذا ملخص مرجعي مبني على القيود المحاسبية لتسهيل تعبئة الإقرار الضريبي (VAT 201) عبر بوابة «إمارات تاكس» التابعة للهيئة الاتحادية للضرائب. راجع الإقرار الفعلي مع محاسب مرخّص.</div>'; }
    if (tab === 'aging') { const r = await API.get('/api/reports/receivables-aging'), b = r.buckets;
      pane.innerHTML = `<div class="stats-overview">${[['غير مستحقة بعد', b.current], ['متأخرة 1–30 يوماً', b.d1_30], ['31–60 يوماً', b.d31_60], ['61–90 يوماً', b.d61_90], ['أكثر من 90 يوماً', b.over90]].map(([t, v]) => `<div class="stat-card"><div class="stat-info"><span class="stat-title">${t}</span><span class="stat-value">${F.money(v)}</span></div></div>`).join('')}</div>` +
        `<div class="table-container">${UI.table([{ label: 'الفاتورة', render: x => `<a href="sales.html?open=${x.id}">${F.esc(x.number)}</a>` }, { label: 'العميل', render: x => F.esc(x.customer_name) }, { label: 'الاستحقاق', render: x => F.date(x.due_date) },
          { label: 'أيام التأخر', render: x => x.days_overdue > 0 ? `<span class="badge red">${x.days_overdue}</span>` : '—' }, { label: 'المتبقي', cls: 'amount', render: x => F.money(x.remaining) }], r.rows, { empty: 'لا توجد مستحقات ✔' })}</div>`; }
    if (tab === 'inv') { const r = await API.get('/api/reports/inventory-reconciliation'); const ok = r.cars.diff === 0 && Math.abs(r.parts.diff) < 1;
      pane.innerHTML = `<div class="${ok ? 'ok-box' : 'bad-box'}">${ok ? '✔ قيمة المخزون في المستودعات تطابق أرصدة حسابات المخزون' : '✘ يوجد فرق بين المخزون الفعلي والحسابات'}</div><div class="table-container">${UI.table([{ label: 'البند', render: x => x.n }, { label: 'قيمة المخزون الفعلية', cls: 'amount', render: x => F.money(x.s.stock) }, { label: 'رصيد الحساب', cls: 'amount', render: x => F.money(x.s.ledger) }, { label: 'الفرق', cls: 'amount', render: x => F.money(x.s.diff) }],
        [{ n: 'مخزون السيارات (1200)', s: r.cars }, { n: 'مخزون الإكسسوارات وقطع الغيار (1210)', s: r.parts }])}</div>`; }
  }
  UI.on(root, 'click', '[data-tab]', el => { tab = el.dataset.tab; root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === el)); UI.guard(show); });
  ['#from', '#to'].forEach(s => $(s).addEventListener('change', () => UI.guard(show))); $('#print').addEventListener('click', () => window.print());
  UI.guard(show);
});
