// المظهر التجريبي (بطلب صاحب المشروع): تصميمان للتجربة على التطبيق الحقيقي دون تغيير مظهر بقية المستخدمين.
//   ?theme=a  → التصميم 1 (تصميم Figma الأول: Readex Pro وNoto Sans Arabic، أرقام بخط أحادي)
//   ?theme=b  → التصميم 2 (الشكل 7 «منحنيات وهوية» بخط Alexandria)
//   ?theme=off → المظهر الحالي
// يُحفظ الاختيار على الجهاز نفسه فقط (localStorage)، ويظهر شريط صغير للتبديل أو الخروج.
const KEY = 'hc-theme';
const THEMES = { a: 'التصميم 1', b: 'التصميم 2' };

function read() { try { return localStorage.getItem(KEY); } catch { return null; } }
function save(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* ممنوع */ } }

function fromUrl() {
  const q = new URLSearchParams(location.search);
  const hq = new URLSearchParams((location.hash.split('?')[1]) || '');
  return q.get('theme') || hq.get('theme');
}

let chip = null;
function apply(t) {
  const root = document.documentElement;
  document.getElementById('theme-css')?.remove();
  chip?.remove(); chip = null;
  if (!THEMES[t]) { delete root.dataset.theme; return; }
  root.dataset.theme = t;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.id = 'theme-css'; link.href = `css/theme-${t}.css`;
  document.head.append(link);
  chip = document.createElement('div');
  chip.className = 'theme-chip'; chip.setAttribute('role', 'region'); chip.setAttribute('aria-label', 'المظهر التجريبي');
  const label = document.createElement('span'); label.textContent = 'تجريبي ' + (t === 'a' ? '1' : '2');
  const sw = document.createElement('button'); sw.type = 'button'; sw.textContent = t === 'a' ? '← 2' : '← 1'; sw.setAttribute('aria-label', t === 'a' ? 'جرّب التصميم 2' : 'جرّب التصميم 1');
  sw.addEventListener('click', () => set(t === 'a' ? 'b' : 'a'));
  const off = document.createElement('button'); off.type = 'button'; off.textContent = '✕'; off.setAttribute('aria-label', 'الرجوع للمظهر الحالي');
  off.addEventListener('click', () => set(null));
  chip.append(label, sw, off);
  document.body.append(chip);
}

export function set(t) {
  const before = document.documentElement.dataset.theme || null;
  save(THEMES[t] ? t : null); apply(THEMES[t] ? t : null);
  // الشاشة الرئيسية في التصميم 2 لها تخطيط خاص: يُعاد رسم الشاشة الحالية عند التبديل
  if (before !== (document.documentElement.dataset.theme || null)) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function sync() {
  const u = fromUrl();
  if (u) { set(u === 'off' ? null : u); return; }
}

sync();
if (!fromUrl()) apply(read());
window.addEventListener('hashchange', sync);
