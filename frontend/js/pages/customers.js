// إدارة العملاء (أفراد: هوية إماراتية — شركات: رخصة تجارية + TRN)
App.init({ key: 'customers', title: 'العملاء', roles: ['sales', 'accountant'] }, async (root, { meta, can }) => {
  const emirates = meta.emirates.map(e => [e, e]);
  const canEdit = can(['sales']);
  root.innerHTML = `
    <div class="toolbar">
      ${canEdit ? '<button class="btn btn-primary" id="add"><i class="fas fa-plus"></i> عميل جديد</button>' : ''}
      <div class="search-box"><i class="fas fa-search"></i><input id="q" placeholder="بحث بالاسم أو الهاتف أو الهوية أو الكود..."></div>
      <select id="type" class="form-control" style="width:auto"><option value="">كل الأنواع</option><option value="individual">أفراد</option><option value="company">شركات</option></select>
    </div><div class="table-container" id="list"></div>`;

  const fields = [
    { name: 'type', label: 'نوع العميل', type: 'select', options: [['individual', 'فرد'], ['company', 'شركة']] },
    { name: 'name', label: 'الاسم / اسم الشركة', required: true },
    { name: 'phone', label: 'رقم الهاتف', ltr: true, hint: 'مثال: 050 123 4567 أو +971 4 123 4567' },
    { name: 'email', label: 'البريد الإلكتروني', type: 'email', ltr: true },
    { name: 'emirates_id', label: 'رقم الهوية الإماراتية', ltr: true, hint: '784-YYYY-NNNNNNN-C (للأفراد)' },
    { name: 'trade_license', label: 'رقم الرخصة التجارية', hint: 'للشركات' },
    { name: 'trn', label: 'الرقم الضريبي TRN', ltr: true, hint: '15 رقماً (للشركات المسجلة في ضريبة القيمة المضافة)' },
    { name: 'emirate', label: 'الإمارة', type: 'select', options: [['', '— اختر —'], ...emirates] },
    { name: 'credit_limit', label: 'الحد الائتماني (د.إ)', type: 'number', attrs: 'min="0" step="0.01"', hint: '0 = بدون حد' },
    { name: 'address', label: 'العنوان', full: true },
    { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
  ];

  function validate(d) {
    if (!d.name) throw UI.fieldError('الاسم مطلوب', 'name');
    if (d.trn && !F.validTRN(d.trn)) throw UI.fieldError('الرقم الضريبي يجب أن يكون 15 رقماً', 'trn');
    if (d.type === 'individual' && d.emirates_id && !F.validEmiratesId(d.emirates_id))
       throw UI.fieldError('رقم الهوية الإماراتية غير صالح', 'emirates_id');
  }
  function toggle(m) {
    const sync = () => { const co = m.q('[name=type]').value === 'company';
      m.q('[name=emirates_id]').closest('.form-group').classList.toggle('hidden', co);
      m.q('[name=trade_license]').closest('.form-group').classList.toggle('hidden', !co); };
    m.q('[name=type]').addEventListener('change', sync); sync();
  }
  const openForm = (c = null) => UI.formModal({
    title: c ? 'تعديل عميل' : 'عميل جديد', fields, data: c || { type: 'individual', credit_limit: 0 }, size: 'wide', onOpen: toggle,
    onSubmit: async d => { validate(d); c ? await API.put(`/api/customers/${c.id}`, d) : await API.post('/api/customers', d); UI.toast('تم الحفظ', 'success'); load(); },
  });

  async function load() {
    const rows = await API.get('/api/customers', { q: root.querySelector('#q').value, type: root.querySelector('#type').value });
    root.querySelector('#list').innerHTML = `<div class="table-header"><h2>قائمة العملاء (${rows.length})</h2></div>` + UI.table([
      { label: 'الكود', render: r => F.esc(r.code) },
      { label: 'الاسم', render: r => `<b>${F.esc(r.name)}</b><br><small>${F.labels.custType[r.type]}${r.emirate ? ' · ' + F.esc(r.emirate) : ''}</small>` },
      { label: 'الهاتف', render: r => F.phone(r.phone) },
      { label: 'الهوية / الرخصة / TRN', render: r => `<span class="num ltr">${F.esc(r.emirates_id || r.trade_license || '')}</span>${r.trn ? `<br><small class="num">TRN ${F.esc(r.trn)}</small>` : ''}` },
      { label: 'إجمالي المشتريات', cls: 'amount', render: r => F.money(r.total_purchases) },
      { label: 'الرصيد المستحق', cls: 'amount', render: r => r.balance > 0 ? `<b style="color:#c0392b">${F.money(r.balance)}</b>` : F.money(0) },
      { label: '', render: r => `<div class="row-actions"><button class="btn btn-outline" data-act="view" data-id="${r.id}">عرض</button>${canEdit ? `<button class="btn btn-outline" data-act="edit" data-id="${r.id}">تعديل</button><button class="btn btn-danger" data-act="del" data-id="${r.id}">حذف</button>` : ''}</div>` },
    ], rows, { empty: 'لا يوجد عملاء' });
    root._rows = rows;
  }
  UI.on(root, 'click', '[data-act]', async el => {
    const id = Number(el.dataset.id), c = root._rows.find(r => r.id === id);
    if (el.dataset.act === 'edit') openForm(c);
    if (el.dataset.act === 'del' && await UI.confirmBox(`حذف العميل «${c.name}»؟ (إن كانت له فواتير سيُعطَّل بدل الحذف)`, { danger: true, okText: 'حذف' }))
      UI.guard(async () => { const r = await API.del(`/api/customers/${id}`); UI.toast(r.deactivated ? 'تم تعطيل العميل (لديه فواتير سابقة)' : 'تم الحذف', 'success'); load(); });
    if (el.dataset.act === 'view') UI.guard(async () => {
      const d = await API.get(`/api/customers/${id}`);
      UI.modal({ title: d.name, size: 'wide', html: `<div class="kv">
        <div><span>الكود</span><b>${F.esc(d.code)}</b></div><div><span>النوع</span><b>${F.labels.custType[d.type]}</b></div><div><span>الهاتف</span><b>${F.phone(d.phone)}</b></div>
        <div><span>البريد</span><b>${F.esc(d.email || '—')}</b></div><div><span>الهوية / الرخصة</span><b class="num">${F.esc(d.emirates_id || d.trade_license || '—')}</b></div><div><span>TRN</span><b class="num">${F.esc(d.trn || '—')}</b></div>
        <div><span>الإمارة</span><b>${F.esc(d.emirate || '—')}</b></div><div><span>الحد الائتماني</span><b>${F.money(d.credit_limit)}</b></div><div><span>الرصيد المستحق</span><b>${F.money(d.balance)}</b></div></div>
        <h4>فواتير العميل</h4>${UI.table([{ label: 'الرقم', render: s => `<a href="sales.html?open=${s.id}">${F.esc(s.number)}</a>` }, { label: 'التاريخ', render: s => F.date(s.date) },
          { label: 'الإجمالي', cls: 'amount', render: s => F.money(s.total) }, { label: 'المدفوع', cls: 'amount', render: s => F.money(s.paid) }, { label: 'الحالة', render: s => F.badge(F.labels.saleStatus, s.status) }], d.sales, { empty: 'لا توجد فواتير' })}` });
    });
  });
  root.querySelector('#add')?.addEventListener('click', () => openForm());
  root.querySelector('#q').addEventListener('input', UI.debounce(load));
  root.querySelector('#type').addEventListener('change', load);
  load();
});
