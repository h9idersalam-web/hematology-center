// نقطة البداية: الجلسة، الملف الشخصي، والتنقل بين الشاشات
import { APP_NAME } from './config.js';
import * as notifier from './notify.js';
import './install.js';   // يلتقط نافذة التثبيت من كروم مبكراً
import { sb, configured, q } from './api.js';
import { h, mount, icon, notice } from './ui.js';
import * as auth from './screens/auth.js';
import * as activation from './screens/activation.js';
import * as home from './screens/home.js';
import * as notifications from './screens/notifications.js';
import * as admin from './screens/admin.js';
import * as patients from './screens/patients.js';
import * as patient from './screens/patient.js';
import * as patientForm from './screens/patient-form.js';
import * as appointments from './screens/appointments.js';
import * as protocols from './screens/protocols.js';
import * as protocol from './screens/protocol.js';
import * as protocolForm from './screens/protocol-form.js';
import * as planForm from './screens/plan-form.js';
import * as cycle from './screens/cycle.js';
import * as cycleEdit from './screens/cycle-edit.js';
import * as requests from './screens/requests.js';
import * as request from './screens/request.js';
import * as files from './screens/files.js';
import * as labs from './screens/labs.js';
import * as labAlert from './screens/lab-alert.js';
import * as mixing from './screens/mixing.js';
import * as nursing from './screens/nursing.js';

const root = document.getElementById('app');

export const state = { session: null, profile: null };

const ROUTES = {
  '/login': { screen: auth.login, public: true },
  '/register': { screen: auth.register, public: true },
  '/activate': { screen: activation.render, inactive: true },
  '/home': { screen: home.render },
  '/notifications': { screen: notifications.render },
  '/admin': { screen: admin.render, admin: true, wide: true },
  '/patients': { screen: (root, params) => (params.get('id') ? patient.render(root, params) : patients.render(root, params)) },
  '/patient': { screen: patient.render },
  '/patient-new': { screen: patientForm.render },
  '/patient-edit': { screen: patientForm.render },
  '/appointments': { screen: appointments.render },
  '/protocols': { screen: protocols.render },
  '/protocol': { screen: protocol.render },
  '/protocol-new': { screen: protocolForm.render },
  '/plan-new': { screen: planForm.render },
  '/cycle': { screen: cycle.render },
  '/cycle-edit': { screen: cycleEdit.render },
  '/requests': { screen: requests.render },
  '/request': { screen: request.render },
  '/treatment': { screen: openTreatment },
  '/upload': { screen: files.upload },
  '/files': { screen: files.list },
  '/labs': { screen: labs.view },
  '/labs-new': { screen: labs.entry },
  '/lab-alert': { screen: labAlert.render },
  '/transfer': { screen: mixing.transfer },
  '/mixing': { screen: mixing.list },
  '/mixing-order': { screen: mixing.order },
  '/nursing': { screen: nursing.list },
  '/administer': { screen: nursing.administer },
};

// رابط إشعار يشير إلى خطة علاج: افتح ملف مريضها
async function openTreatment(root, params) {
  const t = await q(sb.from('treatments').select('patient_id').eq('id', params.get('id')).maybeSingle());
  go(t ? '/patient?id=' + t.patient_id : '/patients');
}

export function go(path) {
  if (location.hash === '#' + path) route(); else location.hash = path;
}

export async function loadProfile() {
  if (!state.session) { state.profile = null; return null; }
  const p = await q(sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle());
  // الرديف المفعّل يعمل بدور مسؤول الصيادلة في كل الشاشات (كما في my_role بالقاعدة)
  if (p) {
    p.base_role = p.role;
    p.acting = p.role === 'clinical_pharmacist' && p.is_deputy && p.deputy_active;
    if (p.acting) p.role = 'chief_clinical_pharmacist';
    // المدير يعمل بدور يختاره (acting_role)، كما في my_role بالقاعدة
    if (p.is_admin && p.acting_role) p.role = p.acting_role;
  }
  state.profile = p;
  state.profileAt = Date.now();
  return state.profile;
}

export function accountState(p = state.profile) {
  if (!p) return 'none';
  if (p.status === 'suspended') return 'suspended';
  if (p.status === 'pending') return 'pending';
  if (!p.is_admin && p.subscription_ends && p.subscription_ends < new Date().toISOString().slice(0, 10)) return 'expired';
  return 'active';
}

export async function logout() {
  notifier.stop();
  await sb.auth.signOut();
  state.session = null; state.profile = null;
  go('/login');
}

async function route() {
  const [path, query] = (location.hash.replace(/^#/, '') || '/home').split('?');
  const params = new URLSearchParams(query || '');
  const r = ROUTES[path] || ROUTES['/home'];

  if (!state.session) {
    if (!r.public) return go('/login');
  } else {
    // يُعاد تحميل الملف الشخصي كل دقيقة: إن أوقف المدير الحساب يخرج صاحبه إلى صفحة الحالة
    if (!state.profile || Date.now() - (state.profileAt || 0) > 60000) {
      try { await loadProfile(); } catch (e) { if (!state.profile) return fatal(e.message); }
    }
    const st = accountState();
    if (r.public) return go(st === 'active' ? '/home' : '/activate');
    if (st === 'none') return fatal('لم يُنشأ ملفك الشخصي. تأكد من تشغيل ملف قاعدة البيانات الأول، ثم سجّل حساباً جديداً.');
    if (st !== 'active' && !r.inactive) return go('/activate');
    if (st === 'active' && r.inactive) return go('/home');
    if (r.admin && !state.profile.is_admin) return go('/home');
    if (st === 'active') notifier.start();   // فحص الإشعارات الجديدة كل دقيقة (والتنبيه بالصوت إن فُعّل)
  }

  root.classList.toggle('wide', !!r.wide);
  try {
    await r.screen(root, params);
    window.scrollTo(0, 0);
  } catch (e) {
    fatal(e.message);
  }
}

function fatal(msg) {
  mount(root, h('div', { class: 'main' },
    notice('err', 'warn', h('p', { text: msg })),
    h('button', { class: 'btn secondary', onclick: () => location.reload(), text: 'إعادة المحاولة' }),
    state.session ? h('button', { class: 'link-btn', onclick: logout, text: 'تسجيل الخروج' }) : null));
}

function notConfigured() {
  mount(root, h('div', { class: 'main' },
    h('div', { class: 'hero', style: 'border-radius: 20px' },
      h('div', { class: 'logo' }, icon('drop', 34)), h('h1', { text: APP_NAME })),
    notice('warn', 'warn',
      h('p', { text: 'التطبيق غير مربوط بقاعدة البيانات بعد.' }),
      h('p', { text: 'افتح الملف js/config.js وضع فيه رابط مشروع Supabase ومفتاحه العام.' }))));
}

async function start() {
  if (!configured) return notConfigured();
  const { data } = await sb.auth.getSession();
  state.session = data.session;

  sb.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'SIGNED_OUT') { state.profile = null; go('/login'); }
  });

  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
