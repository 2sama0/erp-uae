// الدفعات: سندات القبض من العملاء، سندات الصرف للموردين، والمصروفات التشغيلية
App.init({ key: 'payments', title: 'الدفعات والمصروفات', roles: ['accountant', 'sales', 'purchasing'] }, async (root, { can, user }) => {
  let type = '';
  const isAcc = can(['accountant']);
  const tabs = [['', 'الكل'], ['receipt', 'سندات القبض'], ['disbursement', 'سندات الصرف'], ['expense', 'المصروفات']];
  const methods = Object.entries(F.labels.payMethod).filter(o => o[0] !== 'financing');
  root.innerHTML = `<div class="toolbar">
      ${can(['sales']) ? '<button class="btn btn-success" id="rcv"><i class="fas fa-arrow-down"></i> سند قبض</button>' : ''}
      ${can(['purchasing', 'accountant']) ? '<button class="btn btn-primary" id="pay"><i class="fas fa-arrow-up"></i> سند صرف لمورد</button>' : ''}
      ${isAcc ? '<button class="btn btn-outline" id="exp"><i class="fas fa-receipt"></i> مصروف جديد</button>' : ''}
      <input type="date" id="from" class="form-control" style="width:auto"><input type="date" id="to" class="form-control" style="width:auto"></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === type ? 'active' : ''}">${l}</button>`).join('')}</div><div class="table-container" id="list"></div>`;
  const $ = s => root.querySelector(s);
  async function load() {
    const rows = await API.get('/api/payments', { type, from: $('#from').value, to: $('#to').value }); const live = rows.filter(r => r.status === 'posted');
    const sum = t => live.filter(r => r.type === t).reduce((s, r) => s + r.amount, 0);
    $('#list').innerHTML = `<div class="table-header"><h2>السندات (${rows.length})</h2><span>قبض: ${F.money(sum('receipt'))} · صرف: ${F.money(sum('disbursement'))} · مصروفات: ${F.money(sum('expense'))}</span></div>` + UI.table([
      { label: 'السند', render: r => `<b>${F.esc(r.number)}</b>` }, { label: 'التاريخ', render: r => F.date(r.date) }, { label: 'النوع', render: r => F.labels.payType[r.type] },
      { label: 'الطرف', render: r => F.esc(r.payee || '—') }, { label: 'المرجع', render: r => F.esc(r.sale_number || r.purchase_number || r.expense_account_name || '') + (r.reference ? `<br><small>${F.esc(r.reference)}</small>` : '') },
      { label: 'الطريقة', render: r => F.labels.payMethod[r.method] }, { label: 'المبلغ', cls: 'amount', render: r => F.money(r.amount) },
      { label: 'الحالة', render: r => r.status === 'posted' ? '<span class="badge green">مرحّل</span>' : '<span class="badge gray">ملغي</span>' },
      { label: '', render: r => isAcc && r.status === 'posted' ? `<button class="btn btn-danger" data-cancel="${r.id}">إلغاء</button>` : '' }], rows, { empty: 'لا توجد سندات', rowClass: r => r.status === 'cancelled' ? 'cancelled' : '' });
  }
  UI.on(root, 'click', '[data-t]', el => { type = el.dataset.t; root.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('active', b === el)); load(); });
  UI.on(root, 'click', '[data-cancel]', async el => { if (await UI.confirmBox('إلغاء هذا السند؟ سيُعكس قيده المحاسبي ويُعاد فتح المبلغ على الفاتورة.', { danger: true, okText: 'إلغاء السند' })) UI.guard(async () => { await API.post(`/api/payments/${el.dataset.cancel}/cancel`); UI.toast('تم الإلغاء', 'success'); load(); }); });
  ['#from', '#to'].forEach(s => $(s).addEventListener('change', load));

  $('#rcv')?.addEventListener('click', () => UI.guard(async () => {
    const sales = (await API.get('/api/sales')).filter(s => s.status === 'unpaid' || s.status === 'partial'); if (!sales.length) return UI.toast('لا توجد فواتير مفتوحة', 'error');
    UI.formModal({ title: 'سند قبض', data: { date: F.today(), method: 'bank_transfer', sale_id: sales[0].id, amount: sales[0].remaining },
      fields: [{ name: 'sale_id', label: 'الفاتورة', type: 'select', options: sales.map(s => [s.id, `${s.number} — ${s.customer_name} (متبقي ${F.moneyText(s.remaining)})`]), full: true }, { name: 'amount', label: 'المبلغ (د.إ)', type: 'number', attrs: 'step="0.01" min="0.01"', required: true },
        { name: 'date', label: 'التاريخ', type: 'date' }, { name: 'method', label: 'الطريقة', type: 'select', options: methods }, { name: 'reference', label: 'مرجع' }],
      onOpen: m => m.q('[name=sale_id]').addEventListener('change', e => { m.q('[name=amount]').value = sales.find(s => s.id === +e.target.value).remaining; }),
      onSubmit: async d => { await API.post('/api/payments', { type: 'receipt', ...d, sale_id: +d.sale_id, amount: +d.amount }); UI.toast('تم تسجيل سند القبض', 'success'); load(); } });
  }));
  $('#pay')?.addEventListener('click', () => UI.guard(async () => {
    const pos = await API.get('/api/purchases', { unpaid: 1 }); if (!pos.length) return UI.toast('لا توجد مستحقات للموردين', 'error');
    UI.formModal({ title: 'سند صرف لمورد', data: { date: F.today(), method: 'bank_transfer', purchase_id: pos[0].id, amount: pos[0].remaining },
      fields: [{ name: 'purchase_id', label: 'أمر الشراء', type: 'select', options: pos.map(p => [p.id, `${p.number} — ${p.supplier_name} (متبقي ${F.moneyText(p.remaining)})`]), full: true }, { name: 'amount', label: 'المبلغ (د.إ)', type: 'number', attrs: 'step="0.01" min="0.01"', required: true },
        { name: 'date', label: 'التاريخ', type: 'date' }, { name: 'method', label: 'الطريقة', type: 'select', options: methods }, { name: 'reference', label: 'مرجع' }],
      onOpen: m => m.q('[name=purchase_id]').addEventListener('change', e => { m.q('[name=amount]').value = pos.find(p => p.id === +e.target.value).remaining; }),
      onSubmit: async d => { await API.post('/api/payments', { type: 'disbursement', ...d, purchase_id: +d.purchase_id, amount: +d.amount }); UI.toast('تم تسجيل سند الصرف', 'success'); load(); } });
  }));
  $('#exp')?.addEventListener('click', () => UI.guard(async () => {
    const accs = await API.get('/api/accounts/expense');
    UI.formModal({ title: 'مصروف جديد', data: { date: F.today(), method: 'bank_transfer', vat_amount: 0 }, size: 'wide',
      fields: [{ name: 'expense_account_id', label: 'نوع المصروف', type: 'select', options: accs.map(a => [a.id, `${a.code} — ${a.name}`]), full: true }, { name: 'payee', label: 'المستفيد', required: true }, { name: 'description', label: 'البيان' },
        { name: 'amount', label: 'المبلغ الإجمالي شاملاً الضريبة (د.إ)', type: 'number', attrs: 'step="0.01" min="0.01"', required: true }, { name: 'vat_amount', label: 'منها ضريبة القيمة المضافة (د.إ)', type: 'number', attrs: 'step="0.01" min="0"', hint: 'تظهر في الفاتورة الضريبية للمورد (5%)' },
        { name: 'date', label: 'التاريخ', type: 'date' }, { name: 'method', label: 'الطريقة', type: 'select', options: methods }, { name: 'reference', label: 'مرجع' }],
      onSubmit: async d => { await API.post('/api/payments', { type: 'expense', ...d, expense_account_id: +d.expense_account_id, amount: +d.amount, vat_amount: +d.vat_amount || 0 }); UI.toast('تم تسجيل المصروف', 'success'); load(); } });
  }));
  load();
});
