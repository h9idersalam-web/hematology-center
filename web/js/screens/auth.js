// إنشاء الحساب وتسجيل الدخول
import { sb, errMsg } from '../api.js';
import { h, mount, icon, field, notice, busy, ROLE_GROUPS, ROLES } from '../ui.js';
import { CENTER_NAME } from '../config.js';
import { state, go, loadProfile } from '../app.js';

function hero() {
  return h('header', { class: 'hero' },
    h('div', { class: 'logo' }, icon('drop', 34)),
    h('div', { style: 'display: flex; flex-direction: column; gap: 4px' },
      h('h1', { text: CENTER_NAME }),
      h('p', { class: 'center ltr', style: 'font-size: 18px; font-weight: 600; letter-spacing: .5px', text: 'Hematology' })));
}

function switcher(active) {
  return h('div', { style: 'padding: 20px 24px 0' },
    h('div', { class: 'segmented' },
      h('a', { href: '#/register', 'aria-current': active === 'register' ? 'page' : null, text: 'حساب جديد' }),
      h('a', { href: '#/login', 'aria-current': active === 'login' ? 'page' : null, text: 'تسجيل الدخول' })));
}

function errorBox() {
  const box = h('div', { 'aria-live': 'assertive' });
  box.show = (msg) => box.replaceChildren(notice('err', 'warn', h('p', { text: msg })));
  box.clear = () => box.replaceChildren();
  return box;
}

// ---------------------------------------------------------------- الدخول
export function login(root) {
  const email = h('input', { class: 'input ltr', type: 'email', autocomplete: 'username', required: true, placeholder: 'name@example.com' });
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, placeholder: 'كلمة المرور' });
  const err = errorBox();
  const submit = h('button', { type: 'submit', class: 'btn primary block', text: 'دخول' });

  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.clear();
    if (!email.value.trim() || !pass.value) return err.show('أدخل البريد وكلمة المرور');
    await busy(submit, async () => {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      if (error) return err.show(errMsg(error));
      state.session = data.session; state.profile = null;
      try { await loadProfile(); } catch (e2) { return err.show(e2.message); }
      go('/home');
    });
  } },
    field('البريد الإلكتروني', email),
    field('كلمة المرور', pass),
    err, submit,
    h('p', { class: 'hint', style: 'text-align: center; color: var(--muted)', text: 'نسيت كلمة المرور؟ اطلب من مدير النظام إعادة تعيينها.' }));

  mount(root, h('div', { class: 'screen' }, hero(), switcher('login'), h('div', { class: 'main' }, form)));
}

// ---------------------------------------------------------------- حساب جديد
export function register(root) {
  let group = ROLE_GROUPS[1];
  let role = group.subs[0].role;

  const groupBox = h('div', { class: 'grid-3' });
  const subsBox = h('div');
  const name = h('input', { class: 'input', type: 'text', autocomplete: 'name', required: true, placeholder: 'كما يظهر في هوية النقابة' });
  const phone = h('input', { class: 'input ltr', type: 'tel', autocomplete: 'tel', placeholder: '07XX XXX XXXX', style: 'text-align: right' });
  const email = h('input', { class: 'input ltr', type: 'email', autocomplete: 'username', required: true, placeholder: 'name@example.com' });
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: 8, placeholder: '8 أحرف على الأقل' });
  const pass2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, placeholder: 'أعد كتابة كلمة المرور' });
  const err = errorBox();
  const submit = h('button', { type: 'submit', class: 'btn primary block', text: 'إنشاء الحساب' });

  function drawGroups() {
    groupBox.replaceChildren(...ROLE_GROUPS.map((g) => h('button', {
      type: 'button', class: 'choice', 'aria-pressed': g === group ? 'true' : 'false', text: g.label,
      onclick: () => { group = g; role = g.subs[0].role; drawGroups(); drawSubs(); },
    })));
  }
  function drawSubs() {
    if (group.subs.length === 1) {
      subsBox.replaceChildren(h('p', { class: 'card', style: 'font-size: 15px; color: var(--muted)', text: group.subs[0].desc }));
      return;
    }
    subsBox.replaceChildren(h('fieldset', null, h('legend', { text: group.legend }),
      h('div', { style: 'display: flex; flex-direction: column; gap: 8px' },
        group.subs.map((s) => h('button', {
          type: 'button', class: 'option', 'aria-pressed': s.role === role ? 'true' : 'false',
          onclick: () => { role = s.role; drawSubs(); },
        }, h('span', { class: 'radio', 'aria-hidden': 'true' }),
           h('span', null, h('span', { class: 'ot', text: ROLES[s.role] }), h('span', { class: 'od', text: s.desc })))))));
  }

  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.clear();
    if (name.value.trim().length < 3) return err.show('اكتب الاسم الكامل');
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return err.show('صيغة البريد غير صحيحة');
    if (pass.value.length < 8) return err.show('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    if (pass.value !== pass2.value) return err.show('كلمتا المرور غير متطابقتين');
    await busy(submit, async () => {
      const { data, error } = await sb.auth.signUp({
        email: email.value.trim(), password: pass.value,
        options: { data: { full_name: name.value.trim(), phone: phone.value.trim() || null, role } },
      });
      if (error) return err.show(errMsg(error));
      if (!data.session) {
        // تأكيد البريد ما زال مفعّلاً في Supabase (يُوقفه المدير من لوحة التحكم)
        return err.show('أُنشئ حسابك. افتح رسالة تأكيد البريد في صندوق بريدك، ثم سجّل الدخول وأدخل كود التفعيل.');
      }
      state.session = data.session; state.profile = null;
      try { await loadProfile(); } catch (e2) { return err.show(e2.message); }
      go('/activate');
    });
  } },
    h('fieldset', null, h('legend', { text: 'التخصص' }), groupBox),
    subsBox,
    field('الاسم الكامل', name),
    field('رقم الهاتف', phone),
    field('البريد الإلكتروني', email, 'تستخدمه لتسجيل الدخول'),
    field('كلمة المرور', pass),
    field('تأكيد كلمة المرور', pass2),
    err, submit,
    h('p', { class: 'hint', style: 'text-align: center; color: var(--muted); line-height: 1.7', text: 'يبقى الحساب مقفلاً حتى إدخال كود التفعيل من إدارة المركز.' }));

  drawGroups(); drawSubs();
  mount(root, h('div', { class: 'screen' }, hero(), switcher('register'), h('div', { class: 'main' }, form)));
}

