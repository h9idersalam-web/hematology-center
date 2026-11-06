// صفحة انتظار التفعيل: كود التفعيل، والحساب الموقوف أو المنتهي
import { rpc } from '../api.js';
import { h, mount, icon, field, notice, busy, ROLES, fmtDate, toast } from '../ui.js';
import { state, go, loadProfile, logout, accountState } from '../app.js';

// XXXXX-XXXXX: عشرة رموز بلا O و0 وI و1
const CODE_LEN = 10;
const formatCode = (v) => {
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
  return s.length > 5 ? s.slice(0, 5) + '-' + s.slice(5) : s;
};

export function render(root) {
  const p = state.profile;
  const st = accountState();

  const head = h('header', { class: 'topbar', style: 'border: 0; background: transparent' },
    h('div', { class: 'titles' }),
    h('button', { class: 'icon-btn', 'aria-label': 'تسجيل الخروج', onclick: logout }, icon('logout', 22)));

  // تحديث الحالة: إن فعّل المدير الحساب أو أعاده
  const refresh = h('button', { type: 'button', class: 'btn secondary block', onclick: async () => {
    await busy(refresh, async () => {
      await loadProfile();
      if (accountState() === 'active') { toast('حسابك مفعّل'); go('/home'); }
      else { toast('لم تتغير حالة الحساب بعد'); render(root); }
    });
  } }, icon('refresh', 20), 'تحديث حالة الحساب');

  const account = h('section', { class: 'card', 'aria-label': 'بيانات الحساب' },
    h('div', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap' },
      h('span', { style: 'font-size: 17px; font-weight: 700', text: p.full_name }),
      h('span', { class: 'pill ' + (st === 'suspended' ? 'muted' : 'warn'),
        text: st === 'suspended' ? 'موقوف' : st === 'expired' ? 'انتهى الاشتراك' : 'بانتظار التفعيل' })),
    p.email ? h('p', { class: 'ltr', style: 'font-size: 14px; color: var(--muted); text-align: right', text: p.email }) : null,
    h('div', null,
      h('p', { style: 'font-size: 13px; color: var(--muted-2)', text: 'التخصص المطلوب' }),
      h('p', { style: 'font-size: 15px; font-weight: 600', text: ROLES[p.role] })));

  if (st === 'suspended') {
    return mount(root, h('div', { class: 'screen' }, head, h('div', { class: 'main', style: 'padding-top: 0' },
      h('div', { class: 'avatar', style: 'width: 72px; height: 72px; border-radius: 22px' }, icon('lock', 36)),
      h('h1', { style: 'font-size: 26px', text: 'الحساب موقوف' }),
      h('p', { style: 'color: var(--muted); font-size: 16px; line-height: 1.7',
        text: 'أوقفت إدارة المركز هذا الحساب، فلا يمكنه فتح بيانات المرضى أو تعديلها. راجع مدير النظام لإعادة تفعيله.' }),
      p.suspended_reason ? notice('info', 'info', h('p', null, h('strong', { text: 'السبب: ' }), p.suspended_reason)) : null,
      account, refresh,
      h('button', { class: 'link-btn', onclick: logout, text: 'تسجيل الخروج' }))));
  }

  const code = h('input', { class: 'input code', id: 'act-code', type: 'text', inputmode: 'text', autocomplete: 'one-time-code',
    autocapitalize: 'characters', spellcheck: 'false', maxlength: CODE_LEN + 1, placeholder: 'XXXXX-XXXXX', dir: 'ltr',
    oninput: (e) => { e.target.value = formatCode(e.target.value); } });
  const err = h('div', { 'aria-live': 'assertive' });
  const submit = h('button', { type: 'submit', class: 'btn primary block', text: st === 'expired' ? 'تجديد الاشتراك' : 'تفعيل الحساب' });

  const form = h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.replaceChildren();
    if (code.value.replace('-', '').length !== CODE_LEN) {
      return err.replaceChildren(notice('err', 'warn', h('p', { text: 'الكود من 10 أحرف وأرقام، مثل ABCDE-23456' })));
    }
    await busy(submit, async () => {
      try {
        const r = await rpc('activate_account', { p_code: code.value });
        if (r.ok) {
          await loadProfile();
          toast('تم التفعيل حتى ' + fmtDate(r.active_until));
          return go('/home');
        }
        const lines = [h('p', { text: r.error })];
        if (r.locked) lines.push(h('p', { text: `أعد المحاولة بعد ${r.retry_minutes} دقيقة.` }));
        else if (r.remaining != null) lines.push(h('p', { text: r.remaining > 0 ? `بقيت ${r.remaining} محاولات قبل القفل المؤقت.` : 'أُقفل الإدخال مؤقتاً 15 دقيقة.' }));
        err.replaceChildren(notice('err', 'warn', ...lines));
        code.select();
      } catch (e2) {
        err.replaceChildren(notice('err', 'warn', h('p', { text: e2.message })));
      }
    });
  } },
    field('كود التفعيل', code, 'لا يهم إن كتبته بأحرف صغيرة أو كبيرة'),
    err, submit);

  const step = (n, title, text, done) => h('li', { style: 'display: flex; gap: 12px; align-items: flex-start' },
    h('span', { style: `flex: 0 0 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 15px; ${done ? 'background: var(--ok-soft, #E3F4EA); color: var(--ok, #167A3E)' : 'background: var(--brand-soft, #E8EEFD); color: var(--brand)'}` },
      done ? icon('check', 18, 'currentColor', 2.4) : String(n)),
    h('span', { style: 'display: flex; flex-direction: column; gap: 2px' },
      h('strong', { style: 'font-size: 16px', text: title }),
      h('span', { style: 'font-size: 14px; color: var(--muted); line-height: 1.6', text })));

  mount(root, h('div', { class: 'screen' }, head, h('div', { class: 'main', style: 'padding-top: 0' },
    h('div', { class: 'avatar', style: 'width: 72px; height: 72px; border-radius: 22px' }, icon('key', 36)),
    h('div', { style: 'display: flex; flex-direction: column; gap: 8px' },
      h('h1', { style: 'font-size: 28px', text: st === 'expired' ? 'انتهى اشتراكك' : 'حسابك بانتظار التفعيل' }),
      h('p', { style: 'color: var(--muted); font-size: 16px; line-height: 1.7',
        text: st === 'expired'
          ? 'انتهت مدة اشتراكك في ' + fmtDate(p.subscription_ends) + '. اطلب من إدارة المركز كود تجديد وأدخله هنا.'
          : 'أُنشئ حسابك، لكن لا يمكنك فتح بيانات المرضى قبل أن تفعّله إدارة المركز بكود خاص بك.' })),
    st === 'expired' ? null : h('ol', { class: 'card', style: 'margin: 0; list-style: none; display: flex; flex-direction: column; gap: 14px' },
      step(1, 'إنشاء الحساب', 'تم.', true),
      step(2, 'مراجعة الإدارة', 'يراجع مدير النظام طلبك ويرسل لك كود التفعيل (غالباً عبر واتساب).'),
      step(3, 'إدخال الكود', 'اكتب الكود في الحقل أدناه. يعمل لحسابك وحده، مرة واحدة، وقبل انتهاء صلاحيته.')),
    account, form,
    notice('info', 'info', h('p', { text: 'بعد 5 محاولات خاطئة يُقفل الإدخال 15 دقيقة. إن انتهت صلاحية الكود أو ضاع، اطلب كوداً جديداً من الإدارة.' })),
    refresh)));
}
