// المشتريات: أمر شراء ← استلام (يزيد المخزون ويُسجل ذمة المورد وضريبة المدخلات) ← سند صرف
App.init({ key: 'purchases', title: 'أوامر الشراء', roles: ['purchasing', 'accountant', 'warehouse'] }, async (root, { meta, can }) => {
  const canBuy = can(['purchasing']), vatRate = meta.settings.vat_rate;
  root.innerHTML = `<div class="toolbar">${canBuy ? '<button class="btn btn-primary btn-lg" id="add"><i class="fas fa-plus-circle"></i> أمر شراء جديد</button>' : ''}
    <div class="search-box"><i class="fas fa-search"></i><input id="q" placeholder="بحث برقم الأمر أو المورد أو رقم فاتورة المورد..."></div>
    <select id="status" class="form-control" style="width:auto"><option value="">كل الحالات</option><option value="ordered">مطلوب (لم يُستلم)</option><option value="received">مستلم</option><option value="cancelled">ملغي</option></select></div><div class="table-container" id="list"></div>`;
  const $ = s => root.querySelector(s);

  async function load() {
    const rows = await API.get('/api/purchases', { q: $('#q').value, status: $('#status').value });
    $('#list').innerHTML = `<div class="table-header"><h2>أوامر الشراء (${rows.length})</h2></div>` + UI.table([
      { label: 'الرقم', render: r => `<b>${F.esc(r.number)}</b>${r.supplier_invoice_no ? `<br><small>فاتورة المورد: ${F.esc(r.supplier_invoice_no)}</small>` : ''}` }, { label: 'التاريخ', render: r => F.date(r.date) },
      { label: 'المورد', render: r => F.esc(r.supplier_name) }, { label: 'البنود', render: r => `<small>${F.esc((r.items || '').slice(0, 60))}</small>` }, { label: 'المخزن', render: r => F.esc(r.warehouse_name) },
      { label: 'الإجمالي', cls: 'amount', render: r => F.money(r.total) }, { label: 'المتبقي', cls: 'amount', render: r => r.status === 'received' ? F.money(r.remaining) : '—' },
      { label: 'الحالة', render: r => F.badge(F.labels.poStatus, r.status) }, { label: '', render: r => `<button class="btn btn-outline" data-act="view" data-id="${r.id}">عرض</button>` },
    ], rows, { empty: 'لا توجد أوامر شراء', rowClass: r => r.status === 'cancelled' ? 'cancelled' : '' });
  }

  async function view(id) {
    const p = await API.get(`/api/purchases/${id}`);
    const m = UI.modal({ title: `أمر شراء ${p.number}`, size: 'wide', html: `
      <div class="kv"><div><span>المورد</span><b>${F.esc(p.supplier_name)}</b></div><div><span>المخزن</span><b>${F.esc(p.warehouse_name)}</b></div><div><span>التاريخ</span><b>${F.date(p.date)}</b></div>
        <div><span>الحالة</span><b>${F.badge(F.labels.poStatus, p.status)}</b></div><div><span>فاتورة المورد</span><b>${F.esc(p.supplier_invoice_no || '—')}</b></div><div><span>نسبة الضريبة</span><b>${p.vat_rate * 100}%</b></div></div>
      ${UI.table([{ label: 'البند', render: l => `${F.esc(l.description)}${l.new_product?.vin ? `<br><small class="num">VIN ${F.esc(l.new_product.vin)}</small>` : ''}` }, { label: 'الكمية', render: l => F.num(l.qty) }, { label: 'سعر الوحدة', cls: 'amount', render: l => F.money(l.unit_cost) },
        { label: 'قبل الضريبة', cls: 'amount', render: l => F.money(l.line_subtotal) }, { label: 'الضريبة', cls: 'amount', render: l => F.money(l.line_vat) }], p.lines)}
      <div class="totals-box"><div><span>المجموع</span>${F.money(p.subtotal)}</div><div><span>ضريبة المدخلات</span>${F.money(p.vat)}</div><div class="grand"><span>الإجمالي</span>${F.money(p.total)}</div><div><span>المدفوع</span>${F.money(p.paid)}</div><div><span>المتبقي للمورد</span><b>${F.money(p.remaining)}</b></div></div>
      ${p.payments.length ? `<h4 style="margin-top:1rem">الدفعات</h4>${UI.table([{ label: 'السند', render: x => F.esc(x.number) }, { label: 'التاريخ', render: x => F.date(x.date) }, { label: 'الطريقة', render: x => F.labels.payMethod[x.method] }, { label: 'المبلغ', cls: 'amount', render: x => F.money(x.amount) }], p.payments)}` : ''}`,
      footer: `${p.status === 'ordered' ? '<button class="btn btn-success" data-recv>استلام البضاعة</button>' : ''}
        ${p.status === 'received' && p.remaining > 0 && can(['purchasing', 'accountant']) ? '<button class="btn btn-primary" data-pay>سداد للمورد</button>' : ''}
        ${p.status !== 'cancelled' ? '<button class="btn btn-danger" data-cancel>إلغاء الأمر</button>' : ''}` });
    m.q('[data-recv]')?.addEventListener('click', () => { m.close(); UI.formModal({ title: `استلام ${p.number}`, data: { date: F.today(), supplier_invoice_no: p.supplier_invoice_no || '' },
      fields: [{ name: 'date', label: 'تاريخ الاستلام', type: 'date', required: true }, { name: 'supplier_invoice_no', label: 'رقم فاتورة المورد الضريبية' }],
      extraHtml: '<p class="hint">عند الاستلام تدخل الكميات للمخزن، وتُسجَّل ذمة المورد وضريبة المدخلات القابلة للاسترداد.</p>',
      onSubmit: async d => { await API.post(`/api/purchases/${id}/receive`, d); UI.toast('تم الاستلام وتحديث المخزون والحسابات', 'success'); load(); } }); });
    m.q('[data-pay]')?.addEventListener('click', () => { m.close(); UI.formModal({ title: `سداد ${p.number}`, data: { amount: p.remaining, date: F.today(), method: 'bank_transfer' },
      fields: [{ name: 'amount', label: `المبلغ (المتبقي ${F.moneyText(p.remaining)})`, type: 'number', attrs: 'step="0.01" min="0.01"', required: true }, { name: 'date', label: 'التاريخ', type: 'date' },
        { name: 'method', label: 'الطريقة', type: 'select', options: Object.entries(F.labels.payMethod).filter(o => o[0] !== 'financing') }, { name: 'reference', label: 'مرجع' }],
      onSubmit: async d => { await API.post('/api/payments', { type: 'disbursement', purchase_id: id, ...d, amount: +d.amount }); UI.toast('تم السداد', 'success'); load(); } }); });
    m.q('[data-cancel]')?.addEventListener('click', async () => { if (await UI.confirmBox(`إلغاء الأمر ${p.number}؟${p.status === 'received' ? ' ستُخصم الكميات من المخزون وتُعكس القيود.' : ''}`, { danger: true, okText: 'إلغاء الأمر' }))
      UI.guard(async () => { await API.post(`/api/purchases/${id}/cancel`); m.close(); UI.toast('تم الإلغاء', 'success'); load(); }); });
  }

  async function newPO(preset) {
    const [suppliers, whs, parts] = await Promise.all([API.get('/api/suppliers'), API.get('/api/warehouses'), API.get('/api/products')]);
    if (!suppliers.length) return UI.toast('أضف مورداً أولاً', 'error');
    const stock = parts.filter(p => p.type !== 'car');
    const yr = new Date().getFullYear();
    const m = UI.modal({ title: 'أمر شراء جديد', size: 'xl', html: `<form novalidate><div class="form-grid">
      ${UI.field({ name: 'supplier_id', label: 'المورد', type: 'select', required: true, options: suppliers.map(s => [s.id, s.name]) })}
      ${UI.field({ name: 'warehouse_id', label: 'المخزن المستلِم', type: 'select', required: true, options: whs.map(w => [w.id, w.name]) })}
      ${UI.field({ name: 'date', label: 'التاريخ', type: 'date', required: true }, F.today())}
      ${UI.field({ name: 'due_date', label: 'تاريخ استحقاق الدفع', type: 'date' }, F.today())}
      ${UI.field({ name: 'supplier_invoice_no', label: 'رقم فاتورة المورد' })}
      ${UI.field({ name: 'import_zero_rated', type: 'checkbox', label: 'بدون ضريبة (0%)', hint: 'مثال: استيراد خاضع لآلية الاحتساب العكسي أو مورد غير مسجل' })}</div>
      <h4 style="margin:1rem 0 .3rem">البنود</h4><div id="lines"></div>
      <div class="toolbar" style="margin-top:.5rem"><button type="button" class="btn btn-outline btn-sm" data-add="car"><i class="fas fa-car"></i> سيارة جديدة (برقم شاسيه)</button>
        <button type="button" class="btn btn-outline btn-sm" data-add="newpart"><i class="fas fa-box"></i> إكسسوار/قطعة جديدة</button><button type="button" class="btn btn-outline btn-sm" data-add="stock"><i class="fas fa-plus"></i> إضافة كمية لمنتج موجود</button></div>
      <div class="totals-box"><div><span>المجموع</span><span id="tSub" class="num"></span></div><div><span>ضريبة المدخلات <span id="tRate"></span></span><span id="tVat" class="num"></span></div><div class="grand"><span>الإجمالي</span><span id="tTot" class="num"></span></div></div>
      ${UI.field({ name: 'notes', label: 'ملاحظات', type: 'textarea' })}<div class="form-error" role="alert"></div></form>`,
      footer: '<button class="btn btn-primary" data-save>حفظ أمر الشراء</button><button class="btn btn-outline" data-cancel>إلغاء</button>' });
    const L = m.q('#lines');
    const input = (cls, label, attrs = '', val = '') => `<div class="form-group"><label>${label}</label><input class="form-control ${cls}" ${attrs} value="${val}"></div>`;
    function addLine(kind) {
      const d = document.createElement('div'); d.className = 'card'; d.style.margin = '.5rem 0'; d.dataset.kind = kind;
      const head = { car: 'سيارة جديدة', newpart: 'إكسسوار / قطعة جديدة', stock: 'إضافة كمية لمنتج موجود' }[kind];
      let body = '';
      if (kind === 'car') body = input('make', 'الشركة المصنعة', '', '') + input('model', 'الطراز') + input('year', 'سنة الصنع', 'type="number"', yr) + input('color', 'اللون') +
        input('vin', 'رقم الشاسيه VIN (17 خانة)', 'maxlength="17" style="text-transform:uppercase;direction:ltr"') +
        `<div class="form-group"><label>الحالة</label><select class="form-control condition"><option value="new">جديدة</option><option value="used">مستعملة</option></select></div>` + input('mileage', 'المسافة (كم)', 'type="number" min="0"', 0) +
        input('specs', 'المواصفات', '', 'مواصفات خليجية (GCC)') + input('price', 'سعر البيع المتوقع (د.إ)', 'type="number" min="0" step="0.01"') + input('cost', 'سعر الشراء (د.إ)', 'type="number" min="0" step="0.01"');
      else if (kind === 'newpart') body = `<div class="form-group"><label>النوع</label><select class="form-control ptype"><option value="accessory">إكسسوار</option><option value="part">قطعة غيار</option></select></div>` + input('pname', 'الاسم') + input('category', 'التصنيف') +
        input('price', 'سعر البيع (د.إ)', 'type="number" min="0" step="0.01"') + input('minq', 'حد إعادة الطلب', 'type="number" min="0"', 0) + input('qty', 'الكمية', 'type="number" min="1"', 1) + input('cost', 'سعر الوحدة (د.إ)', 'type="number" min="0" step="0.01"');
      else body = `<div class="form-group"><label>المنتج</label><select class="form-control pid">${stock.map(p => `<option value="${p.id}">${F.esc(p.name)} (متوفر ${F.num(p.qty)})</option>`).join('')}</select></div>` + input('qty', 'الكمية', 'type="number" min="1"', 1) + input('cost', 'سعر الوحدة (د.إ)', 'type="number" min="0" step="0.01"');
      d.innerHTML = `<div style="display:flex;justify-content:space-between"><b>${head}</b><button type="button" class="btn btn-danger btn-sm rm">&times;</button></div><div class="form-grid">${body}</div>`;
      L.appendChild(d); recalc();
    }
    const recalc = () => { const rate = m.q('[name=import_zero_rated]').checked ? 0 : vatRate; let sub = 0;
      L.querySelectorAll('.card').forEach(c => { const q = c.dataset.kind === 'car' ? 1 : +c.querySelector('.qty').value || 0; sub += q * (+c.querySelector('.cost').value || 0); });
      const vat = Math.round(sub * rate * 100) / 100; m.q('#tSub').textContent = F.moneyText(sub); m.q('#tVat').textContent = F.moneyText(vat); m.q('#tTot').textContent = F.moneyText(sub + vat); m.q('#tRate').textContent = `(${rate * 100}%)`; };
    UI.on(m.el, 'click', '[data-add]', el => addLine(el.dataset.add)); UI.on(L, 'click', '.rm', el => { el.closest('.card').remove(); recalc(); }); UI.on(L, 'input', 'input', recalc);
    m.q('[name=import_zero_rated]').addEventListener('change', recalc); m.q('[data-cancel]').addEventListener('click', m.close);
    addLine(preset === 'car' ? 'car' : 'stock'); if (!stock.length && preset !== 'car') { L.innerHTML = ''; addLine('newpart'); }
    m.q('[data-save]').addEventListener('click', async () => {
      const err = m.q('.form-error'); err.textContent = ''; const d = UI.values(m.q('form'));
      const g = (c, s) => c.querySelector(s)?.value.trim();
      const lines = [...L.querySelectorAll('.card')].map(c => {
        if (c.dataset.kind === 'car') { const vin = g(c, '.vin').toUpperCase(); if (!F.validVIN(vin)) throw new Error('رقم الشاسيه VIN يجب أن يكون 17 خانة (أحرف وأرقام بدون I و O و Q)');
          return { qty: 1, unit_cost: +g(c, '.cost'), new_product: { type: 'car', make: g(c, '.make'), model: g(c, '.model'), name: `${g(c, '.make')} ${g(c, '.model')} ${g(c, '.year')}`.trim(), year: +g(c, '.year'), color: g(c, '.color'), vin, condition: g(c, '.condition'), mileage: +g(c, '.mileage') || null, specs: g(c, '.specs'), price: +g(c, '.price') } }; }
        if (c.dataset.kind === 'newpart') return { qty: +g(c, '.qty'), unit_cost: +g(c, '.cost'), new_product: { type: g(c, '.ptype'), name: g(c, '.pname'), category: g(c, '.category'), price: +g(c, '.price'), min_qty: +g(c, '.minq') } };
        return { product_id: +g(c, '.pid'), qty: +g(c, '.qty'), unit_cost: +g(c, '.cost') };
      });
      m.q('[data-save]').disabled = true;
      try { const p = await API.post('/api/purchases', { ...d, supplier_id: +d.supplier_id, warehouse_id: +d.warehouse_id, lines }); m.close(); UI.toast(`تم إنشاء ${p.number}`, 'success'); load(); view(p.id); }
      catch (e) { err.textContent = e.message; m.q('[data-save]').disabled = false; }
    });
  }

  UI.on(root, 'click', '[data-act=view]', el => UI.guard(() => view(+el.dataset.id)));
  $('#add')?.addEventListener('click', () => UI.guard(() => newPO()));
  $('#q').addEventListener('input', UI.debounce(load)); $('#status').addEventListener('change', load);
  await load();
  if (new URLSearchParams(location.search).get('new') && canBuy) UI.guard(() => newPO(new URLSearchParams(location.search).get('new')));
});
