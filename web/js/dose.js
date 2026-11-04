// حساب الجرعات وعرضها. مطابق للدالة _calc_dose في قاعدة البيانات حرفياً،
// والقاعدة هي المرجع: هذا للمعاينة قبل الحفظ فقط.
import { h } from './ui.js';

export const UNITS = {
  'mg/m2': 'ملغ/م²', 'mg/kg': 'ملغ/كغ', mg: 'ملغ', 'units/m2': 'وحدة/م²', units: 'وحدة', AUC: 'AUC (Carboplatin)',
};
export const OUT_UNITS = { mg: 'ملغ', units: 'وحدة' };
export const ROUTES = ['IV', 'SC', 'PO', 'IM', 'IT'];
export const ROUTE_AR = { IV: 'وريدي', SC: 'تحت الجلد', PO: 'فموي', IM: 'عضلي', IT: 'داخل القراب' };

// تصفية الكرياتينين بمعادلة Cockcroft-Gault، مقصوصة عند 125 (مطابقة للدالة _crcl)
export function crclCG({ age, sex, weight, scr }) {
  if (!(age > 0) || !sex || !(weight > 0) || !(scr > 0)) return null;
  const raw = Math.round((140 - age) * weight * (sex === 'female' ? 0.85 : 1) / (72 * scr));
  return { raw, crcl: Math.min(Math.max(raw, 0), 125) };
}
export const ageYears = (birth, on = new Date()) => {
  if (!birth) return null;
  const b = new Date(birth + 'T00:00:00');
  let a = on.getFullYear() - b.getFullYear();
  if (on.getMonth() < b.getMonth() || (on.getMonth() === b.getMonth() && on.getDate() < b.getDate())) a--;
  return a;
};
// الكرياتينين بوحدة mg/dL (تُحوَّل µmol/L بالقسمة على 88.4)
export const scrMgDl = (l) => (l ? (/mol/i.test(l.unit || '') ? Math.round(Number(l.value) / 88.4 * 100) / 100 : Number(l.value)) : null);

// crcl: لجرعات AUC فقط (Calvert: AUC × (CrCl + 25))
export function calcDose(value, unit, bsa, weight, max, crcl) {
  if (unit === 'AUC') {
    const calculated = crcl == null ? null : Math.round(value * (crcl + 25));
    const capped = calculated != null && max != null && max !== '' && calculated > Number(max);
    return { calculated, final: capped ? Number(max) : calculated, finalUnit: 'mg', capped };
  }
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
  if (d.length === 1) return `الدورة ${d[0]} فقط`;
  if (/^\d+-\d+$/.test(String(s).replace(/\s/g, ''))) return `الدورات ${d[0]} إلى ${d[d.length - 1]}`;
  return 'الدورات ' + d.join('، ');
}
export const withCycles = (d) => (d.cycles ? ' · ' + cyclesText(d.cycles) : '');

// تعليمات الجرعة (التكرار والتقسيم والشروط) تظهر بارزة تحت الدواء
export function instrLine(d) {
  return d && d.instructions ? h('span', { class: 'dose-ins', text: d.instructions }) : null;
}

export const num = (n) => (n === null || n === undefined || n === '' ? '—' : String(Number(n)));

// سطر طريقة الحساب: 375 ملغ/م² × 1.82 م² = 683 ملغ
export function calcLine(d, bsa, weight) {
  if (!d.dose_unit || d.dose_value == null) return 'جرعة ثابتة';
  if (d.dose_unit === 'AUC') return d.calc_note || `AUC ${num(d.dose_value)} × (CrCl + 25)`;
  if (d.dose_unit === 'mg' || d.dose_unit === 'units') return `جرعة ثابتة ${num(d.dose_value)} ${UNITS[d.dose_unit]}`;
  const base = d.dose_unit.endsWith('/m2') ? `${num(bsa)} م²` : `${num(weight)} كغ`;
  return `${num(d.dose_value)} ${UNITS[d.dose_unit]} × ${base} = ${num(d.calculated)} ${OUT_UNITS[d.final_unit] || ''}`;
}

// سطر حساب AUC: المعادلة سطراً من اليسار إلى اليمين، ثم الكرياتينين وتاريخه
const LTR = 'display: block; direction: ltr; unicode-bidi: isolate; text-align: right';
export function aucCalc(d) {
  const [formula, ...rest] = String(d.calc_note || `AUC ${num(d.dose_value)} × (CrCl + 25)`).split(' · ');
  return h('span', { class: 's' }, h('span', { style: LTR, text: formula }), rest.length ? h('span', { style: 'display: block', text: rest.join(' · ') }) : null);
}
export const ltrLine = (text) => h('span', { style: LTR, text });

export function doseBig(value, unit) {
  return h('span', { class: 'dose-big' }, h('b', { class: 'ltr', text: num(value) }), ' ', h('span', { text: OUT_UNITS[unit] || unit }));
}
