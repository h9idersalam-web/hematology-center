// يحفظ ملفات واجهة التطبيق فقط ليفتح بسرعة.
// لا يحفظ أي بيانات مرضى: كل طلبات قاعدة البيانات تذهب إلى الخادم مباشرة.
const VERSION = 'v40-2026-11-08-pending-specialists';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'vendor/supabase-2.118.0.js',
  'js/app.js', 'js/api.js', 'js/terms.js', 'js/notify.js', 'js/install.js', 'js/ui.js', 'js/config.js', 'js/perms.js', 'js/dose.js', 'js/files.js', 'js/labs.js', 'js/ocr-labs.js', 'js/xlsx.js', 'js/inventory.js', 'js/diagnoses.js', 'js/theme.js', 'css/theme-a.css', 'css/theme-b.css',
  'js/screens/auth.js', 'js/screens/activation.js', 'js/screens/home.js',
  'js/screens/notifications.js', 'js/screens/admin.js',
  'js/screens/patients.js', 'js/screens/patient.js', 'js/screens/patient-form.js',
  'js/screens/appointments.js', 'js/screens/postpone.js',
  'js/screens/protocols.js', 'js/screens/protocol.js', 'js/screens/protocol-form.js', 'js/screens/plan-form.js',
  'js/screens/cycle.js', 'js/screens/cycle-edit.js', 'js/screens/requests.js', 'js/screens/request.js',
  'js/screens/files.js', 'js/screens/labs.js', 'js/screens/lab-alert.js', 'js/screens/mixing.js', 'js/screens/nursing.js', 'js/screens/pharmacy.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
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
  // no-cache: يسأل الخادم دائماً عن النسخة الأحدث (لا يكتفي بنسخة المتصفح لعشر دقائق)
  const fresh = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache' }) : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(fetch(fresh)
    .then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

// الضغط على إشعار الهاتف: يفتح التطبيق على الشاشة المعنية
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) return c.focus().then(() => c.navigate(url));
    return self.clients.openWindow(url);
  }));
});
