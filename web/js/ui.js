// أدوات بناء الواجهة. كل النصوص تُضاف كنصوص لا كـ HTML لمنع حقن الشيفرات.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') {
        // الرموز (اسم بروتوكول مثل R-CHOP-21، رقم ملف) تلتف عند المسافات فقط، لا عند الشرطة
        if (/(^|\s)tag(\s|$)/.test(props.class || '') && typeof v === 'string' && /\S-\S/.test(v)) {
          for (const part of v.split(/(\s+)/)) {
            if (!part) continue;
            if (/\s/.test(part)) el.append(part);
            else el.append(Object.assign(document.createElement('span'), { className: 'w', textContent: part }));
          }
        } else el.textContent = v;
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

// replaceChildren الأصلية تكتب null نصاً؛ هنا تُتجاهل القيم الفارغة كما في h()
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...nodes) {
  return nativeReplace.apply(this, nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
};

export function mount(root, ...nodes) {
  root.replaceChildren();
  append(root, nodes);
}

// أيقونات ثابتة (نصوص موثوقة من داخل التطبيق فقط)
const PATHS = {
  drop: '<path d="M12 2.8c3.6 4.3 6.5 7.9 6.5 11.4a6.5 6.5 0 0 1-13 0c0-3.5 2.9-7.1 6.5-11.4z"/><path d="M12 11.5v5.5M9.25 14.25h5.5"/>',
  back: '<path d="M9 5l7 7-7 7"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  book: '<path d="M4 4.5h6a2 2 0 0 1 2 2V20a1.5 1.5 0 0 0-1.5-1.5H4z"/><path d="M20 4.5h-6a2 2 0 0 0-2 2V20a1.5 1.5 0 0 1 1.5-1.5H20z"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.3"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  logout: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  share: '<path d="M4 12v6.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V12"/><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  refresh: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v10.5h14V9M10 13h4"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  file: '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/>',
  pill: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.6 8.6l4.8 6.8"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16v.3"/>',
  chevron: '<path d="M14.5 6l-6 6 6 6"/>',
  move: '<path d="M4 12h14M14 7l5 5-5 5"/>',
  pharm: '<path d="M4 9.5 12 4l8 5.5"/><path d="M5.5 9v11h13V9"/><path d="M12 11v6M9 14h6"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
};

export function icon(name, size = 24, color = 'currentColor', width = 1.8) {
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  t.setAttribute('width', size); t.setAttribute('height', size);
  t.setAttribute('viewBox', '0 0 24 24'); t.setAttribute('fill', 'none');
  t.setAttribute('stroke', color); t.setAttribute('stroke-width', width);
  t.setAttribute('stroke-linecap', 'round'); t.setAttribute('stroke-linejoin', 'round');
  t.setAttribute('aria-hidden', 'true');
  t.innerHTML = PATHS[name] || '';
  return t;
}

// الأدوار
export const ROLES = {
  specialist: 'طبيب اختصاص',
  senior_resident: 'طبيب مقيم أقدم',
  intern: 'طبيب دوري',
  clinical_pharmacist: 'صيدلي سريري',
  chief_clinical_pharmacist: 'مسؤول الصيادلة السريريين',
  mixing_pharmacist: 'صيدلي المزج الكيميائي',
  internal_pharmacist: 'مسؤول الصيدلية الداخلية',
  nurse: 'ممرض',
};

// اسم الدور كما يظهر للمستخدم نفسه (الرديف يُميَّز عن مسؤول الصيادلة الأصلي)
export function roleLabel(p) {
  if (!p) return '';
  if (p.is_admin) return 'مدير النظام';
  if (p.is_deputy && (p.base_role || p.role) === 'clinical_pharmacist') {
    return p.deputy_active ? 'رديف مسؤول الصيادلة (الصلاحيات مفعّلة)' : 'صيدلي سريري · رديف (الصلاحيات موقوفة)';
  }
  return ROLES[p.base_role || p.role] || '';
}

export const ROLE_GROUPS = [
  { id: 'doc', label: 'طبيب', legend: 'نوع الطبيب', subs: [
    { role: 'specialist', desc: 'يعتمد البروتوكولات والجرعات، ويوافق على خطط مرضاه أو يرفضها، ويقرّر طلبات التعديل.' },
    { role: 'senior_resident', desc: 'يعتمد الجرعات ويعدّل الأدوية والجرعات الدوائية والتشخيص مباشرة، ويقرّر طلبات الصيادلة.' },
    { role: 'intern', desc: 'عرض فقط، دون إضافة أو تعديل أو حذف.' },
  ] },
  { id: 'pharm', label: 'صيدلاني', legend: 'نوع الصيدلاني', subs: [
    { role: 'clinical_pharmacist', desc: 'يطلب تعديل الجرعة الدوائية والمحلول والأدوية الداعمة، ويرفق صورة الطبلة.' },
    { role: 'chief_clinical_pharmacist', desc: 'ينشئ الخطط ويطلب كل أنواع التعديل، ويقرّر طلبات الصيدلي السريري، ويغلق الجرعات ويؤجلها.' },
    { role: 'mixing_pharmacist', desc: 'يستلم الجرعات المعتمدة ويحضّرها ويرسلها، ويطلب تعديل الجرعات الدوائية فقط.' },
    { role: 'internal_pharmacist', desc: 'يرفع تقرير الصيدلية الداخلية الأسبوعي (ملف إكسل) ويعدّله، ويرى بقية التطبيق عرضاً فقط.' },
  ] },
  { id: 'nurse', label: 'ممرض', legend: null, subs: [
    { role: 'nurse', desc: 'يسجّل إعطاء الجرعات الدوائية والعلامات الحيوية والتفاعلات، ويرى الأوامر المعتمدة فقط.' },
  ] },
];

// التاريخ (بقرار صاحب المشروع): كل التواريخ ميلادية بأرقام إنكليزية مع اسم اليوم، مثل «2026/11/8 - الأحد»
const LOCALE = 'ar-IQ-u-nu-latn';
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const toDate = (d) => (typeof d === 'string' && d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d));
// التاريخ بالأرقام فقط: 2026/11/8
export function fmtYMD(d) {
  if (!d) return '—';
  const x = toDate(d);
  return isNaN(x) ? '—' : `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`;
}
// المعامل الثاني القديم (خيارات الشكل) يُتجاهل: الشكل موحّد في كل التطبيق
export function fmtDate(d) {
  if (!d) return '—';
  const x = toDate(d);
  return isNaN(x) ? '—' : `${fmtYMD(x)} - ${WEEKDAYS[x.getDay()]}`;
}
export const fmtDay = fmtDate;
export function fmtTime(d) { return new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' }).format(new Date(d)); }
export function relTime(d) {
  const diff = (Date.now() - new Date(d).getTime()) / 60000;
  if (diff < 1) return 'الآن';
  if (diff < 60) return `قبل ${Math.round(diff)} دقيقة`;
  if (diff < 1440) return `قبل ${Math.round(diff / 60)} ساعة`;
  return fmtDate(d, { day: 'numeric', month: 'long' });
}
export function todayISO() {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
}
export function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// الأرقام العربية الهندية إلى لاتينية
export function latinDigits(s) {
  return String(s ?? '').replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x6F0);
}

