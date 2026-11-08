// المظهر: التصميم 2 (الشكل 7 «منحنيات وهوية» بخط Alexandria) هو المظهر الرسمي لكل المستخدمين (بقرار صاحب المشروع، 2026/11/8).
//   بلا شيء في الرابط → التصميم 2
//   ?theme=a   → التصميم 1 التجريبي (تصميم Figma الأول)
//   ?theme=off → المظهر القديم
//   ?theme=b   → الرجوع إلى التصميم 2
// يُحفظ الاختيار على الجهاز نفسه فقط (localStorage)، ويظهر شريط صغير للرجوع فقط عند اختيار غير التصميم 2.
// ملاحظة: سطر صغير في index.html يطبّق المظهر قبل ظهور الصفحة حتى لا يظهر الشكل القديم لحظة.
const KEY = 'hc-theme';
const DEFAULT = 'b';
const THEMES = { a: 'التصميم 1', b: 'التصميم 2' };

function read() { try { return localStorage.getItem(KEY); } catch { return null; } }
function save(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* ممنوع */ } }
// القيمة المحفوظة: لا شيء = التصميم 2، 'a' = التصميم 1، 'off' = المظهر القديم
const effective = (v) => (v === 'off' ? null : THEMES[v] ? v : DEFAULT);

function fromUrl() {
  const q = new URLSearchParams(location.search);
  const hq = new URLSearchParams((location.hash.split('?')[1]) || '');
  return q.get('theme') || hq.get('theme');
}

let chip = null;
function apply(t) {
  const root = document.documentElement;
  const href = THEMES[t] ? `css/theme-${t}.css` : null;
  const cur = document.getElementById('theme-css');
  if (cur && cur.getAttribute('href') !== href) cur.remove();
  chip?.remove(); chip = null;
  if (!href) delete root.dataset.theme;
  else {
    root.dataset.theme = t;
    if (!document.getElementById('theme-css')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.id = 'theme-css'; link.href = href;
      document.head.append(link);
    }
  }
  if (t === DEFAULT) return;   // المظهر الرسمي بلا شريط
  chip = document.createElement('div');
  chip.className = 'theme-chip'; chip.setAttribute('role', 'region'); chip.setAttribute('aria-label', 'المظهر');
  const label = document.createElement('span'); label.textContent = t === 'a' ? 'تجريبي 1' : 'المظهر القديم';
  const back = document.createElement('button'); back.type = 'button'; back.textContent = '✕'; back.setAttribute('aria-label', 'الرجوع إلى التصميم الرسمي');
  back.addEventListener('click', () => set(DEFAULT));
  chip.append(label, back);
  (document.body || document.documentElement).append(chip);
}

export function set(t) {
  const before = document.documentElement.dataset.theme || null;
  const v = t === null || t === 'off' ? 'off' : THEMES[t] ? t : DEFAULT;
  save(v === DEFAULT ? null : v);
  apply(effective(v === DEFAULT ? null : v));
  // بعض الشاشات لها تخطيط خاص بالتصميم 2: يُعاد رسم الشاشة الحالية عند التبديل
  if (before !== (document.documentElement.dataset.theme || null)) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// يُطبَّق اختيار الرابط مرة ثم يُزال منه، حتى لا يعيد فرضه بعد الضغط على «✕» أو التنقل
function stripUrl() {
  const u = new URL(location.href);
  u.searchParams.delete('theme');
  const [path, qs] = u.hash.split('?');
  if (qs) { const hq = new URLSearchParams(qs); hq.delete('theme'); u.hash = path + (hq.toString() ? '?' + hq : ''); }
  try { history.replaceState(history.state, '', u.href); } catch { /* ممنوع */ }
}
function sync() {
  const u = fromUrl();
  if (u) { stripUrl(); set(u); }
}

if (fromUrl()) sync(); else apply(effective(read()));
window.addEventListener('hashchange', sync);
