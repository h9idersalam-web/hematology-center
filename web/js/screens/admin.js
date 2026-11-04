// الإدارة: المستخدمون، أكواد التفعيل، الاشتراكات، الصلاحيات (للمدير وحده)
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, empty, ROLES, fmtDate, daysUntil, toast, busy, field, notice, initials } from '../ui.js';
import { state, go } from '../app.js';

const STATUS = { pending: ['بانتظار التفعيل', 'warn'], active: ['مفعّل', 'ok'], suspended: ['موقوف', 'muted'] };
const MONTHS = [3, 6, 12];

export async function render(root, params) {
  let tab = params.get('tab') || 'users';
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('main', { class: 'main' });
  const stats = h('div', { class: 'mini-stats', style: 'padding: 0 20px' });

  mount(root, h('div', { class: 'screen' },
    h('div', { style: 'background: var(--dark); color: #fff; padding-bottom: 16px; display: flex; flex-direction: column; gap: 12px' },
      topbar({ title: 'الإدارة', sub: 'مدير النظام فقط', back: '#/home', dark: true }),
      stats),
    tabs, body));

  const TABS = [['users', 'المستخدمون'], ['codes', 'الأكواد'], ['subscriptions', 'الاشتراكات'], ['permissions', 'الصلاحيات']];
  function drawTabs() {
    tabs.replaceChildren(...TABS.map(([id, label]) => h('button', {
      role: 'tab', 'aria-selected': tab === id ? 'true' : 'false',
      onclick: () => { tab = id; history.replaceState(null, '', '#/admin?tab=' + id); drawTabs(); draw(); },
    }, label)));
  }

  let users = [];
  async function loadUsers() {
    users = await q(sb.from('profiles').select('*').order('created_at', { ascending: false }));
    const soon = users.filter((u) => u.status === 'active' && u.subscription_ends && daysUntil(u.subscription_ends) <= 14).length;
    stats.replaceChildren(
      miniStat(users.filter((u) => u.status === 'active').length, 'مستخدم مفعّل'),
      miniStat(users.filter((u) => u.status === 'pending').length, 'بانتظار التفعيل', true),
      miniStat(soon, 'اشتراك ينتهي قريباً', true));
  }

  async function draw() {
    body.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    try {
      if (tab === 'users') await drawUsers();
      else if (tab === 'codes') await drawCodes();
      else if (tab === 'subscriptions') await drawSubscriptions();
      else drawPermissions();
    } catch (e) {
      body.replaceChildren(notice('err', 'warn', h('p', { text: e.message })));
    }
  }

  // ------------------------------------------------------------ المستخدمون
  async function drawUsers() {
    await loadUsers();
    const pending = users.filter((u) => u.status === 'pending');
    const others = users.filter((u) => u.status !== 'pending');
    body.replaceChildren(
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'بانتظار التفعيل' }), h('span', { class: 'meta', text: `${pending.length}` })),
        h('div', { class: 'card flush' }, pending.length ? pending.map(pendingRow) : empty('لا توجد طلبات جديدة', 'check'))),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'كل المستخدمين' }), h('span', { class: 'meta', text: `${others.length}` })),
        h('div', { class: 'card flush' }, others.length ? others.map(userRow) : empty('لا يوجد مستخدمون بعد', 'users'))));
  }

  function pendingRow(u) {
    return h('div', { class: 'row' },
      h('span', { class: 'avatar', text: initials(u.full_name) }),
      h('span', { class: 'grow' },
        h('span', { class: 't', text: u.full_name }),
        h('span', { class: 's', text: ROLES[u.role] }),
        u.email ? h('span', { class: 's ltr', style: 'text-align: right; font-size: 13px', text: u.email }) : null),
      h('button', { class: 'btn primary sm', text: 'إرسال كود', onclick: () => codeForUser(u) }),
      h('button', { class: 'icon-btn boxed', style: 'width: 44px; height: 44px', 'aria-label': 'رفض طلب ' + u.full_name,
        onclick: async () => { await updateUser(u, { p_status: 'suspended' }, 'رُفض الطلب'); } }, icon('x', 18, 'currentColor', 2)));
  }

  function userRow(u) {
    const [label, tone] = STATUS[u.status];
    const left = daysUntil(u.subscription_ends);
    return h('button', { class: 'row', onclick: () => userDialog(u) },
      h('span', { class: 'avatar', text: initials(u.full_name) }),
      h('span', { class: 'grow' },
        h('span', { class: 't', text: u.full_name + (u.is_admin ? ' · المدير' : '') }),
        h('span', { class: 's', text: ROLES[u.role] + (u.role === 'intern' ? ' · عرض فقط' : '') })),
      u.status !== 'active' ? h('span', { class: 'pill ' + tone, text: label })
        : u.is_admin || !u.subscription_ends ? h('span', { class: 'pill ok', text: 'دائم' })
          : h('span', { class: 'pill ' + (left <= 14 ? 'warn' : 'ok'), text: left < 0 ? 'منتهٍ' : 'حتى ' + fmtDate(u.subscription_ends, { month: 'short', year: 'numeric' }) }));
  }

  async function updateUser(u, params, msg) {
    try { await rpc('admin_update_user', { p_user: u.id, ...params }); toast(msg); draw(); }
    catch (e) { toast(e.message, true); }
  }

  // نافذة إدارة مستخدم: التخصص، الإيقاف، التمديد
  function userDialog(u) {
    const dlg = h('dialog', null);
    const close = () => { dlg.close(); dlg.remove(); };
    const roleSel = h('select', { class: 'input' }, Object.entries(ROLES).map(([k, v]) => h('option', { value: k, selected: k === u.role, text: v })));
    const isSelf = u.id === state.profile.id;
    dlg.append(h('div', { class: 'dlg' },
      h('h2', { text: u.full_name }),
      h('p', { style: 'color: var(--muted)', text: [u.email, u.phone].filter(Boolean).join(' · ') || '—' }),
      h('p', { style: 'font-size: 15px', text: u.is_admin || !u.subscription_ends ? 'اشتراك دائم' : `الاشتراك حتى ${fmtDate(u.subscription_ends)}` }),
      field('التخصص', roleSel),
      h('button', { class: 'btn secondary', text: 'حفظ التخصص', onclick: async (e) => {
        await busy(e.currentTarget, () => updateUser(u, { p_role: roleSel.value }, 'حُدّث التخصص')); close();
      } }),
      u.is_admin ? null : h('div', { class: 'field' }, h('span', { class: 'label', text: 'تمديد الاشتراك' }),
        h('div', { class: 'grid-3' }, MONTHS.map((m) => h('button', { class: 'btn secondary sm', text: m === 12 ? 'سنة' : `${m} أشهر`,
          onclick: async (e) => {
            await busy(e.currentTarget, async () => {
              try { const until = await rpc('admin_extend_subscription', { p_user: u.id, p_months: m }); toast('مُدّد حتى ' + fmtDate(until)); draw(); close(); }
              catch (err) { toast(err.message, true); }
            });
          } })))),
      isSelf ? null : u.status === 'suspended'
        ? h('button', { class: 'btn ok', text: 'إعادة التفعيل', onclick: async () => { await updateUser(u, { p_status: 'active' }, 'أُعيد تفعيل الحساب'); close(); } })
        : h('button', { class: 'btn danger', text: 'إيقاف الحساب', onclick: async () => { await updateUser(u, { p_status: 'suspended' }, 'أُوقف الحساب'); close(); } }),
      h('button', { class: 'link-btn', text: 'إغلاق', onclick: close })));
    document.body.append(dlg);
    dlg.addEventListener('cancel', close);
    dlg.showModal();
  }

  // إنشاء كود لمستخدم ينتظر
  function codeForUser(u) {
    const dlg = h('dialog', null);
    const close = () => { dlg.close(); dlg.remove(); };
    let months = 6;
    const seg = h('div', { class: 'segmented' });
    const drawSeg = () => seg.replaceChildren(...MONTHS.map((m) => h('button', { type: 'button', 'aria-pressed': m === months ? 'true' : 'false',
      text: m === 12 ? 'سنة' : `${m} أشهر`, onclick: () => { months = m; drawSeg(); } })));
    drawSeg();
    const out = h('div');
    const monthsLabel = h('span', { class: 'label', style: 'font-weight: 600', text: 'مدة الاشتراك' });
    const make = h('button', { class: 'btn primary', text: 'إنشاء الكود', onclick: async () => {
      await busy(make, async () => {
        try {
          const code = await rpc('admin_create_code', { p_role: u.role, p_months: months });
          make.remove(); seg.remove();
          monthsLabel.textContent = 'مدة الاشتراك: ' + (months === 12 ? 'سنة' : `${months} أشهر`);
          out.replaceChildren(codeBox(code, u.role, months, u.phone));
          draw();
        } catch (e) { toast(e.message, true); }
      });
    } });
    dlg.append(h('div', { class: 'dlg' },
      h('h2', { text: 'كود تفعيل لـ ' + u.full_name }),
      h('p', { style: 'color: var(--muted)', text: ROLES[u.role] }),
      monthsLabel,
      seg, make, out,
      h('button', { class: 'link-btn', text: 'إغلاق', onclick: close })));
    document.body.append(dlg);
    dlg.addEventListener('cancel', close);
    dlg.showModal();
  }

  // ------------------------------------------------------------ الأكواد
  async function drawCodes() {
    const roleSel = h('select', { class: 'input' }, Object.entries(ROLES).map(([k, v]) => h('option', { value: k, text: v })));
    let months = 6;
    const seg = h('div', { class: 'segmented' });
    const drawSeg = () => seg.replaceChildren(...MONTHS.map((m) => h('button', { type: 'button', 'aria-pressed': m === months ? 'true' : 'false',
      text: m === 12 ? 'سنة' : `${m} أشهر`, onclick: () => { months = m; drawSeg(); } })));
    drawSeg();
    const out = h('div');
    const make = h('button', { class: 'btn primary', text: 'إنشاء الكود', onclick: async () => {
      await busy(make, async () => {
        try {
          const code = await rpc('admin_create_code', { p_role: roleSel.value, p_months: months });
          out.replaceChildren(codeBox(code, roleSel.value, months));
          loadList();
        } catch (e) { toast(e.message, true); }
      });
    } });
    const list = h('div', { class: 'card flush' });

    async function loadList() {
      const codes = await q(sb.from('activation_codes').select('*, used:used_by(full_name)').order('created_at', { ascending: false }).limit(50));
      list.replaceChildren(...(codes.length ? codes.map(codeRow) : [empty('لم تُنشأ أكواد بعد', 'key')]));
    }
    function codeRow(c) {
      let pill;
      if (c.used_by) pill = h('span', { class: 'pill ok', text: 'استُخدم' });
      else if (c.revoked) pill = h('span', { class: 'pill muted', text: 'ملغى' });
      else if (new Date(c.expires_at) < new Date()) pill = h('span', { class: 'pill muted', text: 'منتهي' });
      else pill = h('button', { class: 'btn danger sm', style: 'height: 36px; font-size: 13px', text: 'إلغاء', onclick: async () => {
        try { await rpc('admin_revoke_code', { p_code: c.code }); toast('أُلغي الكود'); loadList(); } catch (e) { toast(e.message, true); }
      } });
      return h('div', { class: 'row' },
        h('span', { class: 'grow' },
          h('span', { class: 't ltr', style: 'text-align: right; letter-spacing: 2px', text: c.code }),
          h('span', { class: 's', text: `${ROLES[c.role]} · ${c.months} أشهر` + (c.used ? ` · ${c.used.full_name}` : '') })),
        pill);
    }

    body.replaceChildren(
      h('section', { class: 'card' },
        h('h2', { text: 'إنشاء كود تفعيل' }),
        field('التخصص', roleSel),
        h('span', { class: 'label', style: 'font-weight: 600; font-size: 15px', text: 'مدة الاشتراك' }), seg,
        make, out),
      h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { text: 'آخر الأكواد' })), list));
    await loadList();
  }

  // ------------------------------------------------------------ الاشتراكات
  async function drawSubscriptions() {
    await loadUsers();
    const active = users.filter((u) => u.status === 'active' && !u.is_admin)
      .sort((a, b) => String(a.subscription_ends || '9999').localeCompare(String(b.subscription_ends || '9999')));
    body.replaceChildren(
      notice('info', 'info', h('p', { text: 'مرتّبة من الأقرب انتهاءً. اضغط على أي مستخدم لتمديد اشتراكه.' })),
      h('div', { class: 'card flush' }, active.length ? active.map((u) => {
        const left = daysUntil(u.subscription_ends);
        return h('button', { class: 'row', onclick: () => userDialog(u) },
          h('span', { class: 'grow' }, h('span', { class: 't', text: u.full_name }), h('span', { class: 's', text: ROLES[u.role] })),
          h('span', { class: 'pill ' + (left === null ? 'ok' : left < 0 ? 'brand' : left <= 14 ? 'warn' : 'ok'),
            text: left === null ? 'دائم' : left < 0 ? 'منتهٍ' : left <= 14 ? `باقٍ ${left} يوماً` : 'حتى ' + fmtDate(u.subscription_ends) }));
      }) : empty('لا توجد اشتراكات مفعّلة بعد', 'calendar')));
  }

  // ------------------------------------------------------------ الصلاحيات
  function drawPermissions() {
    const Y = (t) => h('span', { class: 'y', text: '✓ ' + t });
    const N = (t) => h('span', { class: 'n', text: '✗ ' + t });
    const P = () => h('span', { class: 'p', text: 'محدود' });
    const card = (title, grid, lines) => h('article', { class: 'card' },
      h('h3', { style: 'font-size: 17px; font-weight: 700', text: title }),
      h('div', { class: 'perm-grid' }, grid),
      lines.map(([k, v, warn]) => h('p', { style: 'font-size: 14px; line-height: 1.7' + (warn ? '; color: var(--warn)' : '') }, h('strong', { text: k + ': ' }), v)));
    const groupTitle = (t) => h('h2', { style: 'font-size: 15px; font-weight: 700; color: var(--muted-2); margin-top: 6px', text: t });
    body.replaceChildren(
      notice('info', 'info', h('p', { text: 'الحذف في كل الأنواع أرشفة مع السبب، ويبقى في سجل التعديلات. هذه الصلاحيات مفروضة من قاعدة البيانات نفسها.' })),
      groupTitle('الأطباء'),
      card('طبيب اختصاص', [Y('عرض'), Y('إضافة'), Y('تعديل'), Y('أرشفة')], [['القرار', 'يوافق على تعديلات الصيادلة أو يرفضها، ويعتمد البروتوكولات'], ['تنبيهاته', 'طلبات الموافقة، والتحاليل خارج المرجع']]),
      card('طبيب مقيم أقدم', [Y('عرض'), Y('إضافة'), Y('تعديل'), N('أرشفة')], [['يعدّل', 'الأدوية والجرع والتشخيص ونوع البروتوكول'], ['التطبيق', 'مباشر، ويُبلَّغ الطبيب المختص']]),
      card('طبيب دوري', [Y('عرض'), N('إضافة'), N('تعديل'), N('أرشفة')], [['الصلاحية', 'عرض فقط']]),
      groupTitle('الصيادلة'),
      card('مسؤول الصيادلة السريريين', [Y('عرض'), Y('إضافة'), Y('تعديل'), N('أرشفة')], [['يعدّل', 'مثل الطبيب المقيم الأقدم'], ['الموافقة', 'لا تُطبَّق قبل موافقة الطبيب المختص على التقرير', true], ['إضافةً لذلك', 'يحوّل الجرع إلى المزج مع صورتين']]),
      card('صيدلي سريري', [Y('عرض'), P(), P(), N('أرشفة')], [['يعدّل فقط', 'الجرعة حسب الكلية والكبد، وتقريب الجرعة، والأدوية الداعمة، والمحلول ومعدل التسريب'], ['الموافقة', 'لا تُطبَّق قبل موافقة الطبيب المختص على التقرير', true], ['إضافةً لذلك', 'يحوّل الجرع إلى المزج مع صورتين']]),
      card('صيدلي المزج الكيميائي', [Y('عرض'), Y('إضافة'), Y('تعديل'), Y('حذف')], [['الموافقة', 'لا تُطبَّق قبل موافقة الطبيب المختص على التقرير', true], ['التحضير', 'علامة صح لكل دواء، والإرسال بعد دواء واحد']]),
      groupTitle('التمريض'),
      card('ممرض', [Y('عرض'), P(), N('تعديل'), N('حذف')], [['يضيف فقط', 'تسجيل الإعطاء والعلامات الحيوية ونقل الدم']]));
  }

  drawTabs();
  loadUsers().catch(() => {});
  draw();
}

