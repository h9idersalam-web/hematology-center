// يحفظ ملفات واجهة التطبيق فقط ليفتح بسرعة.
// لا يحفظ أي بيانات مرضى: كل طلبات قاعدة البيانات تذهب إلى الخادم مباشرة.
const VERSION = 'v15-2026-11-07-mixing-by-day';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'vendor/supabase-2.118.0.js',
  'js/app.js', 'js/api.js', 'js/ui.js', 'js/config.js', 'js/perms.js', 'js/dose.js', 'js/files.js', 'js/labs.js', 'js/ocr-labs.js',
  'js/screens/auth.js', 'js/screens/activation.js', 'js/screens/home.js',
  'js/screens/notifications.js', 'js/screens/admin.js',
  'js/screens/patients.js', 'js/screens/patient.js', 'js/screens/patient-form.js',
  'js/screens/appointments.js', 'js/screens/postpone.js',
  'js/screens/protocols.js', 'js/screens/protocol.js', 'js/screens/protocol-form.js', 'js/screens/plan-form.js',
  'js/screens/cycle.js', 'js/screens/cycle-edit.js', 'js/screens/requests.js', 'js/screens/request.js',
  'js/screens/files.js', 'js/screens/labs.js', 'js/screens/mixing.js', 'js/screens/nursing.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;  // البيانات لا تُحفظ
  // الشبكة أولاً، والنسخة المحفوظة عند انقطاع الإنترنت
  e.respondWith(fetch(e.request)
    .then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
