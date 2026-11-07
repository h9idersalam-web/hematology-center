// الرئيسية: ملخص اليوم حسب الدور، وقسم الإدارة للمدير وحده
import { sb, q, countOf, rpc } from '../api.js';
import { h, mount, icon, roleLabel, ROLES, ROLE_GROUPS, fmtDay, todayISO, initials, bottomNav, empty, confirmDialog, fmtDate, daysUntil, toast, busy } from '../ui.js';
import { state, logout, loadProfile } from '../app.js';
import { can } from '../perms.js';
import { APP_NAME } from '../config.js';
import { soundAsked, enableSound, disableSound } from '../notify.js';
import { installButton } from '../install.js';

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'صباح الخير' : 'مساء الخير';
}

const CAN_APPROVE = ['specialist', 'senior_resident', 'chief_clinical_pharmacist'];
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
  const chartBox = can('chart') ? h('div') : null;
  const deputyBox = can('toggleDeputy') ? h('div') : null;

  const profileBtn = h('button', { class: 'icon-btn boxed', 'aria-label': 'حسابي', onclick: () => profileDialog() },
    h('span', { style: 'font-weight: 700; font-size: 14px; color: var(--brand)', text: initials(p.full_name) || '؟' }));

  mount(root, h('div', { class: 'screen' },
    h('main', { class: 'main with-nav' },
      // اسم التطبيق في أعلى الواجهة
      h('div', { class: 'app-brand' }, h('span', { class: 'app-brand-logo' }, icon('drop', 18, '#fff')), h('span', { class: 'app-brand-name', text: APP_NAME }), installButton('light')),
      h('header', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 12px' },
        h('div', { style: 'display: flex; flex-direction: column; gap: 2px; min-width: 0' },
          h('p', { style: 'font-size: 14px; color: var(--muted-2)', text: fmtDay(today) }),
          h('h1', { style: 'font-size: 26px; font-weight: 700', text: greeting() }),
          h('span', { style: 'display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px' },
            h('span', { class: 'pill ' + (p.is_admin ? 'dark' : 'brand'), text: roleLabel(p) }),
            p.is_admin ? h('button', { type: 'button', class: 'pill brand role-switch', 'aria-label': 'تغيير دور العمل',
              onclick: () => roleSwitcher(root) }, icon('refresh', 14, 'currentColor', 2.4), h('span', { text: 'أعمل بدور: ' + ROLES[p.role] })) : null)),
        h('div', { style: 'display: flex; gap: 8px' }, bell, profileBtn)),
      p.role === 'intern' ? h('div', { class: 'notice info' }, icon('info', 20), h('p', { text: 'حسابك للعرض فقط، دون إضافة أو تعديل.' })) : null,
      soundCard(),
      deptBox,
      chartBox,
      statsBox,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'جلسات اليوم' }),
          h('a', { href: '#/appointments', style: 'font-size: 15px; font-weight: 600; text-decoration: none', text: 'عرض الكل' })),
        todayBox),
      alertBox,
      deputyBox,
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
      .select('id, cycle_no, status, doctor_approved_at, treatments!inner(protocol_name, total_cycles, status, patients!inner(id, full_name))')
      .eq('planned_date', today).in('status', ['planned', 'held']).eq('treatments.status', 'active')
      .order('cycle_no').limit(30));
    todayBox.replaceChildren(...(rows.length ? rows.map(cycleRow) : [empty('لا توجد جلسات مجدولة اليوم', 'calendar')]));
  } catch (e) {
    todayBox.replaceChildren(h('div', { class: 'notice err', style: 'margin: 12px' }, icon('warn', 20), h('p', { text: e.message })));
  }

  if (adminBox) renderAdminPanel(adminBox);
  if (chartBox) renderChartTasks(chartBox);
  if (deputyBox) renderDeputies(deputyBox);
}

// يُعرض مرة واحدة على كل جهاز: تفعيل التنبيه بالصوت يحتاج ضغطة من المستخدم (شرط الهاتف)
function soundCard() {
  if (soundAsked()) return null;
  const box = h('div', { class: 'notice info', style: 'align-items: center; flex-wrap: wrap' },
    icon('bell', 22),
    h('span', { style: 'flex: 1; min-width: 180px', text: 'فعّل التنبيه بالصوت لتسمع نغمة عند وصول إشعار جديد أثناء فتح التطبيق.' }),
    h('span', { style: 'display: flex; gap: 6px' },
      h('button', { type: 'button', class: 'btn sm primary', text: 'تفعيل', onclick: async () => {
        const perm = await enableSound();
        toast(perm === 'denied' ? 'فُعّل الصوت، لكن إشعارات الهاتف ممنوعة من إعدادات المتصفح' : 'فُعّل التنبيه بالصوت');
        box.remove();
      } }),
      h('button', { type: 'button', class: 'btn sm secondary', text: 'لاحقاً', onclick: () => { disableSound(); box.remove(); } })));
  return box;
}

