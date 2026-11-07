// الإدارة: المستخدمون، أكواد التفعيل، الاشتراكات، الصلاحيات (للمدير وحده)
import { rpc } from '../api.js';
import { h, mount, icon, topbar, empty, ROLES, fmtDate, daysUntil, toast, busy, field, notice, initials, confirmDialog } from '../ui.js';
import { state, go } from '../app.js';

const STATUS = { pending: ['بانتظار التفعيل', 'warn'], active: ['مفعّل', 'ok'], suspended: ['موقوف', 'muted'] };
const MONTHS = [3, 6, 12];
const VALID = [[24, '24 ساعة'], [72, '3 أيام'], [168, '7 أيام']];
const fmtDateTime = (d) => new Intl.DateTimeFormat('ar-IQ', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(d));

export async function render(root, params) {
  let tab = params.get('tab') || 'users';
  if (tab === 'codes') tab = 'users';   // الأكواد صارت داخل إدارة المستخدمين
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('main', { class: 'main' });
  const stats = h('div', { class: 'mini-stats', style: 'padding: 0 20px' });

  mount(root, h('div', { class: 'screen' },
    h('div', { style: 'background: var(--dark); color: #fff; padding-bottom: 16px; display: flex; flex-direction: column; gap: 12px' },
      topbar({ title: 'لوحة المدير', sub: 'مدير النظام فقط', back: '#/home', dark: true }),
      stats),
    tabs, body));

  const TABS = [['users', 'إدارة المستخدمين'], ['subscriptions', 'الاشتراكات'], ['permissions', 'الصلاحيات']];
  function drawTabs() {
    tabs.replaceChildren(...TABS.map(([id, label]) => h('button', {
      role: 'tab', 'aria-selected': tab === id ? 'true' : 'false',
      onclick: () => { tab = id; history.replaceState(null, '', '#/admin?tab=' + id); drawTabs(); draw(); },
    }, label)));
  }

  let users = [];
  async function loadUsers() {
    users = await rpc('admin_list_users');
    const soon = users.filter((u) => u.status === 'active' && u.subscription_ends && daysUntil(u.subscription_ends) <= 14).length;
    stats.replaceChildren(
      miniStat(users.filter((u) => u.status === 'active').length, 'مفعّل'),
      miniStat(users.filter((u) => u.status === 'pending').length, 'بانتظار التفعيل', true),
      miniStat(soon, 'اشتراك ينتهي قريباً', true));
  }

  async function draw() {
    body.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    try {
      if (tab === 'users') await drawUsers();
      else if (tab === 'subscriptions') await drawSubscriptions();
      else drawPermissions();
    } catch (e) {
      body.replaceChildren(notice('err', 'warn', h('p', { text: e.message })));
    }
  }

  // ------------------------------------------------------------ إدارة المستخدمين
  let filter = 'all', search = '';
  const FILTERS = [['all', 'الكل'], ['pending', 'بانتظار'], ['active', 'مفعّل'], ['suspended', 'موقوف']];

  async function drawUsers() {
    await loadUsers();
    const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'تصفية حسب الحالة' });
    const list = h('div', { class: 'user-grid' });
    const searchIn = h('input', { class: 'input', type: 'search', placeholder: 'ابحث بالاسم أو البريد', value: search,
      oninput: (e) => { search = e.target.value; drawList(); } });
    function drawSeg() {
      seg.replaceChildren(...FILTERS.map(([id, label]) => {
        const n = id === 'all' ? users.length : users.filter((u) => u.status === id).length;
        return h('button', { type: 'button', 'aria-pressed': filter === id ? 'true' : 'false',
          onclick: () => { filter = id; drawSeg(); drawList(); } }, `${label} (${n})`);
      }));
    }
    function drawList() {
      const qs = search.trim().toLowerCase();
      const rows = users.filter((u) => (filter === 'all' || u.status === filter)
        && (!qs || (u.full_name || '').toLowerCase().includes(qs) || (u.email || '').toLowerCase().includes(qs)));
      list.replaceChildren(...(rows.length ? rows.map(userCard) : [h('div', { class: 'card' }, empty('لا يوجد مستخدمون بهذه التصفية', 'users'))]));
    }
    drawSeg(); drawList();
    body.replaceChildren(
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'إدارة المستخدمين' }), h('span', { class: 'meta', text: `${users.length} حساب` })),
        h('p', { style: 'color: var(--muted); font-size: 15px; line-height: 1.7',
          text: 'الحساب الجديد يبقى «بانتظار التفعيل» حتى تصدر له كوداً. تحقق من هوية صاحبه قبل الإصدار.' }),
        searchIn, seg, list));
  }

  function codeLine(u) {
    if (u.status !== 'pending' && !(u.status === 'active' && u.code)) return null;
    if (u.failed_15m >= 5) return h('span', { class: 'pill warn', text: 'مقفل مؤقتاً بعد محاولات خاطئة' });
    if (!u.code) return h('span', { class: 's', text: 'لم يُصدر له كود بعد' });
    if (u.code.expired) return h('span', { class: 'pill muted', text: 'انتهت صلاحية الكود' });
    return h('span', { class: 's', text: 'كود صالح حتى ' + fmtDateTime(u.code.expires_at) });
  }

  function userCard(u) {
    const [label, tone] = STATUS[u.status];
    const isSelf = u.id === state.profile.id;
    const left = daysUntil(u.subscription_ends);
    const sub = u.status !== 'active' ? null
      : u.is_admin || !u.subscription_ends ? 'اشتراك دائم'
        : left < 0 ? 'انتهى الاشتراك' : 'الاشتراك حتى ' + fmtDate(u.subscription_ends);
    const btn = (cls, text, onclick) => h('button', { type: 'button', class: 'btn sm ' + cls, onclick }, text);
    const actions = [];
    if (u.is_admin) actions.push(h('span', { class: 'pill ok', text: isSelf ? 'أنت المدير' : 'مدير' }));
    else if (u.status === 'pending') {
      actions.push(btn('primary', u.code && !u.code.expired ? 'إصدار كود جديد' : 'إصدار كود', () => issueDialog(u)));
      actions.push(btn('secondary', 'إيقاف', () => suspend(u)));
    } else if (u.status === 'active') {
      actions.push(btn('secondary', 'كود تجديد', () => issueDialog(u)));
      actions.push(btn('secondary', 'التخصص والاشتراك', () => userDialog(u)));
      if (u.role === 'clinical_pharmacist') {
        actions.push(btn('secondary', u.is_deputy ? 'إلغاء تعيينه رديفاً' : 'تعيينه رديفاً لمسؤول الصيادلة', () => deputy(u)));
      }
      actions.push(btn('danger', 'إيقاف', () => suspend(u)));
    } else {
      actions.push(btn('ok', 'إعادة التفعيل', () => reactivate(u)));
    }
    if (!u.is_admin && u.code && !u.code.expired) actions.push(h('button', { type: 'button', class: 'link-btn', onclick: () => revoke(u) }, 'إلغاء الكود'));

    return h('article', { class: 'card', style: 'gap: 10px' },
      h('div', { style: 'display: flex; gap: 12px; align-items: center' },
        h('span', { class: 'avatar', text: initials(u.full_name) }),
        h('span', { class: 'grow', style: 'display: flex; flex-direction: column; gap: 2px; min-width: 0' },
          h('span', { class: 't', style: 'font-size: 17px; font-weight: 700', text: u.full_name }),
          h('span', { class: 's', text: u.is_deputy && u.role === 'clinical_pharmacist'
            ? 'صيدلي سريري · رديف مسؤول الصيادلة (' + (u.deputy_active ? 'الصلاحيات مفعّلة' : 'الصلاحيات موقوفة') + ')' : ROLES[u.role] || u.role }),
          u.email ? h('span', { class: 's ltr', style: 'text-align: right; font-size: 13px; overflow-wrap: anywhere', text: u.email }) : null),
        h('span', { class: 'pill ' + tone, text: label })),
      sub ? h('span', { class: 's', text: sub }) : null,
      u.status === 'suspended' && u.suspended_reason ? h('span', { class: 's', text: 'سبب الإيقاف: ' + u.suspended_reason }) : null,
      codeLine(u),
      h('div', { style: 'display: flex; flex-wrap: wrap; gap: 8px' }, actions));
  }

  // المدير يعيّن الرديف، ومسؤول الصيادلة وحده يفعّل صلاحياته أو يوقفها
  async function deputy(u) {
    const on = !u.is_deputy;
    const ok = await confirmDialog({ title: (on ? 'تعيين ' : 'إلغاء تعيين ') + u.full_name + ' رديفاً',
      body: on ? 'يبقى صيدلياً سريرياً حتى يفعّل مسؤول الصيادلة صلاحياته من صفحته الرئيسية؛ عندها يعمل بكل صلاحيات مسؤول الصيادلة.'
               : 'تُلغى صفة الرديف وتُوقف صلاحياته إن كانت مفعّلة، ويبقى صيدلياً سريرياً.',
      okText: on ? 'تعيين' : 'إلغاء التعيين', danger: !on });
    if (!ok) return;
    try { await rpc('admin_set_deputy', { p_user: u.id, p_on: on }); toast(on ? 'عُيّن رديفاً' : 'أُلغي التعيين'); draw(); }
    catch (e) { toast(e.message, true); }
  }

  async function suspend(u) {
    const reason = await confirmDialog({ title: 'إيقاف حساب ' + u.full_name,
      body: 'لن يستطيع فتح بيانات المرضى أو تعديلها، ويُلغى أي كود صالح له. يمكنك إعادة تفعيله لاحقاً.',
      okText: 'إيقاف الحساب', danger: true, input: { label: 'السبب (اختياري، يظهر لصاحب الحساب)', placeholder: 'مثال: انتهى التعاقد' } });
    if (reason === null) return;
    try { await rpc('admin_suspend_user', { p_user: u.id, p_reason: reason }); toast('أُوقف الحساب'); draw(); }
    catch (e) { toast(e.message, true); }
  }

  async function reactivate(u) {
    try {
      const st = await rpc('admin_reactivate_user', { p_user: u.id });
      toast(st === 'active' ? 'أُعيد تفعيل الحساب' : 'أُعيد الحساب إلى «بانتظار التفعيل»؛ أصدر له كوداً');
      draw();
    } catch (e) { toast(e.message, true); }
  }

  async function revoke(u) {
    const ok = await confirmDialog({ title: 'إلغاء الكود', body: 'لن يعمل الكود الحالي لـ ' + u.full_name + '. يمكنك إصدار كود جديد في أي وقت.', okText: 'إلغاء الكود', danger: true });
    if (!ok) return;
    try { await rpc('admin_revoke_user_codes', { p_user: u.id }); toast('أُلغي الكود'); draw(); }
    catch (e) { toast(e.message, true); }
  }

  // نافذة التخصص والاشتراك
  function userDialog(u) {
    const dlg = h('dialog', null);
    const close = () => { dlg.close(); dlg.remove(); };
    const roleSel = h('select', { class: 'input' }, Object.entries(ROLES).map(([k, v]) => h('option', { value: k, selected: k === u.role, text: v })));
    dlg.append(h('div', { class: 'dlg' },
      h('h2', { text: u.full_name }),
      h('p', { style: 'color: var(--muted)', text: [u.email, u.phone].filter(Boolean).join(' · ') || '—' }),
      h('p', { style: 'font-size: 15px', text: u.is_admin || !u.subscription_ends ? 'اشتراك دائم' : `الاشتراك حتى ${fmtDate(u.subscription_ends)}` }),
      field('التخصص', roleSel),
      h('button', { class: 'btn secondary', text: 'حفظ التخصص', onclick: async (e) => {
        await busy(e.currentTarget, async () => {
          try { await rpc('admin_update_user', { p_user: u.id, p_role: roleSel.value }); toast('حُدّث التخصص'); draw(); close(); }
          catch (err) { toast(err.message, true); }
        });
      } }),
      u.is_admin ? null : h('div', { class: 'field' }, h('span', { class: 'label', text: 'تمديد الاشتراك' }),
        h('div', { class: 'grid-3' }, MONTHS.map((m) => h('button', { class: 'btn secondary sm', text: m === 12 ? 'سنة' : `${m} أشهر`,
          onclick: async (e) => {
            await busy(e.currentTarget, async () => {
              try { const until = await rpc('admin_extend_subscription', { p_user: u.id, p_months: m }); toast('مُدّد حتى ' + fmtDate(until)); draw(); close(); }
              catch (err) { toast(err.message, true); }
            });
          } })))),
      h('button', { class: 'link-btn', text: 'إغلاق', onclick: close })));
    document.body.append(dlg);
    dlg.addEventListener('cancel', close);
    dlg.showModal();
  }

  // إصدار كود لمستخدم بعينه: التخصص، مدة الاشتراك، صلاحية الكود
  function issueDialog(u) {
    const dlg = h('dialog', null);
    const close = () => { dlg.close(); dlg.remove(); };
    let months = 6, hours = 72;
    const roleSel = h('select', { class: 'input' }, Object.entries(ROLES).map(([k, v]) => h('option', { value: k, selected: k === u.role, text: v })));
    const segM = h('div', { class: 'segmented' });
    const segH = h('div', { class: 'segmented' });
    const drawSeg = () => {
      segM.replaceChildren(...MONTHS.map((m) => h('button', { type: 'button', 'aria-pressed': m === months ? 'true' : 'false',
        text: m === 12 ? 'سنة' : `${m} أشهر`, onclick: () => { months = m; drawSeg(); } })));
      segH.replaceChildren(...VALID.map(([hh, t]) => h('button', { type: 'button', 'aria-pressed': hh === hours ? 'true' : 'false',
        text: t, onclick: () => { hours = hh; drawSeg(); } })));
    };
    drawSeg();
    const opts = h('div', { style: 'display: flex; flex-direction: column; gap: 12px' },
      field('التخصص الذي يُمنح عند التفعيل', roleSel, u.status === 'pending' ? 'اختاره المستخدم عند التسجيل؛ غيّره إن لزم' : null),
      h('span', { class: 'label', style: 'font-weight: 600', text: 'مدة الاشتراك' }), segM,
      h('span', { class: 'label', style: 'font-weight: 600', text: 'صلاحية الكود' }), segH,
      u.code && !u.code.expired ? notice('warn', 'warn', h('p', { text: 'يوجد كود صالح لهذا المستخدم؛ إصدار كود جديد يلغي السابق.' })) : null);
    const out = h('div');
    const make = h('button', { class: 'btn primary', text: 'إصدار الكود', onclick: async () => {
      await busy(make, async () => {
        try {
          const r = await rpc('admin_issue_code', { p_user: u.id, p_months: months, p_valid_hours: hours, p_role: roleSel.value });
          make.remove(); opts.remove();
          out.replaceChildren(codeBox(r.code, r.role, r.months, u.phone, r.expires_at));
          draw();
        } catch (e) { toast(e.message, true); }
      });
    } });
    dlg.append(h('div', { class: 'dlg' },
      h('h2', { text: 'كود تفعيل لـ ' + u.full_name }),
      u.email ? h('p', { class: 'ltr', style: 'color: var(--muted); text-align: right', text: u.email }) : null,
      opts, make, out,
      h('button', { class: 'link-btn', text: 'إغلاق', onclick: close })));
    document.body.append(dlg);
    dlg.addEventListener('cancel', close);
    dlg.showModal();
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
      card('طبيب اختصاص', [Y('عرض'), Y('إضافة'), Y('تعديل'), Y('أرشفة')], [
        ['خطة العلاج', 'الطبيب المختص بالمريض وحده يوافق عليها أو يرفضها، ولكل مريض طبيب مختص إلزاماً'],
        ['الدورة', 'يعتمدها فتصل إلى المزج فوراً، ويغلقها ويؤجلها'],
        ['طلبات التعديل', 'يقرّر طلبات صيادلة مرضاه: السريري ومسؤول الصيادلة والمزج'],
        ['البروتوكول', 'يعتمده ويؤرشفه ويستبدل ملفه المعتمد']]),
      card('طبيب مقيم أقدم', [Y('عرض'), Y('إضافة'), Y('تعديل'), N('أرشفة')], [
        ['يعدّل', 'الأدوية والجرع والتشخيص ونوع البروتوكول، مباشرة ودون إسقاط اعتماد الدورة، ويُبلَّغ الطبيب المختص'],
        ['الدورة', 'يعتمدها ويغلقها ويؤجلها'],
        ['طلبات التعديل', 'يقرّر طلبات الصيدلي السريري ومسؤول الصيادلة والمزج']]),
      card('طبيب دوري', [Y('عرض'), N('إضافة'), N('تعديل'), N('أرشفة')], [['الصلاحية', 'عرض فقط']]),
      groupTitle('الصيادلة'),
      card('مسؤول الصيادلة السريريين', [Y('عرض'), Y('إضافة'), Y('تعديل'), Y('أرشفة')], [
        ['يطلب', 'كل أنواع التعديل، ويقرّره الطبيب المختص أو المقيم الأقدم، ثم يُعاد اعتماد الدورة', true],
        ['يقرّر', 'طلبات الصيدلي السريري (ويُعاد بعدها اعتماد الدورة)'],
        ['الدورة', 'يغلقها ويؤجلها، ويرفق صورة الطبلة'],
        ['البروتوكول', 'يؤرشفه ويستبدل ملفه المعتمد'],
        ['الرديف', 'يفعّل صلاحيات رديفه أو يوقفها من صفحته الرئيسية']]),
      card('رديف مسؤول الصيادلة', [Y('عرض'), P(), P(), P()], [
        ['التعيين', 'يعيّنه المدير من الصيادلة السريريين'],
        ['الصلاحيات', 'كل صلاحيات مسؤول الصيادلة حين يفعّلها المسؤول، وصيدلي سريري حين يوقفها']]),
      card('صيدلي سريري', [Y('عرض'), P(), P(), N('أرشفة')], [
        ['يطلب فقط', 'الجرعة، والمحلول ومعدل التسريب، والأدوية الداعمة'],
        ['يقرّره', 'الطبيب المختص أو المقيم الأقدم أو مسؤول الصيادلة', true],
        ['مهمته الإلزامية', 'صورة الدورة من طبلة المريض بعد اعتمادها، وتصل إلى المزج للتحقق']]),
      card('صيدلي المزج الكيميائي', [Y('عرض'), P(), P(), N('حذف')], [
        ['يستلم', 'الدورة فور اعتماد الطبيب، دون انتظار صورة الطبلة'],
        ['يطلب فقط', 'تعديل الجرعات، ويقرّره الطبيب المختص أو المقيم الأقدم، ثم يُعاد اعتماد الدورة ويُعلَّق المزج حتى ذلك', true],
        ['التحضير', 'علامة صح لكل دواء، والإرسال بعد دواء واحد']]),
      groupTitle('التمريض'),
      card('ممرض', [Y('عرض'), P(), N('تعديل'), N('حذف')], [
        ['يضيف فقط', 'تسجيل الإعطاء والعلامات الحيوية ونقل الدم'],
        ['التفاعلات', 'أي تفاعل يسجّله يصل فوراً إلى كل مقدمي الرعاية'],
        ['لا يغلق الدورة', 'الإغلاق للطبيب المختص والمقيم الأقدم ومسؤول الصيادلة']]));
  }

  drawTabs();
  loadUsers().catch(() => {});
  draw();
}

