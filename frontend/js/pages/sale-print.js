// فاتورة ضريبية للطباعة (تتضمن الرقم الضريبي للمنشأة والعميل وتفصيل الضريبة بالدرهم)
(async function () {
  document.getElementById('print').addEventListener('click', () => window.print());
  if (!API.hasToken()) { location.href = 'login.html'; return; }
  const sheet = document.getElementById('sheet');
  try {
    const id = new URLSearchParams(location.search).get('id');
    const [s, meta] = await Promise.all([API.get(`/api/sales/${id}`), API.get('/api/meta')]); const c = meta.settings, e = F.esc;
    const simplified = !s.customer_trn && s.total < 10000;
    sheet.innerHTML = `
      <div class="head"><div><h1>${e(c.company_name)}</h1><div class="en">${e(c.company_name_en)}</div><div>${e(c.address)}</div><div class="num">${e(c.phone)} · ${e(c.email)}</div><div><b>الرقم الضريبي (TRN):</b> <span class="num">${e(c.trn)}</span></div></div>
        <div style="text-align:left"><h1>${simplified ? 'فاتورة ضريبية مبسّطة' : 'فاتورة ضريبية'}</h1><div class="en">${simplified ? 'Simplified Tax Invoice' : 'Tax Invoice'}</div><div style="font-size:1.1rem"><b class="num">${e(s.number)}</b></div>${s.status === 'cancelled' ? '<div style="color:#c0392b;font-weight:800">ملغاة</div>' : ''}</div></div>
      <div class="meta"><div><b>التاريخ:</b> ${F.date(s.date)}</div><div><b>تاريخ الاستحقاق:</b> ${F.date(s.due_date)}</div>
        <div><b>العميل:</b> ${e(s.customer_name)}</div><div><b>الهاتف:</b> <span class="num">${e(s.customer_phone || '—')}</span></div>
        <div><b>${s.customer_type === 'company' ? 'TRN العميل' : 'الهوية'}:</b> <span class="num">${e(s.customer_trn || s.emirates_id || '—')}</span></div><div><b>طريقة الدفع:</b> ${F.labels.payMethod[s.payment_method]}</div></div>
      <table><thead><tr><th>#</th><th>البيان</th><th class="n">الكمية</th><th class="n">سعر الوحدة</th><th class="n">الخصم</th><th class="n">قبل الضريبة</th><th class="n">الضريبة ${s.vat_rate * 100}%</th><th class="n">الإجمالي</th></tr></thead><tbody>
      ${s.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${e(l.description)}${l.vin ? `<br><small class="num">VIN: ${e(l.vin)} · ${e(l.color || '')} ${l.year || ''}</small>` : ''}</td><td class="n">${F.num(l.qty)}</td><td class="n">${F.num(l.unit_price)}</td><td class="n">${F.num(l.discount)}</td><td class="n">${F.num(l.line_subtotal)}</td><td class="n">${F.num(l.line_vat)}</td><td class="n">${F.num(l.line_subtotal + l.line_vat)}</td></tr>`).join('')}</tbody></table>
      <div class="tot"><div><span>المجموع قبل الضريبة</span><span class="num">${F.moneyText(s.subtotal)}</span></div><div><span>ضريبة القيمة المضافة (${s.vat_rate * 100}%)</span><span class="num">${F.moneyText(s.vat)}</span></div>
        <div class="g"><span>الإجمالي (AED)</span><span class="num">${F.moneyText(s.total)}</span></div><div><span>المدفوع</span><span class="num">${F.moneyText(s.paid)}</span></div><div><span>المتبقي</span><span class="num">${F.moneyText(s.status === 'cancelled' ? 0 : s.remaining)}</span></div></div>
      <div class="foot">${c.bank_name ? `الحساب البنكي: ${e(c.bank_name)} — IBAN: <span class="num">${e(c.iban)}</span><br>` : ''}${s.notes ? `ملاحظات: ${e(s.notes)}<br>` : ''}جميع المبالغ بالدرهم الإماراتي (AED). ${s.vat_rate === 0 ? 'توريد مصدَّر خاضع لنسبة الصفر.' : ''}</div>`;
    document.title = `فاتورة ${s.number}`;
  } catch (x) { sheet.innerHTML = `<p style="color:#c0392b;text-align:center">${F.esc(x.message)}</p>`; }
})();
