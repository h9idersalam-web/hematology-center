// الرئيسية: ملخص اليوم حسب الدور، وقسم الإدارة للمدير وحده
import { sb, q, countOf } from '../api.js';
import { h, mount, icon, ROLES, fmtDay, todayISO, initials, bottomNav, empty, confirmDialog, fmtDate, daysUntil } from '../ui.js';
import { state, logout } from '../app.js';
import { can } from '../perms.js';

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'صباح الخير' : 'مساء الخير';
}

const CAN_APPROVE = ['specialist'];
const SEES_REQUESTS = ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist'];

export async function render(root) {
  const p = state.profile;
  const today = todayISO();
  const bell = h('a', { class: 'icon-btn boxed', href: '#/notifications', 'aria-label': 'الإشعارات' }, icon('bell', 24));
  const statsBox = h('section', { class: 'stats', 'aria-label': 'ملخص اليوم' }, skeletonStats());
  const todayBox = h('div', { class: 'card flush' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  const alertBox = h('div');
  const adminBox = p.is_admin ? h('div') : null;
  const deptBox = departments(p);

  const profileBtn = h('button', { class: 'icon-btn boxed', 'aria-label': 'حسابي', onclick: () => profileDialog() },
    h('span', { style: 'font-weight: 700; font-size: 14px; color: var(--brand)', text: initials(p.full_name) || '؟' }));

  mount(root, h('div', { class: 'screen' },
    h('main', { class: 'main with-nav' },
      h('header', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 12px' },
        h('div', { style: 'display: flex; flex-direction: column; gap: 2px; min-width: 0' },
          h('p', { style: 'font-size: 14px; color: var(--muted-2)', text: fmtDay(today) }),
          h('h1', { style: 'font-size: 26px; font-weight: 700', text: greeting() }),
          h('span', { class: 'pill ' + (p.is_admin ? 'dark' : 'brand'), style: 'align-self: flex-start; margin-top: 4px',
            text: (p.is_admin ? 'مدير النظام · ' : '') + ROLES[p.role] })),
        h('div', { style: 'display: flex; gap: 8px' }, bell, profileBtn)),
      p.role === 'intern' ? h('div', { class: 'notice info' }, icon('info', 20), h('p', { text: 'حسابك للعرض فقط، دون إضافة أو تعديل.' })) : null,
      deptBox,
      statsBox,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'جلسات اليوم' }),
          h('a', { href: '#/appointments', style: 'font-size: 15px; font-weight: 600; text-decoration: none', text: 'عرض الكل' })),
        todayBox),
      alertBox,
      adminBox),
    bottomNav('home')));

  // الإشعارات غير المقروءة
  countOf('notifications', (x) => x.is('read_at', null)).then((n) => {
    if (n > 0) { bell.append(h('span', { class: 'badge-dot', text: n > 99 ? '99+' : n })); bell.setAttribute('aria-label', `الإشعارات، ${n} غير مقروءة`); }
  }).catch(() => {});

  // الأرقام
  try {
    const [todayN, overdueN, reqN, patientsN] = await Promise.all([
      countOf('cycles', (x) => x.eq('planned_date', today).in('status', ['planned', 'held'])),
      countOf('cycles', (x) => x.lt('planned_date', today).eq('status', 'planned')),
      SEES_REQUESTS.includes(p.role) ? countOf('change_requests', (x) => x.eq('status', 'pending')) : Promise.resolve(null),
      countOf('patients', (x) => x.is('archived_at', null)),
    ]);
    statsBox.replaceChildren(
      stat('brand', todayN, 'جلسة اليوم', '#/appointments'),
      stat('warn', overdueN, 'جلسات متأخرة', '#/appointments'),
      reqN === null ? stat('info', '—', 'طلبات التعديل', null)
        : stat('info', reqN, CAN_APPROVE.includes(p.role) ? 'بانتظار موافقتك' : 'طلبات تعديل معلّقة', '#/requests'),
      stat('plain', patientsN, 'مريضاً مسجّلاً', '#/patients'));
    if (overdueN > 0) {
      alertBox.replaceChildren(h('a', { href: '#/appointments', class: 'notice warn', style: 'text-decoration: none; align-items: center' },
        icon('warn', 22), h('span', { style: 'flex: 1; font-weight: 600', text: `${overdueN} جلسة تجاوزت موعدها` }),
        h('span', { style: 'font-weight: 700', text: 'مراجعة' })));
    }
  } catch (e) {
    statsBox.replaceChildren(h('div', { class: 'notice err', style: 'grid-column: 1 / -1' }, icon('warn', 20), h('p', { text: e.message })));
  }

  // جلسات اليوم
  try {
    const rows = await q(sb.from('cycles')
      .select('id, cycle_no, status, doctor_approved_at, pharmacist_verified_at, treatments!inner(protocol_name, total_cycles, status, patients!inner(id, full_name))')
      .eq('planned_date', today).in('status', ['planned', 'held']).eq('treatments.status', 'active')
      .order('cycle_no').limit(30));
    todayBox.replaceChildren(...(rows.length ? rows.map(cycleRow) : [empty('لا توجد جلسات مجدولة اليوم', 'calendar')]));
  } catch (e) {
    todayBox.replaceChildren(h('div', { class: 'notice err', style: 'margin: 12px' }, icon('warn', 20), h('p', { text: e.message })));
  }

  if (adminBox) renderAdminPanel(adminBox);
}