// توحيد الكتابة العربية للبحث (مطابق للدالة ar_norm في قاعدة البيانات)
export function arNorm(s) {
  const from = 'أإآٱةىؤئ', to = 'ااااهيوي';
  return latinDigits(s).replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[أإآٱةىؤئ]/g, (c) => to[from.indexOf(c)]).toLowerCase();
}

// المعدود العربي: 1 يوم، يومان، 3 أيام، 11 يوماً
const NOUNS = {
  day: ['يوم', 'يومان', 'أيام', 'يوماً'],
  year: ['سنة', 'سنتان', 'سنوات', 'سنة'],
  month: ['شهر', 'شهران', 'أشهر', 'شهراً'],
  cycle: ['جرعة', 'جرعتان', 'جرعات', 'جرعة'],
  session: ['جلسة', 'جلستان', 'جلسات', 'جلسة'],
  patient: ['مريض', 'مريضان', 'مرضى', 'مريضاً'],
  drug: ['دواء', 'دواءان', 'أدوية', 'دواءً'],
  item: ['بند', 'بندان', 'بنود', 'بنداً'],
  request: ['طلب', 'طلبان', 'طلبات', 'طلباً'],
};
export function count(n, noun) {
  const [one, two, few, many] = NOUNS[noun];
  const m = Math.abs(n) % 100;
  if (n === 2) return two;
  if (n === 1) return `1 ${one}`;
  if (m >= 3 && m <= 10) return `${n} ${few}`;
  if (n === 0 || m === 0 || m === 1 || m === 2) return `${n} ${one}`;
  return `${n} ${many}`;
}

