// زر «أضف إلى الشاشة الرئيسية» لكل المتصفحات
//   - كروم وإيدج وسامسونج (أندرويد والحاسوب): نافذة التثبيت الأصلية من المتصفح (beforeinstallprompt)
//   - آيفون وآيباد (سفاري، وكروم وغيرهما على iOS): أبل لا تسمح لأي موقع بتثبيت نفسه، فتُعرض الخطوات بالصور
//   - فايرفوكس وسفاري الحاسوب: خطوات قائمة كل منهما
//   - الزر يختفي إذا كان التطبيق مفتوحاً من أيقونته (مثبّتاً)
import { h, icon } from './ui.js';

let deferred = null;                      // حدث التثبيت المؤجل من كروم
const listeners = new Set();
const changed = () => listeners.forEach((f) => f());

// يُسجَّل مبكراً عند تحميل الوحدة: كروم يطلق الحدث مرة واحدة بعد فتح الصفحة
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; changed(); });
window.addEventListener('appinstalled', () => { deferred = null; markInstalled(); changed(); });

const KEY = 'hc-installed';
function markInstalled() { try { localStorage.setItem(KEY, '1'); } catch { /* ممنوع */ } }

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;          // سفاري iOS
}

// نوع الجهاز والمتصفح لاختيار الطريقة المناسبة
export function platform() {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);  // آيباد الحديث
  if (iOS) {
    if (/CriOS/.test(ua)) return 'ios-chrome';
    if (/FxiOS|EdgiOS|OPiOS/.test(ua)) return 'ios-other';
    return 'ios-safari';
  }
  const android = /Android/.test(ua);
  if (/Firefox\//.test(ua)) return android ? 'android-firefox' : 'desktop-firefox';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'mac-safari';
  return android ? 'android-chromium' : 'desktop-chromium';
}

// خطوات كل متصفح (حين لا تتوفر نافذة التثبيت الأصلية)
const SHARE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const PLUS_BOX = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
const MENU = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

const STEPS = {
  'ios-safari': [[SHARE, 'اضغط زر المشاركة', 'أسفل الشاشة في الآيفون، أو أعلاها في الآيباد'], [PLUS_BOX, 'اختر «إضافة إلى الشاشة الرئيسية»', 'مرّر القائمة للأسفل إن لم تظهر'], [null, 'اضغط «إضافة»', 'تظهر أيقونة Hematology على الشاشة الرئيسية']],
  'ios-chrome': [[SHARE, 'اضغط زر المشاركة', 'في شريط العنوان أعلى الشاشة'], [PLUS_BOX, 'اختر «إضافة إلى الشاشة الرئيسية»', 'إن لم تظهر: افتح الرابط في سفاري وأضفه من هناك'], [null, 'اضغط «إضافة»', '']],
  'ios-other': [[null, 'افتح الرابط في سفاري', 'التثبيت على الآيفون يكون من سفاري'], [SHARE, 'اضغط زر المشاركة', ''], [PLUS_BOX, 'اختر «إضافة إلى الشاشة الرئيسية»', '']],
  'android-firefox': [[DOTS, 'اضغط القائمة ⋮', 'أعلى الشاشة أو أسفلها'], [PLUS_BOX, 'اختر «تثبيت» أو «إضافة إلى الشاشة الرئيسية»', ''], [null, 'أكّد الإضافة', '']],
  'samsung': [[MENU, 'اضغط القائمة ☰', 'أسفل الشاشة'], [PLUS_BOX, 'اختر «إضافة صفحة إلى» ثم «الشاشة الرئيسية»', ''], [null, 'أكّد الإضافة', '']],
  'android-chromium': [[DOTS, 'اضغط القائمة ⋮', 'أعلى الشاشة'], [PLUS_BOX, 'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»', ''], [null, 'اضغط «تثبيت»', '']],
  'desktop-chromium': [[PLUS_BOX, 'اضغط أيقونة التثبيت في شريط العنوان', 'أو القائمة ⋮ ثم «تثبيت مركز أمراض الدم»'], [null, 'اضغط «تثبيت»', 'يفتح كنافذة مستقلة وتظهر أيقونته مع البرامج']],
  'mac-safari': [[null, 'من قائمة «ملف» اختر «إضافة إلى Dock»', 'متوفر في macOS Sonoma أو أحدث'], [null, 'اضغط «إضافة»', '']],
  'desktop-firefox': [[null, 'فايرفوكس على الحاسوب لا يثبّت التطبيقات', 'أضف الصفحة إلى المفضلة (Ctrl+D)، أو افتحها في كروم أو إيدج لتثبيتها']],
};

function stepsDialog(kind) {
  const dlg = h('dialog', null);
  const close = () => { dlg.close(); dlg.remove(); };
  const steps = STEPS[kind] || STEPS['android-chromium'];
  const list = h('ol', { class: 'install-steps' }, steps.map(([svg, t, s], i) => {
    const ic = h('span', { class: 'install-step-ic' });
    if (svg) ic.innerHTML = svg; else ic.textContent = String(i + 1);
    return h('li', null, ic, h('span', null, h('b', { text: t }), s ? h('span', { text: s }) : null));
  }));
  dlg.append(h('div', { class: 'dlg' },
    h('h2', { text: 'أضف التطبيق إلى الشاشة الرئيسية' }),
    h('p', { style: 'color: var(--muted); font-size: 14px', text: 'يفتح بعدها من أيقونته مباشرة وبملء الشاشة، كأي تطبيق.' }),
    list,
    h('button', { class: 'btn primary block', type: 'button', text: 'فهمت', onclick: close })));
  document.body.append(dlg);
  dlg.addEventListener('cancel', close);
  dlg.showModal();
}

// الزر: يُعاد رسمه عند تغيّر الحالة (وصول نافذة كروم أو اكتمال التثبيت)
export function installButton(variant = 'light') {
  if (isStandalone()) return null;
  const btn = h('button', { type: 'button', class: 'install-btn ' + variant, 'aria-label': 'أضف التطبيق إلى الشاشة الرئيسية' },
    icon('plus', 16, 'currentColor', 2.4), h('span', { text: 'أضف إلى الشاشة الرئيسية' }));
  btn.addEventListener('click', async () => {
    if (deferred) {
      const e = deferred; deferred = null;
      try { await e.prompt(); const r = await e.userChoice; if (r?.outcome === 'accepted') { markInstalled(); btn.remove(); } }
      catch { stepsDialog(platform()); }
      return;
    }
    stepsDialog(platform());
  });
  const sync = () => { if (!btn.isConnected) { listeners.delete(sync); return; } if (isStandalone()) btn.remove(); };
  listeners.add(sync);
  return btn;
}
