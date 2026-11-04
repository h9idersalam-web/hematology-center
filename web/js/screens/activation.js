// كود التفعيل، والحساب الموقوف أو المنتهي
import { rpc } from '../api.js';
import { h, mount, icon, field, notice, busy, ROLES, fmtDate, toast } from '../ui.js';
import { state, go, loadProfile, logout, accountState } from '../app.js';

export function render(root) {
  const p = state.profile;
  const st = accountState();

  const head = h('header', { class: 'topbar', style: 'border: 0; background: transparent' },
    h('div', { class: 'titles' }),
    h('button', { class: 'icon-btn', 'aria-label': 'تسجيل الخروج', onclick: logout }, icon('logout', 22)));

  if (st === 'suspended') {
    return mount(root, h('div', { class: 'screen' }, head, h('div', { class: 'main' },
      h('div', { class: 'avatar', style: 'width: 72px; height: 72px; border-radius: 22px' }, icon('lock', 36)),
      h('h1', { style: 'font-size: 26px', text: 'الحساب موقوف' }),
      h('p', { style: 'color: var(--muted); font-size: 16px; line-height: 1.7', text: 'أوقفت إدارة المركز هذا الحساب. راجع مدير النظام لإعادة تفعيله.' }))));
  }

  const code = h('input', { class: 'input code', type: 'text', autocomplete: 'one-time-code', maxlength: 9, placeholder: 'XXXX-XXXX',
    oninput: (e) => {
      let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4);
      e.target.value = v;
    } });
  const err = h('div', { 'aria-live': 'assertive' });
  const submit = h('button', { type: 'submit', class: 'btn primary block', text: st === 'expired' ? 'تجديد الاشتراك' : 'تفعيل وفتح التطبيق' });

  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.replaceChildren();
    if (code.value.replace('-', '').length !== 8) {
      return err.replaceChildren(notice('err', 'warn', h('p', { text: 'الكود من 8 أحرف وأرقام' })));
    }
    await busy(submit, async () => {
      try {
        const until = await rpc('redeem_activation_code', { p_code: code.value });
        await loadProfile();
        toast('تم التفعيل حتى ' + fmtDate(until));
        go('/home');
      } catch (e2) {
        err.replaceChildren(notice('err', 'warn', h('p', { text: e2.message })));
      }
    });
  } },
    field('كود التفعيل', code),
    err, submit);

  mount(root, h('div', { class: 'screen' }, head, h('div', { class: 'main', style: 'padding-top: 0' },
    h('div', { class: 'avatar', style: 'width: 72px; height: 72px; border-radius: 22px' }, icon('key', 36)),
    h('div', { style: 'display: flex; flex-direction: column; gap: 8px' },
      h('h1', { style: 'font-size: 28px', text: st === 'expired' ? 'انتهى اشتراكك' : 'تفعيل الحساب' }),
      h('p', { style: 'color: var(--muted); font-size: 16px; line-height: 1.7',
        text: st === 'expired' ? 'أدخل كوداً جديداً من إدارة المركز لتجديد الاشتراك.' : 'أدخل الكود الذي استلمته من إدارة المركز لفتح التطبيق.' })),
    h('section', { class: 'card', 'aria-label': 'بيانات الحساب' },
      h('div', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px' },
        h('span', { style: 'font-size: 17px; font-weight: 700', text: p.full_name }),
        h('span', { class: 'pill warn', text: st === 'expired' ? 'منتهي منذ ' + fmtDate(p.subscription_ends) : 'بانتظار التفعيل' })),
      h('div', null,
        h('p', { style: 'font-size: 13px; color: var(--muted-2)', text: 'التخصص المسجّل' }),
        h('p', { style: 'font-size: 15px; font-weight: 600', text: ROLES[p.role] }))),
    form,
    h('ul', { style: 'margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px' },
      ['يُستخدم الكود مرة واحدة فقط.', 'يجب أن يطابق الكود التخصص الذي اخترته.', 'يحدد الكود مدة اشتراكك.']
        .map((t) => h('li', { style: 'display: flex; gap: 10px; align-items: flex-start; font-size: 15px; color: var(--muted)' },
          icon('check', 20, '#1E4FD8', 2), h('span', { text: t })))))));
}
