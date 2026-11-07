// حساب الجرعات وعرضها. مطابق للدالة _calc_dose في قاعدة البيانات حرفياً،
// والقاعدة هي المرجع: هذا للمعاينة قبل الحفظ فقط.
import { h } from './ui.js';

export const UNITS = {
  'mg/m2': 'ملغ/م²', 'mg/kg': 'ملغ/كغ', mg: 'ملغ', 'units/m2': 'وحدة/م²', units: 'وحدة',
};
export const OUT_UNITS = { mg: 'ملغ', units: 'وحدة' };
export const ROUTES = ['IV', 'SC', 'PO', 'IM', 'IT'];
export const ROUTE_AR = { IV: 'وريدي', SC: 'تحت الجلد', PO: 'فموي', IM: 'عضلي', IT: 'داخل القراب' };

export function calcDose(value, unit, bsa, weight, max) {
  let calculated = unit === 'mg/m2' || unit === 'units/m2' ? value * bsa : unit === 'mg/kg' ? value * weight : value;
  // التقريب للجرعة المحسوبة من المساحة أو الوزن فقط؛ الثابتة تبقى كما كُتبت
  if (unit === 'mg/m2' || unit === 'units/m2' || unit === 'mg/kg') calculated = calculated >= 10 ? Math.round(calculated) : Math.round(calculated * 10) / 10;
  const finalUnit = unit === 'units/m2' || unit === 'units' ? 'units' : 'mg';
  const capped = max != null && max !== '' && calculated > Number(max);
  return { calculated, final: capped ? Number(max) : calculated, finalUnit, capped };
}

// '1,15' أو '1-5' أو '1,4,8,11' (مطابق لـ days_list)
export function daysList(s) {
  const out = [];
  for (const part of String(s || '1').replace(/\s/g, '').split(',')) {
    let m;
    if ((m = part.match(/^(\d+)-(\d+)$/))) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    else if (/^\d+$/.test(part)) out.push(Number(part));
  }
  return out;
}
export function validDays(s, cycleLen) {
  const t = String(s || '').replace(/\s/g, '');
  if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(t)) return false;
  const d = daysList(t);
  return d.length > 0 && d.every((x) => x >= 1 && (!cycleLen || x <= cycleLen));
}
export function daysText(s) {
  const d = daysList(s);
  if (d.length === 1) return `اليوم ${d[0]}`;
  if (/^\d+-\d+$/.test(String(s).replace(/\s/g, ''))) return `الأيام ${d[0]} إلى ${d[d.length - 1]}`;
  return 'الأيام ' + d.join('، ');
}

// الدورات التي يُعطى فيها الدواء (فارغ = كل الدورات)
export function cyclesText(s) {
  if (!s) return '';
  const d = daysList(s);
  if (d.length === 1) return `الجرعة ${d[0]} فقط`;
  if (/^\d+-\d+$/.test(String(s).replace(/\s/g, ''))) return `الجرعات ${d[0]} إلى ${d[d.length - 1]}`;
  return 'الجرعات ' + d.join('، ');
}
export const withCycles = (d) => (d.cycles ? ' · ' + cyclesText(d.cycles) : '');

// تعليمات الجرعة (التكرار والتقسيم والشروط) تظهر بارزة تحت الدواء
export function instrLine(d) {
  return d && d.instructions ? h('span', { class: 'dose-ins', text: d.instructions }) : null;
}

export const num = (n) => (n === null || n === undefined || n === '' ? '—' : String(Number(n)));

// سطر طريقة الحساب: 375 ملغ/م² × 1.82 م² = 683 ملغ
export function calcLine(d, bsa, weight) {
  if (!d.dose_unit || d.dose_value == null) return 'جرعة دوائية ثابتة';
  if (d.dose_unit === 'mg' || d.dose_unit === 'units') return `جرعة دوائية ثابتة ${num(d.dose_value)} ${UNITS[d.dose_unit]}`;
  const base = d.dose_unit.endsWith('/m2') ? `${num(bsa)} م²` : `${num(weight)} كغ`;
  return `${num(d.dose_value)} ${UNITS[d.dose_unit]} × ${base} = ${num(d.calculated)} ${OUT_UNITS[d.final_unit] || ''}`;
}

export function doseBig(value, unit) {
  return h('span', { class: 'dose-big' }, h('b', { class: 'ltr', text: num(value) }), ' ', h('span', { text: OUT_UNITS[unit] || unit }));
}

// ------------------------------------------------------------------ حالة الجرعة في المزج
// تحمّل لكل جرعة: الأيام التي حُضّرت ولم تُرسل، والتي أُرسلت ولم تُعطَ.
// الجرعة المحضّرة أو المرسلة غير المعطاة لا تُعدَّل (تمنعها القاعدة أيضاً، الملف 21)، ويظهر ذلك للجميع.
export async function loadMixState(sb, q, doseIds) {
  const map = new Map();
  if (!doseIds.length) return map;
  const [items, given] = await Promise.all([
    q(sb.from('mixing_items').select('cycle_dose_id, prepared_at, sent_at, mixing_orders!inner(day)').in('cycle_dose_id', doseIds)),
    q(sb.from('administrations').select('cycle_dose_id, day').in('cycle_dose_id', doseIds)),
  ]);
  for (const it of items) {
    const day = it.mixing_orders.day;
    const done = given.some((g) => g.cycle_dose_id === it.cycle_dose_id && g.day === day);
    if (done) continue;
    const s = map.get(it.cycle_dose_id) || { prepared: [], sent: [] };
    if (it.sent_at) s.sent.push(day); else if (it.prepared_at) s.prepared.push(day);
    map.set(it.cycle_dose_id, s);
  }
  for (const s of map.values()) { s.sent.sort((a, b) => a - b); s.prepared.sort((a, b) => a - b); s.locked = s.sent.length > 0 || s.prepared.length > 0; }
  return map;
}

const daysWord = (arr) => (arr.length === 1 ? `اليوم ${arr[0]}` : `الأيام ${arr.join('، ')}`);
// نص الملاحظة كما يراها الجميع، أو null
export function mixNote(s) {
  if (!s) return null;
  const parts = [];
  if (s.sent.length) parts.push(`حُضّرت وأُرسلت من المزج (${daysWord(s.sent)}) ولم تُعطَ بعد: لا تُعدَّل`);
  if (s.prepared.length) parts.push(`حضّرها صيدلي المزج (${daysWord(s.prepared)}) ولم تُرسل بعد: لا تُعدَّل إلا بعد أن يزيل صيدلي المزج علامة التحضير`);
  return parts.length ? parts.join(' · ') : null;
}
