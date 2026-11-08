// إدارة الموردين
App.init({ key: 'suppliers', title: 'الموردون', roles: ['purchasing', 'accountant'] }, async (root, { meta, can }) => {
  const canEdit = can(['purchasing']);
  root.innerHTML = `<div class="toolbar">${canEdit ? '<button class="btn btn-primary" id="add"><i class="fas fa-plus"></i> مورد جديد</button>' : ''}
    <div class="search-box"><i class="fas fa-search"></i><input id="q" placeholder="بحث بالاسم أو الهاتف أو الكود..."></div></div><div class="table-container" id="list"></div>`;
  const fields = [
    { name: 'name', label: 'اسم المورد', required: true },
    { name: 'phone', label: 'الهاتف', ltr: true, hint: 'مثال: 04 300 1122 أو 050 123 4567' },
    { name: 'email', label: 'البريد الإلكتروني', type: 'email', ltr: true },
    { name: 'trn', label: 'الرقم الضريبي TRN', ltr: true, hint: '15 رقماً — مطلوب لاسترداد ضريبة المدخلات' },
    { name: 'emirate', label: 'الإمارة', type: 'select', options: [['', '— اختر —'], ...meta.emirates.map(e => [e, e])] },
    { name: 'address', label: 'العنوان' }, { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
  ];
  const openForm = (s = null) => UI.formModal({ title: s ? 'تعديل مورد' : 'مورد جديد', fields, data: s || {}, size: 'wide',
    onSubmit: async d => { if (!d.name) throw new Error('الاسم مطلوب'); if (d.trn && !F.validTRN(d.trn)) throw new Error('الرقم الضريبي يجب أن يكون 15 رقماً');
      s ? await API.put(`/api/suppliers/${s.id}`, d) : await API.post('/api/suppliers', d); UI.toast('تم الحفظ', 'success'); load(); } });
  async function load() {
    const rows = await API.get('/api/suppliers', { q: root.querySelector('#q').value }); root._rows = rows;
    root.querySelector('#list').innerHTML = `<div class="table-header"><h2>الموردون (${rows.length})</h2></div>` + UI.table([
      { label: 'الكود', render: r => F.esc(r.code) }, { label: 'الاسم', render: r => `<b>${F.esc(r.name)}</b>${r.emirate ? `<br><small>${F.esc(r.emirate)}</small>` : ''}` },
      { label: 'الهاتف', render: r => F.phone(r.phone) }, { label: 'TRN', render: r => `<span class="num">${F.esc(r.trn || '—')}</span>` },
      { label: 'إجمالي المشتريات', cls: 'amount', render: r => F.money(r.total_purchases) }, { label: 'المستحق للمورد', cls: 'amount', render: r => r.balance > 0 ? `<b style="color:#c0392b">${F.money(r.balance)}</b>` : F.money(0) },
      { label: '', render: r => canEdit ? `<div class="row-actions"><button class="btn btn-outline" data-act="edit" data-id="${r.id}">تعديل</button><button class="btn btn-danger" data-act="del" data-id="${r.id}">حذف</button></div>` : '' },
    ], rows, { empty: 'لا يوجد موردون' });
  }
  UI.on(root, 'click', '[data-act]', async el => {
    const id = Number(el.dataset.id), s = root._rows.find(r => r.id === id);
    if (el.dataset.act === 'edit') openForm(s);
    if (el.dataset.act === 'del' && await UI.confirmBox(`حذف المورد «${s.name}»؟`, { danger: true, okText: 'حذف' }))
      UI.guard(async () => { const r = await API.del(`/api/suppliers/${id}`); UI.toast(r.deactivated ? 'تم تعطيل المورد (لديه أوامر شراء)' : 'تم الحذف', 'success'); load(); });
  });
  root.querySelector('#add')?.addEventListener('click', () => openForm());
  root.querySelector('#q').addEventListener('input', UI.debounce(load));
  load();
});
