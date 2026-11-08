// إعدادات الشركة (بيانات الفاتورة الضريبية) + تغيير كلمة المرور
App.init({ key: 'settings', title: 'إعدادات الشركة', roles: [] }, async (root) => {
  const s = await API.get('/api/settings');
  root.innerHTML = `<div class="grid-2"><div class="card"><h3>بيانات الشركة (تظهر في الفاتورة الضريبية)</h3><form id="f" novalidate><div class="form-grid">
    ${UI.field({ name: 'company_name', label: 'اسم الشركة (عربي)', required: true }, s.company_name)}${UI.field({ name: 'company_name_en', label: 'اسم الشركة (إنجليزي)', ltr: true }, s.company_name_en)}
    ${UI.field({ name: 'trn', label: 'الرقم الضريبي TRN', ltr: true, hint: '15 رقماً صادر عن الهيئة الاتحادية للضرائب' }, s.trn)}${UI.field({ name: 'vat_rate', label: 'نسبة ضريبة القيمة المضافة', type: 'number', attrs: 'step="0.01" min="0" max="0.25"', hint: 'النسبة القياسية في الإمارات 0.05 (5%)' }, s.vat_rate)}
    ${UI.field({ name: 'phone', label: 'الهاتف', ltr: true }, s.phone)}${UI.field({ name: 'email', label: 'البريد', ltr: true }, s.email)}${UI.field({ name: 'address', label: 'العنوان', full: true }, s.address)}
    ${UI.field({ name: 'bank_name', label: 'اسم البنك' }, s.bank_name)}${UI.field({ name: 'iban', label: 'رقم الآيبان IBAN', ltr: true, hint: 'يبدأ بـ AE ويتكون من 23 خانة' }, s.iban)}</div><div class="form-error"></div><button class="btn btn-primary" style="margin-top:1rem">حفظ</button></form></div>
    <div class="card"><h3>تغيير كلمة مروري</h3><form id="p" novalidate><div class="form-grid">${UI.field({ name: 'current', label: 'كلمة المرور الحالية', type: 'password', full: true })}${UI.field({ name: 'next', label: 'كلمة المرور الجديدة', type: 'password', full: true, hint: '8 أحرف على الأقل، حروف وأرقام' })}</div><div class="form-error"></div><button class="btn btn-primary" style="margin-top:1rem">تغيير</button></form></div></div>`;
  root.querySelector('#f').addEventListener('submit', async e => { e.preventDefault(); const err = e.target.querySelector('.form-error'); err.textContent = '';
    try { const d = UI.values(e.target); if (d.trn && !F.validTRN(d.trn)) throw new Error('الرقم الضريبي يجب أن يكون 15 رقماً'); await API.put('/api/settings', d); UI.toast('تم الحفظ', 'success'); } catch (x) { err.textContent = x.message; } });
  root.querySelector('#p').addEventListener('submit', async e => { e.preventDefault(); const err = e.target.querySelector('.form-error'); err.textContent = '';
    try { await API.post('/api/auth/password', UI.values(e.target)); UI.toast('تم تغيير كلمة المرور', 'success'); e.target.reset(); } catch (x) { err.textContent = x.message; } });
});
