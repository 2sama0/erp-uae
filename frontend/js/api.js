// js/api.js — الاتصال بالخادم (REST) وإدارة جلسة الدخول
'use strict';
const API = (() => {
  const KEY = 'erp_token';
  const token = () => localStorage.getItem(KEY);
  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* لا يوجد جسم */ }
    if (res.status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem(KEY); localStorage.removeItem('erp_user');
      if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
    }
    if (!res.ok) { const e = new Error((data && data.error) || 'حدث خطأ'); e.status = res.status; e.field = data && data.field; throw e; }
    return data;
  }
  const qs = o => { const p = new URLSearchParams(); Object.entries(o || {}).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); }); const s = p.toString(); return s ? '?' + s : ''; };
  return {
    get: (u, q) => call('GET', u + qs(q)), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: u => call('DELETE', u),
    setSession: (t, user) => { localStorage.setItem(KEY, t); localStorage.setItem('erp_user', JSON.stringify(user)); },
    clear: () => { localStorage.removeItem(KEY); localStorage.removeItem('erp_user'); },
    hasToken: () => !!token(),
    user: () => { try { return JSON.parse(localStorage.getItem('erp_user')); } catch { return null; } },
  };
})();