function miniStat(n, label, warn) {
  return h('div', null, h('span', { class: 'n', style: warn && n ? 'color: var(--on-dark-warn)' : null, text: n }), h('span', { class: 'l', text: label }));
}

// صندوق الكود: يظهر مرة واحدة فقط؛ نسخ ومشاركة عبر واتساب
function codeBox(code, role, months, phone, expiresAt) {
  const appUrl = location.origin + location.pathname;
  const until = fmtDateTime(expiresAt);
  const dur = months === 12 ? 'سنة' : `${months} أشهر`;
  const msg = `كود تفعيل حسابك في نظام متابعة مرضى الدم:\n${code}\nالتخصص: ${ROLES[role]}\nمدة الاشتراك: ${dur}\nالكود خاص بحسابك، يُستخدم مرة واحدة، وصالح حتى ${until}.\nسجّل الدخول ثم أدخل الكود في صفحة التفعيل: ${appUrl}`;
  let wa = 'https://wa.me/?text=' + encodeURIComponent(msg);
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^07\d{9}$/.test(digits)) wa = `https://wa.me/964${digits.slice(1)}?text=` + encodeURIComponent(msg);
  else if (/^9647\d{9}$/.test(digits)) wa = `https://wa.me/${digits}?text=` + encodeURIComponent(msg);

  return h('div', { class: 'code-box' },
    h('span', { class: 'code', text: code }),
    h('span', { style: 'font-size: 13px; color: var(--muted-2); text-align: center', text: `لهذا الحساب وحده، مرة واحدة، حتى ${until}` }),
    notice('warn', 'warn', h('p', { text: 'انسخ الكود أو أرسله الآن: لا يُحفظ في النظام ولن يظهر مرة أخرى.' })),
    h('div', { class: 'grid-2', style: 'width: 100%' },
      h('button', { class: 'btn secondary sm', onclick: async () => {
        try { await navigator.clipboard.writeText(msg); toast('نُسخت الرسالة مع الكود'); } catch { toast('انسخ الكود يدوياً', true); }
      } }, icon('copy', 18), 'نسخ'),
      h('a', { class: 'btn secondary sm', href: wa, target: '_blank', rel: 'noopener' }, icon('share', 18), 'واتساب')));
}
