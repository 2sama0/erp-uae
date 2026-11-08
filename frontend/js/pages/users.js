// إدارة المستخدمين والصلاحيات (للمدير فقط)
App.init({ key: 'users', title: 'المستخدمون والصلاحيات', roles: [] }, async (root, { user }) => {
  const roles = Object.entries(F.labels.role);
  root.innerHTML = `<div class="toolbar"><button class="btn btn-primary" id="add"><i class="fas fa-user-plus"></i> مستخدم جديد</button></div><div class="table-container" id="list"></div>
    <div class="note" style="margin-top:1rem"><b>الصلاحيات:</b> مبيعات (العملاء والفواتير وقبض الدفعات) · مشتريات (الموردون وأوامر الشراء والصرف) · محاسب (الحسابات والتقارير وكل السندات) · أمين مخزن (المخازن والجرد والنقل) · مدير (كل شيء).</div>`;
  async function load() {
    const rows = await API.get('/api/users'); root._rows = rows;
    root.querySelector('#list').innerHTML = UI.table([{ label: 'المستخدم', render: u => `<b>${F.esc(u.full_name)}</b><br><small class="num">${F.esc(u.username)}</small>` }, { label: 'الدور', render: u => F.labels.role[u.role] }, { label: 'الحالة', render: u => u.active ? '<span class="badge green">نشط</span>' : '<span class="badge gray">معطّل</span>' },
      { label: 'أُنشئ', render: u => F.date(u.created_at) }, { label: '', render: u => `<button class="btn btn-outline" data-edit="${u.id}">تعديل</button>` }], rows);
  }
  root.querySelector('#add').addEventListener('click', () => UI.formModal({ title: 'مستخدم جديد', data: { role: 'sales' }, fields: [{ name: 'full_name', label: 'الاسم الكامل', required: true }, { name: 'username', label: 'اسم المستخدم (إنجليزي)', ltr: true, required: true },
    { name: 'role', label: 'الدور', type: 'select', options: roles }, { name: 'password', label: 'كلمة المرور', type: 'password', required: true, hint: '8 أحرف على الأقل، حروف وأرقام' }], onSubmit: async d => { await API.post('/api/users', d); UI.toast('تم إنشاء المستخدم', 'success'); load(); } }));
  UI.on(root, 'click', '[data-edit]', el => { const u = root._rows.find(x => x.id === +el.dataset.edit); const self = u.id === user.id;
    UI.formModal({ title: `تعديل ${u.username}`, data: { ...u, active: !!u.active, password: '' }, fields: [{ name: 'full_name', label: 'الاسم الكامل' }, ...(self ? [] : [{ name: 'role', label: 'الدور', type: 'select', options: roles }, { name: 'active', label: 'نشط', type: 'checkbox' }]),
      { name: 'password', label: 'كلمة مرور جديدة (اتركها فارغة بدون تغيير)', type: 'password' }],
      onSubmit: async d => { if (!d.password) delete d.password; if (self) { delete d.role; delete d.active; } await API.put(`/api/users/${u.id}`, d); UI.toast('تم الحفظ', 'success'); load(); } }); });
  load();
});