// اختصارات الأقسام حسب الدور: المزج والتمريض والطلبات
function departments(p) {
  const tiles = [];
  if (can('seeMixing')) tiles.push(['#/mixing', 'pill', 'قسم المزج', 'mix']);
  if (can('seeNursing')) tiles.push(['#/nursing', 'check', 'الإعطاء اليوم', 'nurse']);
  if (can('seeRequests')) tiles.push(['#/requests', 'edit', 'طلبات التعديل', 'req']);
  if (!tiles.length) return null;
  const box = h('div', { class: 'dept' }, tiles.map(([href, ic, label, key]) => h('a', { href, class: 'dept-t', 'data-k': key }, icon(ic, 24), h('span', { text: label }))));
  // عدد الطلبات الواردة للمزج
  if (can('seeMixing')) countOf('mixing_orders', (x) => x.in('status', ['incoming', 'in_progress', 'partially_sent'])).then((n) => {
    if (n) box.querySelector('[data-k="mix"]').append(h('span', { class: 'count', text: n }));
  }).catch(() => {});
  return box;
}

function skeletonStats() {
  return ['brand', 'warn', 'info', 'plain'].map((k) => h('div', { class: 'stat ' + k, style: 'opacity: .55' },
    h('span', { class: 'n', text: '·' }), h('span', { class: 'l', text: 'جارٍ التحميل' })));
}

function stat(kind, n, label, href) {
  return h(href ? 'a' : 'div', { class: 'stat ' + kind, href },
    h('span', { class: 'n', text: n }), h('span', { class: 'l', text: label }));
}

function cycleRow(c) {
  const t = c.treatments; const pt = t.patients;
  let pill;
  if (c.status === 'held') pill = h('span', { class: 'pill warn', text: 'موقوفة' });
  else if (c.pharmacist_verified_at) pill = h('span', { class: 'pill ok', text: 'جاهزة' });
  else if (c.doctor_approved_at) pill = h('span', { class: 'pill info', text: 'بانتظار الصيدلاني' });
  else pill = h('span', { class: 'pill muted', text: 'بانتظار اعتماد الطبيب' });
  return h('a', { class: 'row', href: '#/cycle?id=' + c.id },
    h('span', { class: 'avatar', text: initials(pt.full_name) }),
    h('span', { class: 'grow' },
      h('span', { class: 't', text: pt.full_name }),
      h('span', { class: 's', style: 'display: flex; gap: 8px; align-items: center' },
        h('span', { class: 'tag', text: t.protocol_name }), h('span', { text: `الدورة ${c.cycle_no} من ${t.total_cycles}` }))),
    pill);
}

async function renderAdminPanel(box) {
  const soon = new Date(); soon.setDate(soon.getDate() + 14);
  const soonISO = soon.toISOString().slice(0, 10);
  let pending = 0, total = 0, expiring = 0;
  try {
    [pending, total, expiring] = await Promise.all([
      countOf('profiles', (x) => x.eq('status', 'pending')),
      countOf('profiles', (x) => x.eq('status', 'active')),
      countOf('profiles', (x) => x.eq('status', 'active').not('subscription_ends', 'is', null).lte('subscription_ends', soonISO)),
    ]);
  } catch (e) { /* تبقى الأرقام صفراً */ }

  const tile = (href, t, s, warn, brand) => h('a', { class: 'admin-tile' + (brand ? ' brand' : ''), href },
    h('span', { class: 't', text: t }), h('span', { class: 's' + (warn ? ' warn' : ''), text: s }));

  box.replaceChildren(h('section', { class: 'admin-panel', 'aria-label': 'الإدارة' },
    h('div', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px' },
      h('h2', null, icon('shield', 22), h('span', { text: 'الإدارة' })),
      h('span', { class: 'pill', style: 'background: var(--dark-3); font-size: 12px', text: 'تظهر لك وحدك' })),
    h('div', { class: 'grid-2' },
      tile('#/admin?tab=users', 'إدارة المستخدمين', pending ? `${pending} بانتظار التفعيل` : `${total} مستخدماً مفعّلاً`, pending > 0),
      tile('#/admin?tab=permissions', 'الصلاحيات', '7 أنواع مستخدمين'),
      tile('#/admin?tab=subscriptions', 'الاشتراكات', expiring ? `${expiring} تنتهي خلال أسبوعين` : 'كلها سارية', expiring > 0),
      tile('#/admin?tab=users', 'كود تفعيل', 'يُصدر لكل مستخدم من إدارة المستخدمين', false, true))));
}

async function profileDialog() {
  const p = state.profile;
  const left = daysUntil(p.subscription_ends);
  const ok = await confirmDialog({
    title: p.full_name,
    body: `${ROLES[p.role]}${p.is_admin ? ' · مدير النظام' : ''}. ` +
      (p.subscription_ends ? `الاشتراك حتى ${fmtDate(p.subscription_ends)}${left !== null && left <= 14 ? ` (باقٍ ${left} يوماً)` : ''}.` : 'اشتراك دائم.'),
    okText: 'تسجيل الخروج', danger: true,
  });
  if (ok) logout();
}
