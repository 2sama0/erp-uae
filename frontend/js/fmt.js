// js/fmt.js — التنسيق والتحقق (بصيغة دولة الإمارات: درهم AED، تاريخ ميلادي، هاتف +971)
'use strict';
const F = (() => {
  const LOCALE = 'ar-AE-u-nu-latn-ca-gregory';
  const moneyFmt = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'AED', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

  const labels = {
    payMethod: { cash: 'نقداً', bank_transfer: 'تحويل بنكي', cheque: 'شيك', card: 'بطاقة', financing: 'تمويل بنكي' },
    saleStatus: { unpaid: ['غير مدفوعة', 'red'], partial: ['مدفوعة جزئياً', 'orange'], paid: ['مدفوعة', 'green'], cancelled: ['ملغاة', 'gray'] },
    poStatus: { ordered: ['مطلوب (لم يُستلم)', 'blue'], received: ['مستلم', 'green'], cancelled: ['ملغي', 'gray'] },
    productType: { car: 'سيارة', accessory: 'إكسسوار', part: 'قطعة غيار' },
    condition: { new: 'جديدة', used: 'مستعملة' },
    moveType: { purchase: 'شراء (دخول)', sale: 'بيع (خروج)', sale_cancel: 'إلغاء بيع', transfer: 'نقل بين مخازن', adjustment: 'تسوية جرد', purchase_cancel: 'إلغاء شراء' },
    payType: { receipt: 'سند قبض', disbursement: 'سند صرف', expense: 'مصروف' },
    role: { admin: 'مدير النظام', sales: 'مبيعات', purchasing: 'مشتريات', accountant: 'محاسب', warehouse: 'أمين مخزن' },
    custType: { individual: 'فرد', company: 'شركة' },
    accType: { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات' },
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `<span class="num">${moneyFmt.format(Number(n || 0))}</span>`;
  const moneyText = n => moneyFmt.format(Number(n || 0));
  const num = n => numFmt.format(Number(n || 0));
  const date = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const monthStart = () => today().slice(0, 8) + '01';
  const yearStart = () => today().slice(0, 4) + '-01-01';
  const badge = (map, key) => { const v = map[key] || [key, 'gray']; return `<span class="badge ${v[1]}">${esc(v[0])}</span>`; };
  const phone = p => p ? `<span class="num ltr">${esc(p)}</span>` : '—';

  // ---- تحقق الواجهة (نفس قواعد الخادم؛ الخادم هو المرجع النهائي) ----
  function luhn(d) { let s = 0, dbl = false; for (let i = d.length - 1; i >= 0; i--) { let x = +d[i]; if (dbl) { x *= 2; if (x > 9) x -= 9; } s += x; dbl = !dbl; } return s % 10 === 0; }
  const validEmiratesId = v => { const d = String(v || '').replace(/[\s-]/g, ''); return /^784\d{12}$/.test(d) && luhn(d); };
  const validTRN = v => /^\d{15}$/.test(String(v || '').replace(/\s/g, ''));
  const validVIN = v => /^[A-HJ-NPR-Z0-9]{17}$/.test(String(v || '').toUpperCase());

  return { labels, esc, money, moneyText, num, date, today, monthStart, yearStart, badge, phone, validEmiratesId, validTRN, validVIN };
})();
