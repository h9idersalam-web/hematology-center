// التنبيه بالصوت أثناء فتح التطبيق (الخيار أ، بقرار صاحب المشروع)
//   - يفحص الإشعارات الجديدة كل دقيقة، وفوراً عند العودة إلى التطبيق
//   - إشعار جديد: نغمة، واهتزاز (أندرويد)، وإشعار على شاشة الهاتف يفتح الشاشة المعنية عند الضغط
//   - التنبيهات والموافقات المطلوبة بنغمة أقوى مكررة
//   - والتطبيق مغلق: إشعارات Push (الملف 40 ودالة الخادم send-push)، تُفعَّل مع التنبيه بالصوت
// الإعداد خاص بكل جهاز (localStorage)، والهاتف يشترط إذن المستخدم للصوت والإشعارات.
import { sb, q, rpc } from './api.js';
import { terms } from './terms.js';

const KEY = 'hc-sound-alerts';
const POLL_MS = 60000;
const URGENT = new Set(['alert', 'approval']);

const LINKS = {
  profile: () => '#/admin?tab=users',
  patient: (id) => '#/patient?id=' + id,
  treatment: (id) => '#/treatment?id=' + id,
  change_request: (id) => '#/request?id=' + id,
  protocol: (id) => '#/protocol?id=' + id,
  cycle: (id) => '#/cycle?id=' + id,
  mixing_order: (id) => '#/mixing-order?id=' + id,
  lab_result: (id) => '#/lab-alert?id=' + id,
  inventory_report: (id) => '#/report-pharmacy?id=' + id,
};
// رابط الإشعار داخل التطبيق
export function hrefOf(n) {
  if (n.link_type === 'patient' && /^تحليل خارج (المرجع|الحد الطبيعي)$/.test(n.title)) {
    return `#/lab-alert?patient=${n.link_id}&at=${encodeURIComponent(n.created_at)}`;
  }
  return LINKS[n.link_type] ? LINKS[n.link_type](n.link_id) : '#/notifications';
}

const store = {
  get() { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } },
  set(v) { try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* المتصفح يمنع التخزين */ } },
  asked() { try { return localStorage.getItem(KEY) !== null; } catch { return false; } },
};
export const soundEnabled = () => store.get();
export const soundAsked = () => store.asked();
export const canSystemNotify = () => 'Notification' in window && 'serviceWorker' in navigator;

// ------------------------------------------------------------------ الصوت (بلا ملفات: نغمة مولّدة)
let ctx = null;
function audio() {
  if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// يفتح الصوت عند أول لمسة (الهاتف يمنع الصوت قبل تفاعل المستخدم)
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { if (store.get()) audio(); }, { once: true, passive: true }));

export function chime(urgent = false) {
  const a = audio(); if (!a) return;
  const notes = urgent ? [880, 660, 880, 660] : [660, 880];
  notes.forEach((f, i) => {
    const t = a.currentTime + i * 0.22;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.21);
  });
  try { navigator.vibrate?.(urgent ? [200, 100, 200, 100, 300] : [200]); } catch { /* غير مدعوم */ }
}

// ------------------------------------------------------------------ Push والتطبيق مغلق (الملف 40)
export const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// آيفون: الإشعارات تعمل فقط بعد تثبيت التطبيق على الشاشة الرئيسية
export const isIosBrowser = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(navigator.standalone || matchMedia('(display-mode: standalone)').matches);
let pushOn = false;   // لهذا الجهاز اشتراك مسجّل: الإشعار يصل من الخادم، فلا يُكرَّر من الفحص الدوري
const b64 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };

