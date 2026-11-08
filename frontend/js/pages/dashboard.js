// لوحة التحكم: مؤشرات من قاعدة البيانات مباشرة
App.init({ key: 'dashboard', title: 'لوحة التحكم' }, async (root) => {
  const d = await API.get('/api/dashboard');
  const card = (icon, title, value, sub = '') => `<div class="stat-card"><div class="stat-icon"><i class="fas ${icon}"></i></div><div class="stat-info"><span class="stat-title">${title}</span><span class="stat-value">${value}</span>${sub ? `<span class="stat-change">${sub}</span>` : ''}</div></div>`;
  const max = Math.max(1, ...d.series.flatMap(s => [s.sales, s.purchases]));
  const bars = d.series.map(s => `<div class="col"><div class="pair"><div class="bar s" style="height:${(s.sales / max) * 100}%" title="مبيعات ${F.moneyText(s.sales)}"></div><div class="bar p" style="height:${(s.purchases / max) * 100}%" title="مشتريات ${F.moneyText(s.purchases)}"></div></div><span class="lbl">${s.month}</span></div>`).join('');
  root.innerHTML = `
    <div class="stats-overview">
      ${card('fa-chart-line', 'مبيعات الشهر (قبل الضريبة)', F.money(d.salesMonth), `${d.salesMonthCount} فاتورة`)}
      ${card('fa-shopping-bag', 'مشتريات الشهر المستلمة', F.money(d.purchasesMonth))}
      ${card('fa-coins', 'مجمل ربح الشهر', F.money(d.grossProfitMonth), 'قبل المصروفات')}
      ${card('fa-wallet', 'صافي الربح قبل الضريبة (الشهر)', F.money(d.netProfitMonth))}
      ${card('fa-car', 'سيارات متوفرة في المخزون', F.num(d.carsInStock))}
      ${card('fa-warehouse', 'قيمة المخزون (بالتكلفة)', F.money(d.stockValue))}
      ${card('fa-hand-holding-usd', 'مستحقات على العملاء', F.money(d.receivables), d.overdueCount ? `${d.overdueCount} فاتورة متأخرة (${F.moneyText(d.overdueAmount)})` : 'لا تأخير')}
      ${card('fa-file-invoice-dollar', 'مستحقات للموردين', F.money(d.payables))}
      ${card('fa-university', 'النقد والبنك', F.money(d.cashBank))}
      ${card('fa-percent', 'ضريبة القيمة المضافة المستحقة (الشهر)', F.money(d.netVatMonth), 'مخرجات − مدخلات')}
    </div>
    <div class="grid-2">
      <div class="card"><h3>المبيعات مقابل المشتريات (آخر 6 أشهر)</h3><div class="bars">${bars}</div>
        <div class="legend"><span><i style="background:#3498db"></i>مبيعات</span><span><i style="background:#e67e22"></i>مشتريات</span></div></div>
      <div class="card"><h3>أعلى العملاء</h3>${UI.table([{ label: 'العميل', render: r => F.esc(r.name) }, { label: 'الإجمالي', cls: 'amount', render: r => F.money(r.total) }], d.topCustomers, { empty: 'لا توجد مبيعات بعد' })}</div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>آخر الفواتير</h3>${UI.table([
        { label: 'الرقم', render: r => `<a href="sales.html?open=${r.id}">${F.esc(r.number)}</a>` }, { label: 'العميل', render: r => F.esc(r.customer_name) },
        { label: 'الإجمالي', cls: 'amount', render: r => F.money(r.total) }, { label: 'الحالة', render: r => F.badge(F.labels.saleStatus, r.status) }], d.recentSales)}</div>
      <div class="card"><h3>تنبيهات نقص المخزون</h3>${UI.table([
        { label: 'المنتج', render: r => F.esc(r.name) }, { label: 'المتوفر', render: r => `<span class="badge red">${F.num(r.qty)}</span>` }, { label: 'الحد الأدنى', render: r => F.num(r.min_qty) }], d.lowStock, { empty: 'لا يوجد نقص في المخزون ✔' })}</div>
    </div>`;
});
