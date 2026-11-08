// backend/uae.js — ثوابت ودوال تحقق خاصة بدولة الإمارات
'use strict';

const EMIRATES = ['أبوظبي', 'دبي', 'الشارقة', 'عجمان', 'أم القيوين', 'رأس الخيمة', 'الفجيرة'];
const VAT_RATE = 0.05; // ضريبة القيمة المضافة 5%

/** خوارزمية Luhn (يستخدمها رقم الهوية الإماراتية في الخانة الأخيرة) */
function luhnValid(digits) {
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}
function luhnCheckDigit(body) {
  for (let c = 0; c < 10; c++) if (luhnValid(body + c)) return String(c);
}

/** الهوية الإماراتية: 784-YYYY-NNNNNNN-C (15 رقماً) */
function validateEmiratesId(id) {
  const d = String(id || '').replace(/[\s-]/g, '');
  return /^784\d{12}$/.test(d) && luhnValid(d);
}
function formatEmiratesId(id) {
  const d = String(id || '').replace(/[\s-]/g, '');
  return d.length === 15 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d.slice(14)}` : id;
}

/** الرقم الضريبي TRN: 15 رقماً */
function validateTRN(trn) { return /^\d{15}$/.test(String(trn || '').replace(/\s/g, '')); }

/** رقم هاتف إماراتي: جوال (50/52/54/55/56/58) أو أرضي. يعيد الصيغة الدولية أو null */
function normalizePhone(phone) {
  let p = String(phone || '').replace(/[\s\-()]/g, '');
  if (p.startsWith('+971')) p = p.slice(4);
  else if (p.startsWith('00971')) p = p.slice(5);
  else if (p.startsWith('971')) p = p.slice(3);
  else if (p.startsWith('0')) p = p.slice(1);
  if (/^5[024568]\d{7}$/.test(p)) return '+971' + p;          // جوال
  if (/^[2-9]\d{7}$/.test(p)) return '+971' + p;              // أرضي (مثل 4xxxxxxx دبي)
  return null;
}

/** رقم الشاسيه VIN: 17 خانة بدون الأحرف I و O و Q */
function validateVIN(vin) { return /^[A-HJ-NPR-Z0-9]{17}$/.test(String(vin || '').toUpperCase()); }

module.exports = { EMIRATES, VAT_RATE, luhnValid, luhnCheckDigit, validateEmiratesId, formatEmiratesId, validateTRN, normalizePhone, validateVIN };