// يسجّل اشتراك هذا الجهاز باسم المستخدم الحالي (بعد إذن الإشعارات). يعيد true إن نجح.
export async function syncPush() {
  if (!canPush() || Notification.permission !== 'granted') { pushOn = false; return false; }
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('sw not ready')), 8000))]);
    let key = await rpc('push_public_key');
    if (!key) { const { data } = await sb.functions.invoke('send-push', { body: { action: 'init' } }); key = data?.publicKey; }
    if (!key) return false;
    let sub = await reg.pushManager.getSubscription();
    // مفتاح مختلف (أُعيد توليده): اشتراك جديد
    if (sub && sub.options?.applicationServerKey) {
      const cur = new Uint8Array(sub.options.applicationServerKey); const want = b64(key);
      if (cur.length !== want.length || cur.some((v, i) => v !== want[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    const j = sub.toJSON();
    await rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
    pushOn = true;
    return true;
  } catch (e) { console.warn('push', e); pushOn = false; return false; }
}
// عند تسجيل الخروج: لا تصل إشعارات هذا الحساب لهذا الجهاز
export async function dropPush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) await rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
  } catch { /* بلا اتصال: يُستبدل الاشتراك عند الدخول التالي */ }
  pushOn = false;
}

// تفعيل من زر يضغطه المستخدم: يطلب إذن الإشعارات ويُسمعه النغمة للتجربة، ويسجّل الجهاز لإشعارات Push
export async function enableSound() {
  store.set(true);
  audio(); chime(false);
  let perm = 'unsupported';
  if (canSystemNotify()) {
    try { perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission; } catch { perm = 'denied'; }
  }
  start();
  if (perm === 'granted') await Promise.race([syncPush(), new Promise((r) => setTimeout(r, 4000))]);
  return perm;
}
export const pushActive = () => pushOn;
export function disableSound() { store.set(false); }

async function systemNotify(n) {
  if (!canSystemNotify() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const opts = { body: terms(n.body || ''), tag: n.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      data: { url: location.pathname + hrefOf(n) }, requireInteraction: URGENT.has(n.kind), lang: 'ar', dir: 'rtl' };
    if (reg) await reg.showNotification(terms(n.title), opts);
    else new Notification(terms(n.title), opts);
  } catch { /* بعض المتصفحات لا تعرض الإشعار والتطبيق في المقدمة */ }
}

// ------------------------------------------------------------------ الفحص الدوري
let timer = null, since = null, running = false;   // since: أحدث وقت إشعار نُبّه به (ملي ثانية)

function setBadge(n) {
  for (const bell of document.querySelectorAll('a[href="#/notifications"]')) {
    let dot = bell.querySelector('.badge-dot');
    if (!n) { dot?.remove(); continue; }
    if (!dot) { dot = document.createElement('span'); dot.className = 'badge-dot'; bell.append(dot); }
    dot.textContent = n > 99 ? '99+' : String(n);
    bell.setAttribute('aria-label', `الإشعارات، ${n} غير مقروءة`);
  }
}

async function check() {
  if (running) return;
  running = true;
  try {
    // نقطة البداية: وقت آخر إشعار موجود (بتوقيت الخادم، لا ساعة الهاتف)، فلا يُنبَّه بالقديم
    if (since === null) {
      const last = await q(sb.from('notifications').select('created_at').order('created_at', { ascending: false }).limit(1));
      since = last.length ? Date.parse(last[0].created_at) : 0;
    }
    const rows = await q(sb.from('notifications').select('id, kind, title, body, link_type, link_id, created_at, read_at')
      .is('read_at', null).order('created_at', { ascending: false }).limit(50));
    setBadge(rows.length);
    const fresh = rows.filter((n) => Date.parse(n.created_at) > since);
    for (const n of fresh) since = Math.max(since, Date.parse(n.created_at));
    if (fresh.length && store.get()) {
      chime(fresh.some((n) => URGENT.has(n.kind)));
      if (!pushOn) for (const n of fresh.slice(0, 3)) systemNotify(n);   // مع Push يصل الإشعار من الخادم
    }
  } catch { /* انقطاع مؤقت: يُعاد في الفحص التالي */ } finally { running = false; }
}

// يبدأ بعد الدخول بحساب مفعّل. أول فحص يحدد نقطة البداية فلا يُنبَّه بالإشعارات القديمة.
export function start() {
  if (timer) return;
  since = null;
  syncPush();   // الإذن ممنوح سابقاً: يُجدَّد اشتراك الجهاز باسم المستخدم الحالي بصمت
  check();
  timer = setInterval(check, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
export function stop() { clearInterval(timer); timer = null; since = null; }
// للاختبار: فحص فوري
export const checkNow = () => check();
