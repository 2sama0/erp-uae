// تسجيل الدخول: التحقق يتم على الخادم (لا توجد أي حسابات أو أدوار تُحدَّد من المتصفح)
(function () {
  if (API.hasToken()) { API.get('/api/auth/me').then(() => (location.href = 'dashboard.html')).catch(() => API.clear()); }
  const form = document.getElementById('loginForm'), err = document.getElementById('loginError'), btn = document.getElementById('loginBtn');
  document.getElementById('togglePassword').addEventListener('click', () => {
    const p = document.getElementById('password'); p.type = p.type === 'password' ? 'text' : 'password';
  });
  form.addEventListener('submit', async e => {
    e.preventDefault(); err.style.display = 'none';
    const username = form.username.value.trim(), password = form.password.value;
    if (!username || !password) { err.textContent = 'أدخل اسم المستخدم وكلمة المرور'; err.style.display = 'block'; return; }
    btn.disabled = true;
    try { const r = await API.post('/api/auth/login', { username, password }); API.setSession(r.token, r.user); location.href = 'dashboard.html'; }
    catch (x) { err.textContent = x.message; err.style.display = 'block'; btn.disabled = false; }
  });
})();
