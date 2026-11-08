// js/ui.js — مكوّنات واجهة مشتركة: إشعارات، نوافذ، نماذج، جداول
'use strict';
const UI = (() => {
  const esc = F.esc;

  function toast(msg, type = '') {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; wrap.appendChild(t);
    setTimeout(() => t.remove(), type === 'error' ? 6000 : 3500);
  }

  /** نافذة منبثقة. تعيد {el, body, close, setError} */
  function modal({ title, html = '', size = '', footer = '' }) {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.innerHTML = `<div class="modal-container ${size}" role="dialog" aria-modal="true">
      <div class="modal-header"><h3>${esc(title)}</h3><button type="button" class="modal-close" aria-label="إغلاق">&times;</button></div>
      <div class="modal-body">${html}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.querySelector('.modal-close').addEventListener('click', close);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    return { el: ov, body: ov.querySelector('.modal-body'), close, q: s => ov.querySelector(s), qa: s => [...ov.querySelectorAll(s)] };
  }

  function confirmBox(message, { okText = 'تأكيد', danger = false } = {}) {
    return new Promise(resolve => {
      const m = modal({ title: 'تأكيد', html: `<p>${esc(message)}</p>`,
        footer: `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okText)}</button><button class="btn btn-outline" data-cancel>إلغاء</button>` });
      m.q('[data-ok]').addEventListener('click', () => { m.close(); resolve(true); });
      m.q('[data-cancel]').addEventListener('click', () => { m.close(); resolve(false); });
      m.q('.modal-close').addEventListener('click', () => resolve(false));
    });
  }

  /** حقل نموذج. f: {name,label,type,options:[[value,label]],required,hint,full,ltr,attrs} */
  function field(f, value = '') {
    const id = 'f_' + f.name;
    const req = f.required ? '<span class="req">*</span>' : '';
    let input;
    if (f.type === 'select') {
      input = `<select class="form-control" id="${id}" name="${f.name}">${(f.options || []).map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea class="form-control" id="${id}" name="${f.name}" rows="2">${esc(value)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<div class="form-group ${f.full ? 'full' : ''}"><label><input type="checkbox" id="${id}" name="${f.name}" ${value ? 'checked' : ''}> ${esc(f.label)}</label>${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
    } else {
      input = `<input class="form-control ${f.ltr ? 'ltr' : ''}" id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(value)}" ${f.attrs || ''} ${f.required ? 'required' : ''}>`;
    }
    return `<div class="form-group ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)} ${req}</label>${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
  }

  /** قراءة قيم نموذج كاملة كـ object */
  function values(root) {
    const o = {};
    root.querySelectorAll('[name]').forEach(el => { o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
    return o;
  }

  /** نافذة نموذج جاهزة: onSubmit(data) تُرجع Promise. تُغلق عند النجاح وتعرض الخطأ عند الفشل */
  function formModal({ title, fields, data = {}, submitText = 'حفظ', size = '', extraHtml = '', onSubmit, onOpen }) {
    const m = modal({ title, size, html: `<form novalidate><div class="form-grid">${fields.map(f => field(f, data[f.name] ?? f.default ?? '')).join('')}</div>${extraHtml}<div class="form-error" role="alert"></div></form>`,
      footer: `<button class="btn btn-primary" data-submit>${esc(submitText)}</button><button class="btn btn-outline" data-cancel>إلغاء</button>` });
    const form = m.q('form'), err = m.q('.form-error'), btn = m.q('[data-submit]');
    const clearErrors = () => {
  err.textContent = '';
  form.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
  form.querySelectorAll('.field-msg').forEach(el => el.remove());
};
const showError = e => {
  err.textContent = e.message;               // الرسالة العامة أسفل النموذج
  toast(e.message, 'error');                 // إشعار ظاهر دائماً
  const input = e.field && form.querySelector(`[name="${e.field}"]`);
  if (input) {
    input.classList.add('field-error');
    const msg = document.createElement('span');
    msg.className = 'field-msg';
    msg.textContent = e.message;
    input.insertAdjacentElement('afterend', msg);
    input.focus();
  }
};
const submit = async () => {
  clearErrors(); btn.disabled = true;
  try { await onSubmit(values(form), m); m.close(); }
  catch (e) { showError(e); }
  finally { btn.disabled = false; }
};
    btn.addEventListener('click', submit);
    form.addEventListener('submit', e => { e.preventDefault(); submit(); });
    m.q('[data-cancel]').addEventListener('click', m.close);
    if (onOpen) onOpen(m);
    return m;
  }

  /** جدول HTML. columns: [{label, render(row), cls}] */
  function table(columns, rows, { empty = 'لا توجد بيانات', rowClass } = {}) {
    if (!rows.length) return `<div class="empty"><i class="fas fa-inbox"></i><p>${esc(empty)}</p></div>`;
    return `<div class="table-responsive"><table class="data-table"><thead><tr>${columns.map(c => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="${rowClass ? rowClass(r) : ''}">${columns.map(c => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /** تفويض الأحداث: on(root,'click','[data-act]',(el,e)=>...) */
  function on(root, type, selector, fn) {
    root.addEventListener(type, e => { const el = e.target.closest(selector); if (el && root.contains(el)) fn(el, e); });
  }
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const opts = (rows, valKey, labelFn, first) => [...(first ? [first] : []), ...rows.map(r => [r[valKey], labelFn(r)])];

  async function guard(fn) { try { return await fn(); } catch (e) { toast(e.message, 'error'); } }
  const fieldError = (msg, field) => Object.assign(new Error(msg), { field });
  return { toast, modal, confirmBox, field, values, formModal, table, on, debounce, opts, guard, esc, fieldError };
})();
