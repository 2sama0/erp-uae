// المحاسبة: دليل الحسابات، قيود اليومية، دفتر الأستاذ، ميزان المراجعة
App.init({ key: 'accounting', title: 'دليل الحسابات والقيود', roles: ['accountant'] }, async (root) => {
  let tab = 'journal';
  const tabs = [['journal', 'قيود اليومية'], ['coa', 'دليل الحسابات'], ['ledger', 'دفتر الأستاذ'], ['tb', 'ميزان المراجعة']];
  root.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div><div id="pane"></div>`;
  const pane = root.querySelector('#pane');
  UI.on(root, 'click', '[data-tab]', el => { tab = el.dataset.tab; root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === el)); show(); });
  const show = () => UI.guard(() => ({ journal, coa, ledger, tb })[tab]());

  async function journal() {
    const accounts = (await API.get('/api/accounts')).filter(a => a.active);
    pane.innerHTML = `<div class="toolbar"><button class="btn btn-primary" id="addJ"><i class="fas fa-plus"></i> قيد يدوي</button><div class="search-box"><i class="fas fa-search"></i><input id="q" placeholder="بحث برقم القيد أو الوصف..."></div>
      <input type="date" id="from" class="form-control" style="width:auto"><input type="date" id="to" class="form-control" style="width:auto"></div><div class="note">القيود الآلية (المبيعات والمشتريات والدفعات) لا تُعدَّل ولا تُحذف؛ التصحيح يتم بالإلغاء الذي يولّد قيداً عكسياً. القيد اليدوي للتسويات فقط.</div><div id="list"></div>`;
    const load = async () => { const rows = await API.get('/api/journal', { q: pane.querySelector('#q').value, from: pane.querySelector('#from').value, to: pane.querySelector('#to').value });
      pane.querySelector('#list').innerHTML = rows.length ? rows.map(e => `<div class="table-container" style="margin-bottom:1rem"><div class="table-header"><h2 style="font-size:1rem">${F.esc(e.number)} · ${F.date(e.date)}</h2><span>${F.esc(e.description)}</span></div>
        ${UI.table([{ label: 'الحساب', render: l => `${F.esc(l.code)} — ${F.esc(l.account_name)}` }, { label: 'مدين', cls: 'amount', render: l => l.debit ? F.money(l.debit) : '' }, { label: 'دائن', cls: 'amount', render: l => l.credit ? F.money(l.credit) : '' }], e.lines)}</div>`).join('') : '<div class="empty">لا توجد قيود</div>'; };
    pane.querySelector('#q').addEventListener('input', UI.debounce(load)); ['#from', '#to'].forEach(s => pane.querySelector(s).addEventListener('change', load)); load();
    pane.querySelector('#addJ').addEventListener('click', () => {
      const m = UI.modal({ title: 'قيد يومية يدوي', size: 'wide', html: `<form novalidate><div class="form-grid">${UI.field({ name: 'date', label: 'التاريخ', type: 'date', required: true }, F.today())}${UI.field({ name: 'description', label: 'الوصف', required: true })}</div>
        <table class="line-editor"><thead><tr><th>الحساب</th><th style="width:150px">مدين</th><th style="width:150px">دائن</th></tr></thead><tbody>${[0, 1, 2, 3].map(() => `<tr><td><select class="form-control a"><option value="">—</option>${accounts.map(a => `<option value="${a.id}">${a.code} — ${F.esc(a.name)}</option>`).join('')}</select></td><td><input type="number" step="0.01" min="0" class="form-control d"></td><td><input type="number" step="0.01" min="0" class="form-control c"></td></tr>`).join('')}</tbody></table>
        <div class="totals-box"><div><span>مجموع المدين</span><span id="sd" class="num">0</span></div><div><span>مجموع الدائن</span><span id="sc" class="num">0</span></div></div><div class="form-error"></div></form>`,
        footer: '<button class="btn btn-primary" data-save>ترحيل القيد</button><button class="btn btn-outline" data-cancel>إلغاء</button>' });
      const sums = () => { let d = 0, c = 0; m.qa('.d').forEach(i => d += +i.value || 0); m.qa('.c').forEach(i => c += +i.value || 0); m.q('#sd').textContent = F.moneyText(d); m.q('#sc').textContent = F.moneyText(c); };
      m.el.addEventListener('input', sums); m.q('[data-cancel]').addEventListener('click', m.close);
      m.q('[data-save]').addEventListener('click', async () => { const f = UI.values(m.q('form')); const lines = m.qa('tbody tr').filter(tr => tr.querySelector('.a').value).map(tr => ({ account_id: +tr.querySelector('.a').value, debit: +tr.querySelector('.d').value || 0, credit: +tr.querySelector('.c').value || 0 }));
        try { await API.post('/api/journal', { date: f.date, description: f.description, lines }); m.close(); UI.toast('تم ترحيل القيد', 'success'); load(); } catch (e) { m.q('.form-error').textContent = e.message; } });
    });
  }
  async function coa() {
    const [accs, tbr] = await Promise.all([API.get('/api/accounts'), API.get('/api/reports/trial-balance')]);
    const bal = Object.fromEntries(tbr.rows.map(r => [r.code, r]));
    pane.innerHTML = `<div class="toolbar"><button class="btn btn-primary" id="addA"><i class="fas fa-plus"></i> حساب جديد</button></div><div class="table-container">${UI.table([
      { label: 'الرمز', render: a => `<b>${F.esc(a.code)}</b>` }, { label: 'الحساب', render: a => F.esc(a.name) }, { label: 'النوع', render: a => F.labels.accType[a.type] },
      { label: 'الرصيد الحالي', cls: 'amount', render: a => { const b = bal[a.code]; return b ? F.money(b.balance_debit || b.balance_credit) + (b.balance_credit ? ' <small>دائن</small>' : ' <small>مدين</small>') : '—'; } },
      { label: '', render: a => a.system_key ? '<span class="badge blue">نظامي</span>' : `<button class="btn btn-outline" data-edit="${a.id}">تعديل</button>` }], accs)}</div>`;
    pane.querySelector('#addA').addEventListener('click', () => UI.formModal({ title: 'حساب جديد', data: { type: 'expense' }, fields: [{ name: 'code', label: 'الرمز (4 أرقام)', ltr: true, required: true }, { name: 'name', label: 'اسم الحساب', required: true }, { name: 'type', label: 'النوع', type: 'select', options: Object.entries(F.labels.accType) }],
      onSubmit: async d => { await API.post('/api/accounts', d); UI.toast('تمت الإضافة', 'success'); coa(); } }));
    UI.on(pane, 'click', '[data-edit]', el => { const a = accs.find(x => x.id === +el.dataset.edit); UI.formModal({ title: `تعديل ${a.code}`, data: { name: a.name, active: !!a.active }, fields: [{ name: 'name', label: 'اسم الحساب', required: true }, { name: 'active', label: 'نشط', type: 'checkbox' }], onSubmit: async d => { await API.put(`/api/accounts/${a.id}`, d); coa(); } }); });
  }
  async function ledger() {
    const accs = await API.get('/api/accounts');
    pane.innerHTML = `<div class="toolbar"><select id="acc" class="form-control" style="width:auto;min-width:260px">${accs.map(a => `<option value="${a.id}">${a.code} — ${F.esc(a.name)}</option>`).join('')}</select><input type="date" id="from" class="form-control" style="width:auto" value="${F.yearStart()}"><input type="date" id="to" class="form-control" style="width:auto" value="${F.today()}"></div><div class="table-container" id="list"></div>`;
    const load = async () => { const r = await API.get('/api/reports/ledger', { account_id: pane.querySelector('#acc').value, from: pane.querySelector('#from').value, to: pane.querySelector('#to').value });
      pane.querySelector('#list').innerHTML = `<div class="table-header"><h2>${F.esc(r.account.code)} — ${F.esc(r.account.name)}</h2><span>الرصيد الافتتاحي: ${F.money(r.opening)}</span></div>` + UI.table([{ label: 'التاريخ', render: l => F.date(l.date) }, { label: 'القيد', render: l => F.esc(l.number) }, { label: 'البيان', render: l => F.esc(l.description) },
        { label: 'مدين', cls: 'amount', render: l => l.debit ? F.money(l.debit) : '' }, { label: 'دائن', cls: 'amount', render: l => l.credit ? F.money(l.credit) : '' }, { label: 'الرصيد', cls: 'amount', render: l => F.money(l.balance) }], r.lines, { empty: 'لا توجد حركات في الفترة' }) + `<p style="padding:1rem"><b>الرصيد الختامي: ${F.money(r.closing)}</b></p>`; };
    ['#acc', '#from', '#to'].forEach(s => pane.querySelector(s).addEventListener('change', load)); load();
  }
  async function tb() {
    const r = await API.get('/api/reports/trial-balance');
    pane.innerHTML = `<div class="${r.balanced ? 'ok-box' : 'bad-box'}">${r.balanced ? '✔ ميزان المراجعة متوازن' : '✘ ميزان المراجعة غير متوازن — راجع القيود'}</div><div class="table-container">${UI.table([
      { label: 'الرمز', render: x => F.esc(x.code) }, { label: 'الحساب', render: x => F.esc(x.name) }, { label: 'حركة مدينة', cls: 'amount', render: x => F.money(x.debit) }, { label: 'حركة دائنة', cls: 'amount', render: x => F.money(x.credit) },
      { label: 'رصيد مدين', cls: 'amount', render: x => x.balance_debit ? F.money(x.balance_debit) : '' }, { label: 'رصيد دائن', cls: 'amount', render: x => x.balance_credit ? F.money(x.balance_credit) : '' }], r.rows)}
      <p style="padding:1rem"><b>الإجمالي — مدين: ${F.money(r.totals.balance_debit)} | دائن: ${F.money(r.totals.balance_credit)}</b></p></div>`;
  }
  show();
});