function miniStat(n, label, warn) {
  return h('div', null, h('span', { class: 'n', style: warn && n ? 'color: var(--on-dark-warn)' : null, text: n }), h('span', { class: 'l', text: label }));
}

// صندوق الكود: نسخ ومشاركة عبر واتساب
function codeBox(code, role, months, phone) {
  const appUrl = location.origin + location.pathname;
  const msg = `كود تفعيل حسابك في نظام متابعة مرضى الدم:\n${code}\nالتخصص: ${ROLES[role]}\nمدة الاشتراك: ${months} أشهر\nالكود صالح 7 أيام ويُستخدم مرة واحدة.\nرابط التطبيق: ${appUrl}`;
  let wa = 'https://wa.me/?text=' + encodeURIComponent(msg);
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^07\d{9}$/.test(digits)) wa = `https://wa.me/964${digits.slice(1)}?text=` + encodeURIComponent(msg);
  else if (/^9647\d{9}$/.test(digits)) wa = `https://wa.me/${digits}?text=` + encodeURIComponent(msg);

  return h('div', { class: 'code-box' },
    h('span', { class: 'code', text: code }),
    h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: 'يُستخدم مرة واحدة خلال 7 أيام' }),
    h('div', { class: 'grid-2', style: 'width: 100%' },
      h('button', { class: 'btn secondary sm', onclick: async () => {
        try { await navigator.clipboard.writeText(msg); toast('نُسخت الرسالة مع الكود'); } catch { toast('انسخ الكود يدوياً', true); }
      } }, icon('copy', 18), 'نسخ'),
      h('a', { class: 'btn secondary sm', href: wa, target: '_blank', rel: 'noopener' }, icon('share', 18), 'واتساب')));
}