export function ageOf(birth) {
  if (!birth) return null;
  const b = new Date(birth + 'T00:00:00'), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}
export function ageText(birth) {
  const a = ageOf(birth);
  if (a === null) return null;
  if (a >= 1) return count(a, 'year');
  const b = new Date(birth + 'T00:00:00'), n = new Date();
  const m = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth() - (n.getDate() < b.getDate() ? 1 : 0);
  return count(Math.max(m, 0), 'month');
}

// مساحة سطح الجسم (موستيلر) بالتقريب نفسه في قاعدة البيانات
export function bsa(h, w) {
  if (!h || !w) return null;
  return Math.round(Math.sqrt((h * w) / 3600) * 100) / 100;
}

export const SEX = { male: 'ذكر', female: 'أنثى' };

export function initials(name) {
  const parts = String(name || '').replace(/^د\.\s*/, '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]).join(' ');
}

// الإشعار المنبثق
let toastTimer;
export function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// زر يعرض مؤشر انتظار أثناء العملية
export async function busy(btn, fn) {
  if (btn.disabled) return;
  const old = [...btn.childNodes];
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spinner sm', 'aria-hidden': 'true' }), ' يرجى الانتظار');
  try { return await fn(); }
  finally { btn.disabled = false; btn.replaceChildren(...old); }
}

// عناصر جاهزة
export function topbar({ title, sub, back, dark, actions }) {
  return h('header', { class: 'topbar' + (dark ? ' dark' : '') },
    back ? h('a', { class: 'icon-btn', href: back, 'aria-label': 'رجوع' }, icon('back', 24, 'currentColor', 2)) : null,
    h('div', { class: 'titles' }, h('h1', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null),
    actions || null);
}

export function notice(kind, iconName, ...content) {
  return h('div', { class: 'notice ' + kind, role: kind === 'err' ? 'alert' : null }, icon(iconName, 20), h('div', null, ...content));
}

export function field(label, input, hint) {
  if (!input.id) input.id = 'f' + Math.random().toString(36).slice(2, 8);
  return h('div', { class: 'field' }, h('label', { for: input.id, text: label }), input, hint ? h('p', { class: 'hint', text: hint }) : null);
}

export function empty(text, iconName = 'info') {
  return h('div', { class: 'empty' }, icon(iconName, 28, '#8A929C'), h('p', { text }));
}

export function bottomNav(active) {
  const items = [
    ['home', '#/home', 'home', 'الرئيسية'],
    ['patients', '#/patients', 'users', 'المرضى'],
    ['appointments', '#/appointments', 'calendar', 'المواعيد'],
    ['protocols', '#/protocols', 'book', 'البروتوكولات'],
    ['pharmacy', '#/report-pharmacy', 'pharm', 'الصيدلية'],   // الصيدلية الداخلية، لكل المستخدمين
  ];
  return h('nav', { class: 'bottom-nav', 'aria-label': 'التنقل الرئيسي' },
    items.map(([id, href, ic, label]) =>
      h('a', { href, 'aria-current': id === active ? 'page' : null }, icon(ic, 24), h('span', { text: label }))));
}

export function confirmDialog({ title, body, okText = 'تأكيد', danger = false, input }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', null);
    const inp = input ? h('textarea', { class: 'input', rows: 3, placeholder: input.placeholder || '' }) : null;
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(h('div', { class: 'dlg' },
      h('h2', { text: title }),
      body ? h('p', { text: body, style: 'color: var(--muted); line-height: 1.7' }) : null,
      inp ? field(input.label, inp) : null,
      h('div', { class: 'grid-2' },
        h('button', { type: 'button', class: 'btn secondary', onclick: () => done(null), text: 'إلغاء' }),
        h('button', { type: 'button', class: 'btn ' + (danger ? 'danger' : 'primary'),
          onclick: () => done(inp ? inp.value.trim() : true), text: okText }))));
    document.body.append(dlg);
    dlg.addEventListener('cancel', () => done(null));
    dlg.showModal();
  });
}
