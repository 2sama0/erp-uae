// المبيعات: فاتورة ضريبية تخصم المخزون وتُرحّل للحسابات تلقائياً
App.init({ key: 'sales', title: 'المبيعات (الفواتير الضريبية)', roles: ['sales', 'accountant'] }, async (root, { meta, can }) => {
  const canSell = can(['sales']), vatRate = meta.settings.vat_rate;
  const payOpts = Object.entries(F.labels.payMethod);
  root.innerHTML = `<div class="toolbar">${canSell ? '<button class="btn btn-primary btn-lg" id="add"><i class="fas fa-plus-circle"></i> فاتورة بيع جديدة</button>' : ''}
    <div class="search-box"><i class="fas fa-search"></i><input id="q" placeholder="بحث برقم الفاتورة أو اسم العميل..."></div>
    <select id="status" class="form-control" style="width:auto"><option value="">كل الحالات</option><option value="unpaid">غير مدفوعة</option><option value="partial">مدفوعة جزئياً</option><option value="paid">مدفوعة</option><option value="overdue">متأخرة</option><option value="cancelled">ملغاة</option></select>
    <input type="date" id="from" class="form-control" style="width:auto" title="من تاريخ"><input type="date" id="to" class="form-control" style="width:auto" title="إلى تاريخ"></div>
    <div class="stats-overview" id="stats"></div><div class="table-container" id="list"></div>`;
  const $ = s => root.querySelector(s);

  async function load() {
    const rows = await API.get('/api/sales', { q: $('#q').value, status: $('#status').value, from: $('#from').value, to: $('#to').value });
    const live = rows.filter(r => r.status !== 'cancelled');
    const sum = k => live.reduce((s, r) => s + r[k], 0);
    $('#stats').innerHTML = [['fa-file-invoice', 'عدد الفواتير', F.num(live.length)], ['fa-chart-line', 'المبيعات (قبل الضريبة)', F.money(sum('subtotal'))],
      ['fa-percent', 'ضريبة القيمة المضافة', F.money(sum('vat'))], ['fa-hand-holding-usd', 'المتبقي للتحصيل', F.money(sum('remaining'))]]
      .map(([i, t, v]) => `<div class="stat-card"><div class="stat-icon"><i class="fas ${i}"></i></div><div class="stat-info"><span class="stat-title">${t}</span><span class="stat-value">${v}</span></div></div>`).join('');
    $('#list').innerHTML = `<div class="table-header"><h2>الفواتير (${rows.length})</h2></div>` + UI.table([
      { label: 'الرقم', render: r => `<b>${F.esc(r.number)}</b>` }, { label: 'التاريخ', render: r => F.date(r.date) }, { label: 'العميل', render: r => F.esc(r.customer_name) },
      { label: 'البنود', render: r => `<small>${F.esc((r.items || '').slice(0, 45))}</small>` }, { label: 'الإجمالي', cls: 'amount', render: r => F.money(r.total) }, { label: 'المتبقي', cls: 'amount', render: r => F.money(r.status === 'cancelled' ? 0 : r.remaining) },
      { label: 'الحالة', render: r => F.badge(F.labels.saleStatus, r.status) },
      { label: '', render: r => `<div class="row-actions"><button class="btn btn-outline" data-act="view" data-id="${r.id}">عرض</button><a class="btn btn-outline" target="_blank" href="sale-print.html?id=${r.id}">طباعة</a></div>` },
    ], rows, { empty: 'لا توجد فواتير', rowClass: r => r.status === 'cancelled' ? 'cancelled' : '' });
  }

  async function view(id) {
    const s = await API.get(`/api/sales/${id}`);
    const m = UI.modal({ title: `فاتورة ${s.number}`, size: 'wide', html: `
      <div class="kv"><div><span>العميل</span><b>${F.esc(s.customer_name)}</b></div><div><span>التاريخ</span><b>${F.date(s.date)}</b></div><div><span>الاستحقاق</span><b>${F.date(s.due_date)}</b></div>
        <div><span>طريقة الدفع</span><b>${F.labels.payMethod[s.payment_method]}</b></div><div><span>الحالة</span><b>${F.badge(F.labels.saleStatus, s.status)}</b></div><div><span>نسبة الضريبة</span><b>${s.vat_rate * 100}%</b></div></div>
      ${UI.table([{ label: 'البند', render: l => `${F.esc(l.description)}${l.vin ? `<br><small class="num">VIN ${F.esc(l.vin)}</small>` : ''}` }, { label: 'الكمية', render: l => F.num(l.qty) },
        { label: 'السعر', cls: 'amount', render: l => F.money(l.unit_price) }, { label: 'الخصم', cls: 'amount', render: l => F.money(l.discount) },
        { label: 'قبل الضريبة', cls: 'amount', render: l => F.money(l.line_subtotal) }, { label: 'الضريبة', cls: 'amount', render: l => F.money(l.line_vat) }], s.lines)}
      <div class="totals-box"><div><span>المجموع</span>${F.money(s.subtotal)}</div><div><span>الضريبة</span>${F.money(s.vat)}</div><div class="grand"><span>الإجمالي</span>${F.money(s.total)}</div>
        <div><span>المدفوع</span>${F.money(s.paid)}</div><div><span>المتبقي</span><b>${F.money(s.status === 'cancelled' ? 0 : s.remaining)}</b></div></div>
      <h4 style="margin-top:1rem">الدفعات</h4>${UI.table([{ label: 'السند', render: p => F.esc(p.number) }, { label: 'التاريخ', render: p => F.date(p.date) }, { label: 'الطريقة', render: p => F.labels.payMethod[p.method] },
        { label: 'المبلغ', cls: 'amount', render: p => F.money(p.amount) }], s.payments, { empty: 'لا توجد دفعات' })}`,
      footer: `<a class="btn btn-outline" target="_blank" href="sale-print.html?id=${s.id}"><i class="fas fa-print"></i> طباعة الفاتورة</a>
        ${s.status !== 'cancelled' && s.remaining > 0 && can(['sales']) ? '<button class="btn btn-success" data-receipt>تسجيل دفعة</button>' : ''}
        ${s.status !== 'cancelled' ? '<button class="btn btn-danger" data-cancel>إلغاء الفاتورة</button>' : ''}` });
    m.q('[data-receipt]')?.addEventListener('click', () => { m.close(); receipt(s); });
    m.q('[data-cancel]')?.addEventListener('click', async () => {
      if (await UI.confirmBox(`إلغاء الفاتورة ${s.number}؟ ستعود الكميات للمخزون وتُعكس القيود المحاسبية.`, { danger: true, okText: 'إلغاء الفاتورة' }))
        UI.guard(async () => { await API.post(`/api/sales/${s.id}/cancel`); m.close(); UI.toast('تم إلغاء الفاتورة', 'success'); load(); });
    });
  }

  function receipt(s) {
    UI.formModal({ title: `دفعة على ${s.number}`, data: { amount: s.remaining, date: F.today(), method: 'bank_transfer' },
      fields: [{ name: 'amount', label: `المبلغ (المتبقي ${F.moneyText(s.remaining)})`, type: 'number', attrs: 'step="0.01" min="0.01"', required: true },
        { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'method', label: 'طريقة الدفع', type: 'select', options: payOpts.filter(o => o[0] !== 'financing') }, { name: 'reference', label: 'مرجع (رقم الشيك/الحوالة)' }],
      onSubmit: async d => { await API.post('/api/payments', { type: 'receipt', sale_id: s.id, ...d, amount: Number(d.amount) }); UI.toast('تم تسجيل الدفعة', 'success'); load(); } });
  }

  async function newSale() {
    const [customers, products] = await Promise.all([API.get('/api/customers'), API.get('/api/products', { available: 1 })]);
    if (!customers.length) return UI.toast('أضف عميلاً أولاً من صفحة العملاء', 'error');
    const prodOpts = products.map(p => `<option value="${p.id}" data-price="${p.price}" data-type="${p.type}" data-stock="${p.qty}">${F.esc(p.name)}${p.vin ? ' — ' + p.vin.slice(-6) : ''} (${F.num(p.qty)})</option>`).join('');
    const m = UI.modal({ title: 'فاتورة بيع جديدة', size: 'xl', html: `<form novalidate>
      <div class="form-grid">
        ${UI.field({ name: 'customer_id', label: 'العميل', type: 'select', required: true, options: customers.map(c => [c.id, `${c.name} (${c.code})`]) })}
        ${UI.field({ name: 'date', label: 'تاريخ الفاتورة', type: 'date', required: true }, F.today())}
        ${UI.field({ name: 'due_date', label: 'تاريخ الاستحقاق', type: 'date' }, F.today())}
        ${UI.field({ name: 'payment_method', label: 'طريقة الدفع', type: 'select', options: payOpts }, 'bank_transfer')}
        ${UI.field({ name: 'export_zero_rated', type: 'checkbox', label: 'تصدير خارج الدولة (ضريبة 0%)', hint: 'للسيارات المصدّرة خارج الإمارات وفق شروط الهيئة الاتحادية للضرائب', full: true })}
      </div>
      <h4 style="margin:1rem 0 .3rem">بنود الفاتورة</h4>
      <table class="line-editor"><thead><tr><th>المنتج</th><th style="width:90px">الكمية</th><th style="width:140px">السعر (د.إ)</th><th style="width:120px">الخصم</th><th style="width:140px">الصافي</th><th style="width:40px"></th></tr></thead><tbody id="lines"></tbody></table>
      <button type="button" class="btn btn-outline btn-sm" id="addLine"><i class="fas fa-plus"></i> إضافة بند</button>
      <div class="totals-box"><div><span>المجموع قبل الضريبة</span><span id="tSub" class="num"></span></div><div><span>ضريبة القيمة المضافة <span id="tRate"></span></span><span id="tVat" class="num"></span></div><div class="grand"><span>الإجمالي</span><span id="tTot" class="num"></span></div></div>
      <div class="form-grid" style="margin-top:1rem">
        ${UI.field({ name: 'paid_now', label: 'دفعة مقدمة الآن (د.إ)', type: 'number', attrs: 'min="0" step="0.01"' }, 0)}
        ${UI.field({ name: 'paid_method', label: 'طريقة الدفعة المقدمة', type: 'select', options: payOpts.filter(o => o[0] !== 'financing') }, 'bank_transfer')}
        ${UI.field({ name: 'notes', label: 'ملاحظات', type: 'textarea', full: true })}
      </div><div class="form-error" role="alert"></div></form>`,
      footer: '<button class="btn btn-primary" data-save>إصدار الفاتورة</button><button class="btn btn-outline" data-cancel>إلغاء</button>' });
    const tb = m.q('#lines');
    const addLine = () => { const tr = document.createElement('tr');
      tr.innerHTML = `<td><select class="form-control p"><option value="">— اختر منتجاً —</option>${prodOpts}</select></td><td><input class="form-control q" type="number" min="1" step="1" value="1"></td>
        <td><input class="form-control pr" type="number" min="0" step="0.01"></td><td><input class="form-control d" type="number" min="0" step="0.01" value="0"></td><td class="num net">—</td>
        <td><button type="button" class="btn btn-danger btn-sm rm">&times;</button></td>`; tb.appendChild(tr); };
    const recalc = () => {
      const zero = m.q('[name=export_zero_rated]').checked, rate = zero ? 0 : vatRate; let sub = 0;
      tb.querySelectorAll('tr').forEach(tr => { const q = +tr.querySelector('.q').value || 0, pr = +tr.querySelector('.pr').value || 0, d = +tr.querySelector('.d').value || 0;
        const net = Math.max(0, q * pr - d); sub += net; tr.querySelector('.net').textContent = tr.querySelector('.p').value ? F.moneyText(net) : '—'; });
      const vat = Math.round(sub * rate * 100) / 100;
      m.q('#tSub').textContent = F.moneyText(sub); m.q('#tVat').textContent = F.moneyText(vat); m.q('#tTot').textContent = F.moneyText(sub + vat); m.q('#tRate').textContent = `(${rate * 100}%)`;
    };
    UI.on(tb, 'change', '.p', (el) => { const tr = el.closest('tr'), o = el.selectedOptions[0];
      tr.querySelector('.pr').value = o.dataset.price || ''; const q = tr.querySelector('.q'); q.max = o.dataset.stock || ''; if (o.dataset.type === 'car') { q.value = 1; q.readOnly = true; } else q.readOnly = false; recalc(); });
    UI.on(tb, 'input', 'input', recalc); UI.on(tb, 'click', '.rm', el => { el.closest('tr').remove(); recalc(); });
    m.q('#addLine').addEventListener('click', addLine); m.q('[name=export_zero_rated]').addEventListener('change', recalc); addLine(); recalc();
    m.q('[data-cancel]').addEventListener('click', m.close);
    m.q('[data-save]').addEventListener('click', async () => {
      const err = m.q('.form-error'); err.textContent = '';
      const d = UI.values(m.q('form'));
      const lines = [...tb.querySelectorAll('tr')].filter(tr => tr.querySelector('.p').value).map(tr => ({ product_id: +tr.querySelector('.p').value, qty: +tr.querySelector('.q').value, unit_price: +tr.querySelector('.pr').value, discount: +tr.querySelector('.d').value || 0 }));
      if (!lines.length) { err.textContent = 'أضف منتجاً واحداً على الأقل'; return; }
      m.q('[data-save]').disabled = true;
      try { const s = await API.post('/api/sales', { ...d, customer_id: +d.customer_id, paid_now: +d.paid_now || 0, lines }); m.close(); UI.toast(`تم إصدار الفاتورة ${s.number}`, 'success'); load(); view(s.id); }
      catch (e) { err.textContent = e.message; m.q('[data-save]').disabled = false; }
    });
  }

  UI.on(root, 'click', '[data-act=view]', el => UI.guard(() => view(+el.dataset.id)));
  $('#add')?.addEventListener('click', () => UI.guard(newSale));
  $('#q').addEventListener('input', UI.debounce(load)); ['#status', '#from', '#to'].forEach(s => $(s).addEventListener('change', load));
  await load();
  const open = new URLSearchParams(location.search).get('open'); if (open) UI.guard(() => view(+open));
});
