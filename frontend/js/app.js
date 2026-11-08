// js/app.js — هيكل الصفحة المشترك (قائمة جانبية + شريط علوي) وحماية الصفحات بتسجيل الدخول
'use strict';
const App = (() => {
  const NAV = [
    { title: 'القائمة الرئيسية', items: [
      ['dashboard', 'dashboard.html', 'fa-home', 'لوحة التحكم', null],
      ['sales', 'sales.html', 'fa-shopping-cart', 'المبيعات (الفواتير)', ['sales', 'accountant']],
      ['customers', 'customers.html', 'fa-users', 'العملاء', ['sales', 'accountant']],
      ['inventory', 'inventory.html', 'fa-warehouse', 'المخازن والمخزون', null],
    ] },
    { title: 'المشتريات', items: [
      ['purchases', 'purchases.html', 'fa-shopping-bag', 'أوامر الشراء', ['purchasing', 'accountant', 'warehouse']],
      ['suppliers', 'suppliers.html', 'fa-truck', 'الموردون', ['purchasing', 'accountant']],
    ] },
    { title: 'الحسابات', items: [
      ['payments', 'payments.html', 'fa-money-bill-wave', 'الدفعات والمصروفات', ['accountant', 'sales', 'purchasing']],
      ['accounting', 'accounting.html', 'fa-calculator', 'دليل الحسابات والقيود', ['accountant']],
      ['reports', 'reports.html', 'fa-chart-bar', 'التقارير والضريبة', ['accountant']],
    ] },
    { title: 'النظام', items: [
      ['users', 'users.html', 'fa-user-cog', 'المستخدمون', ['admin']],
      ['settings', 'settings.html', 'fa-cog', 'إعدادات الشركة', ['admin']],
    ] },
  ];
  const can = (user, roles) => !roles || user.role === 'admin' || roles.includes(user.role);

  /** page: {key, title, roles?}; main(content, ctx) */
  async function init(page, main) {
    if (!API.hasToken()) { location.href = 'login.html'; return; }
    let user, meta;
    try { user = await API.get('/api/auth/me'); meta = await API.get('/api/meta'); }
    catch (e) { location.href = 'login.html'; return; }
    localStorage.setItem('erp_user', JSON.stringify(user));
    if (!can(user, page.roles)) { document.body.innerHTML = '<div style="padding:3rem;text-align:center"><h2>ليس لديك صلاحية لهذه الصفحة</h2><p><a href="dashboard.html">العودة للوحة التحكم</a></p></div>'; return; }

    const menu = NAV.map(sec => {
      const items = sec.items.filter(i => can(user, i[4]));
      return items.length ? `<div class="menu-section"><h4 class="section-title">${sec.title}</h4><ul>${items.map(i =>
        `<li class="menu-item ${i[0] === page.key ? 'active' : ''}"><a href="${i[1]}"><i class="fas ${i[2]}"></i><span>${i[3]}</span></a></li>`).join('')}</ul></div>` : '';
    }).join('');

    document.body.classList.add('dashboard-page');
    document.getElementById('app').innerHTML = `
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header"><div class="logo"><i class="fas fa-car"></i><div class="logo-text"><h2>CarDealer</h2><span>ERP · UAE</span></div></div></div>
        <div class="user-profile"><div class="user-info"><h3>${F.esc(user.full_name)}</h3><span class="user-role">${F.esc(F.labels.role[user.role])}</span></div></div>
        <nav class="sidebar-menu">${menu}</nav>
        <div class="sidebar-footer"><button class="btn-logout" id="logoutBtn"><i class="fas fa-sign-out-alt"></i><span>تسجيل الخروج</span></button></div>
      </aside>
      <main class="main-content">
        <header class="topbar">
          <div class="topbar-left"><h1 class="page-title">${F.esc(page.title)}</h1><nav class="breadcrumb"><a href="dashboard.html">الرئيسية</a><i class="fas fa-chevron-left"></i><span>${F.esc(page.title)}</span></nav></div>
          <div class="topbar-right"><button class="btn btn-outline btn-sm" id="menuToggle" style="display:none"><i class="fas fa-bars"></i></button>
            <div class="date-time"><i class="fas fa-calendar-alt"></i><span>${F.esc(meta.settings.company_name || '')} — ${new Date().toLocaleDateString('ar-AE-u-nu-latn-ca-gregory', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span></div></div>
        </header>
        <div class="content-wrapper" id="content"></div>
      </main>`;
    document.title = `${page.title} — ${meta.settings.company_name || 'CarDealer ERP'}`;
    document.getElementById('logoutBtn').addEventListener('click', async () => { try { await API.post('/api/auth/logout'); } catch (_) {} API.clear(); location.href = 'login.html'; });
    const tg = document.getElementById('menuToggle');
    if (window.innerWidth <= 992) tg.style.display = '';
    tg.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('active'));
    try { await main(document.getElementById('content'), { user, meta, can: r => can(user, r) }); }
    catch (e) { document.getElementById('content').innerHTML = `<div class="bad-box">تعذر تحميل الصفحة: ${F.esc(e.message)}</div>`; }
  }
  return { init, can };
})();