// مهمة الصيدلي: دورات اعتمدها الطبيب ولم تُرفق صورة طبلتها بعد
async function renderChartTasks(box) {
  try {
    const rows = await q(sb.from('cycles')
      .select('id, cycle_no, planned_date, treatments!inner(protocol_name, status, patients!inner(full_name, archived_at))')
      .not('doctor_approved_at', 'is', null).is('chart_attachment_id', null).in('status', ['planned', 'held'])
      .eq('treatments.status', 'active').is('treatments.patients.archived_at', null)
      .order('planned_date').limit(20));
    if (!rows.length) return box.replaceChildren();
    box.replaceChildren(h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { text: 'بانتظار صورة الطبلة منك' }), h('span', { class: 'count', text: rows.length })),
      h('div', { class: 'card flush' }, rows.map((c) => h('a', { class: 'row', href: '#/cycle?id=' + c.id },
        h('span', { class: 'avatar', text: initials(c.treatments.patients.full_name) }),
        h('span', { class: 'grow' }, h('span', { class: 't', text: c.treatments.patients.full_name }),
          h('span', { class: 's', style: 'display: flex; gap: 6px; flex-wrap: wrap; align-items: center' },
            h('span', { class: 'tag', text: c.treatments.protocol_name }),
            h('span', { text: `الجرعة ${c.cycle_no} · ${fmtDate(c.planned_date, { day: 'numeric', month: 'short' })}` }))),
        h('span', { class: 'pill warn', text: 'أرفق الصورة' }))))));
  } catch (e) { box.replaceChildren(); }
}

// مسؤول الصيادلة يفعّل صلاحيات رديفه أو يوقفها
async function renderDeputies(box) {
  let rows = [];
  try { rows = await q(sb.from('profiles').select('id, full_name, deputy_active, deputy_changed_at').eq('is_deputy', true).eq('role', 'clinical_pharmacist').eq('status', 'active').order('full_name')); }
  catch (e) { return; }
  if (!rows.length) return box.replaceChildren();
  box.replaceChildren(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { text: 'رديف مسؤول الصيادلة' })),
    h('p', { class: 'hint', text: 'حين تفعّل صلاحياته يعمل بكل صلاحياتك. حين توقفها يعود صيدلياً سريرياً.' }),
    h('div', { class: 'card flush' }, rows.map((u) => {
      const b = h('button', { type: 'button', class: 'btn sm ' + (u.deputy_active ? 'danger' : 'ok'), text: u.deputy_active ? 'إيقاف الصلاحيات' : 'تفعيل الصلاحيات' });
      b.addEventListener('click', () => busy(b, async () => {
        const on = !u.deputy_active;
        const ok = await confirmDialog({ title: (on ? 'تفعيل صلاحيات ' : 'إيقاف صلاحيات ') + u.full_name,
          body: on ? 'يحصل على كل صلاحيات مسؤول الصيادلة حتى توقفها، ويُبلَّغ بذلك.' : 'يعود صيدلياً سريرياً بصلاحياته المعتادة، ويُبلَّغ بذلك.',
          okText: on ? 'تفعيل' : 'إيقاف', danger: !on });
        if (!ok) return;
        try { await rpc('chief_set_deputy_active', { p_user: u.id, p_active: on }); toast(on ? 'فُعّلت صلاحيات الرديف' : 'أُوقفت صلاحيات الرديف'); renderDeputies(box); }
        catch (e) { toast(e.message, true); }
      }));
      return h('div', { class: 'row' },
        h('span', { class: 'avatar', text: initials(u.full_name) }),
        h('span', { class: 'grow' }, h('span', { class: 't', text: u.full_name }),
          h('span', { class: 's', text: u.deputy_active ? 'الصلاحيات مفعّلة' : 'الصلاحيات موقوفة' })),
        b);
    }))));
}

