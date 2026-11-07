// تحويل صفوف ملف الإكسل إلى أدوية تقرير الصيدلية الداخلية
// يتعرف على الأعمدة من عناوينها (عربي أو إنجليزي)، ويمكن للمستخدم تغييرها قبل الحفظ.
import { latinDigits, todayISO, daysUntil } from './ui.js';
import { serialToISO } from './xlsx.js';

export const FIELDS = [
  ['drug_name', 'اسم الدواء'],
  ['quantity', 'العدد'],
  ['unit', 'الوحدة'],
  ['expiry_date', 'تاريخ انتهاء الصلاحية'],
  ['status', 'الحالة'],
  ['notes', 'الملاحظات'],
];
export const STATUS = { available: 'متوفر', low: 'شحيح', out: 'نافد' };

// ترتيب الفحص مهم: «صلاحية الدواء» عمود صلاحية لا اسم
const GUESS = [
  ['expiry_date', /انتهاء|صلاحي|اكسباير|إكسباير|expir|exp\b|exp\.|e\.?d\b|best before/i],
  ['status', /الحال|حالة|شح|status|state|availab/i],
  ['quantity', /العدد|عدد|الكمي|كمية|الرصيد|رصيد|المتوفر|qty|quan|count|stock|balance|amount|no\.? of/i],
  ['unit', /الوحد|وحدة|الشكل|العبوة|unit|form|pack/i],
  ['notes', /ملاحظ|note|remark|comment/i],
  ['drug_name', /اسم|الدواء|دواء|العلاج|المادة|الصنف|المستحضر|drug|name|item|medic|product|generic/i],
];

const cellText = (v) => (v && typeof v === 'object' ? v.date || '' : String(v ?? '')).trim();

// صف العناوين: أول صف (من العشرة الأولى) فيه عنوانان معروفان أو أكثر
export function guessColumns(rows) {
  let best = { header: -1, score: 0, map: {} };
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const map = {}; let score = 0;
    rows[r].forEach((v, c) => {
      const t = cellText(v);
      if (!t || typeof v === 'number') return;
      for (const [f, re] of GUESS) if (!(f in map) && re.test(t)) { map[f] = c; score++; break; }
    });
    if (score > best.score) best = { header: r, score, map };
  }
  if (best.score >= 2 || (best.score === 1 && 'drug_name' in best.map)) return best;
  // بلا عناوين: العمود الأول اسم الدواء، والثاني العدد
  return { header: -1, score: 0, map: { drug_name: 0, quantity: 1 } };
}

export function parseQty(v) {
  if (typeof v === 'number') return { qty: v >= 0 ? v : null, rest: v < 0 ? String(v) : '' };
  const t = latinDigits(cellText(v)).replace(/[,٬]/g, '').replace('٫', '.');
  if (!t) return { qty: null, rest: '' };
  const m = t.match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { qty: null, rest: t };
  return { qty: Number(m[1]), rest: m[2].trim() };
}

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function iso(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  d = d ?? lastDay(y, m);
  if (d < 1 || d > lastDay(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// تاريخ الصلاحية: تاريخ إكسل، أو 2027-03-31، أو 31/3/2027 (يوم/شهر)، أو 3/2027 (آخر الشهر)، أو Mar 2027
export function parseExpiry(v) {
  if (v && typeof v === 'object' && v.date) return v.date;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialToISO(v) : null;
  const t = latinDigits(cellText(v)).toLowerCase();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d{4})[\/\-.](\d{1,2})(?:[\/\-.](\d{1,2}))?/))) return iso(+m[1], +m[2], m[3] ? +m[3] : undefined);
  if ((m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/))) return iso(+m[3], +m[2], +m[1]);
  if ((m = t.match(/^(\d{1,2})[\/\-.](\d{2,4})$/))) return iso(+m[2], +m[1]);
  if ((m = t.match(/^([a-z]{3})[a-z]*[\s\-\/.]*(\d{2,4})$/)) && MONTHS[m[1]]) return iso(+m[2], MONTHS[m[1]]);
  if ((m = t.match(/^(\d{4,5})(?:\.0+)?$/))) return serialToISO(+m[1]);
  return null;
}

export function parseStatus(v, qty) {
  const t = latinDigits(cellText(v)).toLowerCase();
  if (/شح|قليل|قلة|محدود|ناقص|low|short|limited/.test(t)) return 'low';
  if (/نفد|نافد|نفذ|نافذ|غير متوفر|غير متاح|لا يوجد|معدوم|منقطع|out|none|n\/a|^0$|^no$|^لا$/.test(t)) return 'out';
  if (/متوفر|متاح|موجود|كاف|available|ok|yes|^نعم$/.test(t)) return 'available';
  return qty === 0 ? 'out' : 'available';
}

// الصفوف بعد العناوين إلى أدوية؛ ما لم يُفهم يُذكر في warnings ويبقى نصه في الملاحظات
export function rowsToItems(rows, header, map) {
  const items = [];
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const get = (f) => (f in map && map[f] !== null && map[f] !== '' ? row[map[f]] : '');
    const name = cellText(get('drug_name'));
    if (!name || typeof get('drug_name') === 'number') continue;
    const warnings = [], notes = [];
    const { qty, rest } = parseQty(get('quantity'));
    let unit = cellText(get('unit'));
    if (rest && !unit && /^[\p{L}\s.]{1,20}$/u.test(rest)) unit = rest;
    else if (rest) { warnings.push('العدد'); notes.push('العدد في الملف: ' + cellText(get('quantity'))); }
    const rawExp = get('expiry_date');
    const exp = parseExpiry(rawExp);
    if (cellText(rawExp) && !exp) { warnings.push('تاريخ الصلاحية'); notes.push('الصلاحية في الملف: ' + cellText(rawExp)); }
    const n = cellText(get('notes'));
    if (n) notes.unshift(n);
    items.push({ row: r + 1, drug_name: name.slice(0, 200), quantity: qty, unit: unit.slice(0, 40) || null, expiry_date: exp,
      status: parseStatus(get('status'), qty), notes: notes.join(' · ').slice(0, 500) || null, warnings });
  }
  return items;
}

// حالة الصلاحية للعرض
export function expiryState(isoDate) {
  if (!isoDate) return null;
  const d = daysUntil(isoDate);
  if (d < 0) return 'expired';
  if (d <= 90) return 'soon';
  return 'ok';
}
export { todayISO };
