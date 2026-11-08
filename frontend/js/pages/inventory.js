// المخازن والمخزون: سيارات (برقم شاسيه) + إكسسوارات وقطع غيار + حركة المخزون
App.init({ key: 'inventory', title: 'المخازن والمخزون' }, async (root, { meta, can }) => {
  const canWh = can(['warehouse']);
  const user = API.user(); const showCost = user.role !== 'sales';
  let tab = 'cars', warehouses = [];
  const tabs = [['cars', 'السيارات'], ['parts', 'الإكسسوارات وقطع الغيار'], ['warehouses', 'المخازن'], ['moves', 'حركة المخزون']];
  root.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div><div id="pane"></div>`;
  const pane = root.querySelector('#pane');
  UI.on(root, 'click', '[data-tab]', el => { tab = el.dataset.tab; root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === el)); render(); });
  const whOpts = () => warehouses.map(w => [w.id, w.name]);

  async function render() { warehouses = await API.get('/api/warehouses'); ({ cars, parts, warehouses: whTab, moves })[tab](); }

  const search = (ph, extra = '') => `<div class="toolbar"><div class="search-box"><i class="fas fa-search"></i><input id="q" placeholder="${ph}"></div>
    <select id="wh" class="form-control" style="width:auto"><option value="">كل المخازن</option>${warehouses.map(w => `<option value="${w.id}">${F.esc(w.name)}</option>`).join('')}</select>${extra}</div><div class="table-container" id="list"></div>`;

  function actions(p) {
    return `<div class="row-actions"><button class="btn btn-outline" data-act="edit" data-id="${p.id}">تعديل</button>
      ${canWh ? `<button class="btn btn-outline" data-act="transfer" data-id="${p.id}">نقل</button><button class="btn btn-outline" data-act="adjust" data-id="${p.id}">جرد</button>` : ''}</div>`;
  }

  function bindList(type) {
    const load = async () => {
      const rows = await API.get('/api/products', { type: type === 'cars' ? 'car' : '', q: pane.querySelector('#q').value, warehouse_id: pane.querySelector('#wh').value });
      const list = type === 'cars' ? rows : rows.filter(r => r.type !== 'car'); pane._rows = list;
      const cols = type === 'cars' ? [
        { label: 'السيارة', render: r => `<b>${F.esc(r.name)}</b><br><small class="num">VIN ${F.esc(r.vin)}</small>` },
        { label: 'اللون / الحالة', render: r => `${F.esc(r.color || '—')}<br><small>${F.labels.condition[r.condition] || ''}${r.specs ? ' · ' + F.esc(r.specs) : ''}${r.mileage ? ' · ' + F.num(r.mileage) + ' كم' : ''}</small>` },
        { label: 'المخزن', render: r => F.esc(r.warehouse_name || '—') },
        ...(showCost ? [{ label: 'التكلفة', cls: 'amount', render: r => F.money(r.cost) }] : []), { label: 'سعر البيع', cls: 'amount', render: r => F.money(r.price) },
        { label: 'الحالة', render: r => r.qty > 0 ? '<span class="badge green">متوفرة</span>' : '<span class="badge gray">مباعة</span>' }, { label: '', render: actions },
      ] : [
        { label: 'المنتج', render: r => `<b>${F.esc(r.name)}</b><br><small>${F.esc(r.sku)} · ${F.labels.productType[r.type]}</small>` }, { label: 'التصنيف', render: r => F.esc(r.category || '—') },
        { label: 'المخزن', render: r => F.esc(r.warehouse_name || '—') },
        { label: 'الكمية', render: r => r.min_qty > 0 && r.qty <= r.min_qty ? `<span class="badge red">${F.num(r.qty)} (نقص)</span>` : `<b>${F.num(r.qty)}</b>` }, { label: 'الحد الأدنى', render: r => F.num(r.min_qty) },
        ...(showCost ? [{ label: 'متوسط التكلفة', cls: 'amount', render: r => F.money(r.cost) }] : []), { label: 'سعر البيع', cls: 'amount', render: r => F.money(r.price) }, { label: '', render: actions },
      ];
      pane.querySelector('#list').innerHTML = `<div class="table-header"><h2>${type === 'cars' ? 'السيارات' : 'الإكسسوارات وقطع الغيار'} (${list.length})</h2></div>` + UI.table(cols, list, { empty: 'لا توجد عناصر', rowClass: r => (type === 'cars' && r.qty === 0) ? 'cancelled' : '' });
    };
    pane.querySelector('#q').addEventListener('input', UI.debounce(load)); pane.querySelector('#wh').addEventListener('change', load); load();
    pane._reload = load;
  }

  function cars() {
    pane.innerHTML = search('بحث باسم السيارة أو رقم الشاسيه VIN...', can(['purchasing']) ? '<a class="btn btn-primary" href="purchases.html?new=car"><i class="fas fa-plus"></i> شراء سيارة جديدة للمخزون</a>' : '');
    bindList('cars');
  }
  function parts() {
    pane.innerHTML = search('بحث بالاسم أو الرمز SKU...', canWh || can(['purchasing']) ? '<button class="btn btn-primary" id="addPart"><i class="fas fa-plus"></i> منتج جديد</button>' : '');
    bindList('parts');
    pane.querySelector('#addPart')?.addEventListener('click', () => UI.formModal({ title: 'إكسسوار / قطعة غيار جديدة', data: { type: 'accessory', min_qty: 0, price: 0, warehouse_id: whOpts()[0]?.[0] },
      fields: [{ name: 'type', label: 'النوع', type: 'select', options: [['accessory', 'إكسسوار'], ['part', 'قطعة غيار']] }, { name: 'name', label: 'الاسم', required: true }, { name: 'sku', label: 'الرمز SKU (اختياري)', ltr: true },
        { name: 'category', label: 'التصنيف' }, { name: 'warehouse_id', label: 'المخزن', type: 'select', options: whOpts() }, { name: 'price', label: 'سعر البيع (د.إ)', type: 'number', attrs: 'min="0" step="0.01"' }, { name: 'min_qty', label: 'حد إعادة الطلب', type: 'number', attrs: 'min="0"' }],
      extraHtml: '<p class="hint">تبدأ الكمية من صفر؛ تدخل الكمية عبر «أمر شراء» حتى تتوافق الحسابات مع المخزون.</p>',
      onSubmit: async d => { await API.post('/api/products', { ...d, warehouse_id: +d.warehouse_id, price: +d.price, min_qty: +d.min_qty }); UI.toast('تمت الإضافة', 'success'); pane._reload(); } }));
  }

  UI.on(root, 'click', '[data-act]', el => {
    const p = (pane._rows || []).find(r => r.id === +el.dataset.id); if (!p) return;
    if (el.dataset.act === 'edit') UI.formModal({ title: `تعديل: ${p.name}`, data: p, size: 'wide', fields: [
      { name: 'name', label: 'الاسم', required: true }, { name: 'color', label: 'اللون' }, { name: 'specs', label: 'المواصفات' }, { name: 'category', label: 'التصنيف' },
      { name: 'price', label: 'سعر البيع (د.إ)', type: 'number', attrs: 'min="0" step="0.01"' }, { name: 'min_qty', label: 'حد إعادة الطلب', type: 'number' },
      ...(p.type === 'car' ? [{ name: 'mileage', label: 'المسافة المقطوعة (كم)', type: 'number' }, { name: 'plate_emirate', label: 'إمارة الترخيص (للمستعمل)', type: 'select', options: [['', '—'], ...meta.emirates.map(e => [e, e])] }, { name: 'plate_no', label: 'رقم اللوحة' }] : [])],
      onSubmit: async d => { await API.put(`/api/products/${p.id}`, { ...d, price: +d.price, min_qty: +d.min_qty }); UI.toast('تم الحفظ', 'success'); pane._reload(); } });
    if (el.dataset.act === 'transfer') UI.formModal({ title: `نقل: ${p.name}`, data: { date: F.today() }, fields: [
      { name: 'to_warehouse_id', label: 'إلى مخزن', type: 'select', options: whOpts().filter(o => o[0] !== p.warehouse_id) }, { name: 'date', label: 'التاريخ', type: 'date' }, { name: 'note', label: 'ملاحظة', full: true }],
      onSubmit: async d => { await API.post('/api/stock/transfer', { product_id: p.id, ...d, to_warehouse_id: +d.to_warehouse_id }); UI.toast('تم النقل', 'success'); pane._reload(); } });
    if (el.dataset.act === 'adjust') UI.formModal({ title: `تسوية جرد: ${p.name}`, data: { date: F.today(), actual_qty: p.qty }, fields: [
      { name: 'actual_qty', label: `الكمية الفعلية (الحالية في النظام ${F.num(p.qty)})`, type: 'number', attrs: 'min="0" step="1"', required: true }, { name: 'date', label: 'التاريخ', type: 'date' }, { name: 'reason', label: 'السبب (تالف / فقد / زيادة جرد...)', required: true, full: true }],
      extraHtml: '<p class="hint">يُرحَّل فرق القيمة تلقائياً في الحسابات (مصروفات متنوعة مقابل المخزون).</p>',
      onSubmit: async d => { await API.post('/api/stock/adjust', { product_id: p.id, ...d, actual_qty: +d.actual_qty }); UI.toast('تمت التسوية', 'success'); pane._reload(); } });
  });

  function whTab() {
    pane.innerHTML = `<div class="toolbar">${canWh ? '<button class="btn btn-primary" id="addWh"><i class="fas fa-plus"></i> مخزن جديد</button>' : ''}</div><div class="table-container">${UI.table([
      { label: 'المخزن', render: w => `<b>${F.esc(w.name)}</b>` }, { label: 'الإمارة / الموقع', render: w => `${F.esc(w.emirate || '')}<br><small>${F.esc(w.location || '')}</small>` }, { label: 'المسؤول', render: w => F.esc(w.manager || '—') },
      { label: 'الإشغال', render: w => { const pct = w.capacity ? Math.min(100, Math.round(w.used / w.capacity * 100)) : 0; return `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div><small>${F.num(w.used)} / ${F.num(w.capacity)} (${pct}%)</small>`; } },
      ...(showCost ? [{ label: 'قيمة المخزون', cls: 'amount', render: w => F.money(w.value) }] : []), { label: '', render: w => canWh ? `<button class="btn btn-outline" data-wh="${w.id}">تعديل</button>` : '' }], warehouses)}</div>`;
    const f = w => [{ name: 'name', label: 'اسم المخزن', required: true }, { name: 'emirate', label: 'الإمارة', type: 'select', options: [['', '—'], ...meta.emirates.map(e => [e, e])] }, { name: 'location', label: 'الموقع' }, { name: 'capacity', label: 'السعة (وحدات)', type: 'number' }, { name: 'manager', label: 'المسؤول' }];
    const open = w => UI.formModal({ title: w ? 'تعديل مخزن' : 'مخزن جديد', fields: f(), data: w || { capacity: 0 }, onSubmit: async d => { w ? await API.put(`/api/warehouses/${w.id}`, d) : await API.post('/api/warehouses', d); UI.toast('تم الحفظ', 'success'); render(); } });
    pane.querySelector('#addWh')?.addEventListener('click', () => open());
    UI.on(pane, 'click', '[data-wh]', el => open(warehouses.find(w => w.id === +el.dataset.wh)));
  }

  async function moves() {
    pane.innerHTML = `<div class="toolbar"><select id="mt" class="form-control" style="width:auto"><option value="">كل الحركات</option>${Object.entries(F.labels.moveType).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div class="table-container" id="list"></div>`;
    const load = async () => { const rows = await API.get('/api/stock-movements', { type: pane.querySelector('#mt').value });
      pane.querySelector('#list').innerHTML = UI.table([{ label: 'التاريخ', render: r => F.date(r.date) }, { label: 'المنتج', render: r => `${F.esc(r.product_name)}<br><small>${F.esc(r.sku || '')}</small>` }, { label: 'النوع', render: r => F.labels.moveType[r.type] },
        { label: 'الكمية', render: r => `<b style="color:${r.qty < 0 ? '#c0392b' : '#1e8449'}" class="num">${r.qty > 0 ? '+' : ''}${F.num(r.qty)}</b>` }, { label: 'المخزن', render: r => F.esc(r.warehouse_name || '—') }, { label: 'ملاحظة', render: r => F.esc(r.note || '') }, { label: 'المستخدم', render: r => F.esc(r.user_name || '—') }], rows, { empty: 'لا توجد حركات' }); };
    pane.querySelector('#mt').addEventListener('change', load); load();
  }
  render();
});