// اختصارات الأقسام حسب الدور: المزج والتمريض والطلبات
function departments(p) {
  const tiles = [];
  if (can('seeMixing')) tiles.push(['#/mixing', 'pill', 'قسم المزج', 'mix']);
  if (can('seeNursing')) tiles.push(['#/nursing', 'check', 'الإعطاء اليوم', 'nurse']);
  if (can('seeRequests')) tiles.push(['#/requests', 'edit', 'طلبات التعديل', 'req']);
  if (!tiles.length) return null;
  const box = h('div', { class: 'dept' }, tiles.map(([href, ic, label, key]) => h('a', { href, class: 'dept-t', 'data-k': key }, icon(ic, 24), h('span', { text: label }))));
  // عدد طلبات المزج المستحقة اليوم ولم تُرسل
  if (can('seeMixing')) {
    const today = todayISO();
    q(sb.from('mixing_orders').select('day, cycles!inner(planned_date, status)').in('status', ['incoming', 'in_progress', 'partially_sent'])
      .in('cycles.status', ['planned', 'held']).lte('cycles.planned_date', today)).then((rows) => {
      const n = rows.filter((r) => { const d = new Date(r.cycles.planned_date + 'T00:00:00'); d.setDate(d.getDate() + r.day - 1); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) === today; }).length;
      if (n) box.querySelector('[data-k="mix"]').append(h('span', { class: 'count', text: n, title: 'جرعات دوائية اليوم' }));
    }).catch(() => {});
  }
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
  else if (c.doctor_approved_at) pill = h('span', { class: 'pill ok', text: 'في المزج' });
  else pill = h('span', { class: 'pill muted', text: 'بانتظار اعتماد الطبيب' });
  return h('a', { class: 'row', href: '#/cycle?id=' + c.id },
    h('span', { class: 'avatar', text: initials(pt.full_name) }),
    h('span', { class: 'grow' },
      h('span', { class: 't', text: pt.full_name }),
      h('span', { class: 's', style: 'display: flex; gap: 8px; align-items: center' },
        h('span', { class: 'tag', text: t.protocol_name }), h('span', { text: `الجرعة ${c.cycle_no} من ${t.total_cycles}` }))),
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

// المدير يختار الدور الذي يعمل به: يرى أقسامه ويعمل بصلاحياته الحقيقية، ويبقى مديراً
function roleSwitcher(root) {
  const p = state.profile;
  const dlg = h('dialog', null);
  const close = () => { dlg.close(); dlg.remove(); };
  const desc = Object.fromEntries(ROLE_GROUPS.flatMap((g) => g.subs.map((x) => [x.role, x.desc])));
  dlg.append(h('div', { class: 'dlg' },
    h('h2', { text: 'الدور الذي تعمل به' }),
    h('p', { style: 'color: var(--muted); font-size: 14px', text: 'تدخل أقسام الدور المختار وتعمل بصلاحياته، ويُسجَّل كل إجراء باسمك وبهذا الدور. تبقى مديراً في كل الأحوال.' }),
    h('div', { style: 'display: flex; flex-direction: column; gap: 6px' }, Object.entries(ROLES).map(([k, label]) =>
      h('button', { type: 'button', class: 'option', 'aria-pressed': p.role === k ? 'true' : 'false', onclick: async (e) => {
        await busy(e.currentTarget, async () => {
          try {
            await rpc('admin_set_acting_role', { p_role: k });
            await loadProfile();
            close(); toast('تعمل الآن بدور ' + label); render(root);
          } catch (err) { toast(err.message, true); }
        });
      } }, h('span', null, h('span', { class: 'ot', text: label + (p.base_role === k ? ' (دورك المسجّل)' : '') }), h('span', { class: 'od', text: desc[k] || '' }))))),
    h('button', { class: 'link-btn', text: 'إغلاق', onclick: close })));
  document.body.append(dlg);
  dlg.addEventListener('cancel', close);
  dlg.showModal();
}

async function profileDialog() {
  const p = state.profile;
  const left = daysUntil(p.subscription_ends);
  const ok = await confirmDialog({
    title: p.full_name,
    body: `${roleLabel(p)}${p.is_admin ? ' · يعمل الآن بدور ' + ROLES[p.role] : ''}. ` +
      (p.subscription_ends ? `الاشتراك حتى ${fmtDate(p.subscription_ends)}${left !== null && left <= 14 ? ` (باقٍ ${left} يوماً)` : ''}.` : 'اشتراك دائم.'),
    okText: 'تسجيل الخروج', danger: true,
  });
  if (ok) logout();
}
