// قوالب التحاليل الشائعة في مراكز أمراض الدم، بمراجع البالغين المعتادة.
// المراجع تختلف بين المختبرات: تظهر جاهزة ويمكن تعديلها عند الإدخال لتطابق ورقة المختبر.
export const PANELS = [
  { id: 'cbc', label: 'تعداد الدم', tests: [
    { name: 'WBC', unit: '×10⁹/L', low: 4.0, high: 11.0 },
    { name: 'ANC', unit: '×10⁹/L', low: 1.5, high: 8.0 },
    { name: 'Hb', unit: 'g/dL', low: { male: 13.5, female: 12.0 }, high: { male: 17.5, female: 15.5 } },
    { name: 'PLT', unit: '×10⁹/L', low: 150, high: 400 },
  ] },
  { id: 'renal', label: 'الكلى', tests: [
    { name: 'Creatinine', unit: 'mg/dL', low: { male: 0.7, female: 0.6 }, high: { male: 1.3, female: 1.1 } },
    { name: 'Urea', unit: 'mg/dL', low: 15, high: 45 },
    { name: 'Uric acid', unit: 'mg/dL', low: { male: 3.4, female: 2.4 }, high: { male: 7.0, female: 6.0 } },
  ] },
  { id: 'liver', label: 'الكبد', tests: [
    { name: 'ALT', unit: 'U/L', low: 0, high: 40 },
    { name: 'AST', unit: 'U/L', low: 0, high: 40 },
    { name: 'T. Bilirubin', unit: 'mg/dL', low: 0.1, high: 1.2 },
    { name: 'ALP', unit: 'U/L', low: 40, high: 130 },
  ] },
  { id: 'other', label: 'أخرى', tests: [
    { name: 'LDH', unit: 'U/L', low: 140, high: 280 },
    { name: 'Ferritin', unit: 'ng/mL', low: { male: 30, female: 15 }, high: { male: 400, female: 150 } },
    { name: 'K', unit: 'mmol/L', low: 3.5, high: 5.1 },
    { name: 'Ca', unit: 'mg/dL', low: 8.5, high: 10.5 },
  ] },
];

export const CBC = ['WBC', 'ANC', 'Hb', 'PLT'];

export function ref(t, sex) {
  const pick = (v) => (v && typeof v === 'object' ? v[sex] ?? v.male : v);
  return { low: pick(t.low), high: pick(t.high) };
}

export function flag(value, low, high) {
  if (value == null || value === '') return null;
  const v = Number(value);
  if (low != null && v < Number(low)) return 'low';
  if (high != null && v > Number(high)) return 'high';
  return 'ok';
}

// ------------------------------------------------------------------ درجة الشدة حسب CTCAE v5.0
// المرجع: Common Terminology Criteria for Adverse Events v5.0 (NCI، 2017). القيم بوحدات التطبيق.
// الدرجة وصف لشدة الانحراف، وليست قراراً علاجياً: قرار الإعطاء أو التأجيل للطبيب حسب البروتوكول.
const ALIAS = { platelets: 'PLT', platelet: 'PLT', hgb: 'Hb', hemoglobin: 'Hb', haemoglobin: 'Hb', neutrophils: 'ANC', tlc: 'WBC',
  'total bilirubin': 'T. Bilirubin', bilirubin: 'T. Bilirubin', creatinine: 'Creatinine', potassium: 'K', calcium: 'Ca' };
export const testKey = (name) => ALIAS[String(name || '').trim().toLowerCase()] || name;

export const GRADE_AR = { 1: 'خفيف', 2: 'متوسط', 3: 'شديد', 4: 'مهدد للحياة' };

// يرجع { grade, label, what } أو null إن لم ينطبق
export function ctcae(name, value, low, high) {
  const v = Number(value), t = testKey(name);
  const lo = low == null || low === '' ? null : Number(low), hi = high == null || high === '' ? null : Number(high);
  const below = (cuts, what) => {                 // cuts: حدود الدرجات 2 و3 و4 تنازلياً
    if (lo == null || !(v < lo)) return null;
    const g = v < cuts[2] ? 4 : v < cuts[1] ? 3 : v < cuts[0] ? 2 : 1;
    return { grade: g, what };
  };
  const timesUln = (cuts, what) => {             // cuts: مضاعفات الحد الأعلى للدرجات 2 و3 و4
    if (hi == null || !(v > hi)) return null;
    const r = v / hi;
    const g = r > cuts[2] ? 4 : r > cuts[1] ? 3 : r > cuts[0] ? 2 : 1;
    return { grade: g, what };
  };
  let res = null;
  switch (t) {
    case 'ANC': res = below([1.5, 1.0, 0.5], 'نقص العدلات'); break;
    case 'PLT': res = below([75, 50, 25], 'نقص الصفيحات'); break;
    case 'WBC':
      res = below([3.0, 2.0, 1.0], 'نقص كريات الدم البيض');
      if (!res && v > 100) res = { grade: 3, what: 'فرط كريات الدم البيض' };
      break;
    case 'Hb':
      if (lo != null && v < lo) res = { grade: v < 8 ? 3 : v < 10 ? 2 : 1, what: 'فقر الدم' };
      break;
    case 'Creatinine': res = timesUln([1.5, 3, 6], 'ارتفاع الكرياتينين'); break;
    case 'ALT': res = timesUln([3, 5, 20], 'ارتفاع ALT'); break;
    case 'AST': res = timesUln([3, 5, 20], 'ارتفاع AST'); break;
    case 'T. Bilirubin': res = timesUln([1.5, 3, 10], 'ارتفاع البيليروبين'); break;
    case 'ALP': res = timesUln([2.5, 5, 20], 'ارتفاع ALP'); break;
    case 'K':
      if (lo != null && v < lo) res = { grade: v < 2.5 ? 4 : v < 3.0 ? 3 : 1, what: 'نقص البوتاسيوم' };
      else if (hi != null && v > hi) res = { grade: v > 7 ? 4 : v > 6 ? 3 : v > 5.5 ? 2 : 1, what: 'فرط البوتاسيوم' };
      break;
    case 'Ca':
      if (lo != null && v < lo) res = { grade: v < 6 ? 4 : v < 7 ? 3 : v < 8 ? 2 : 1, what: 'نقص الكالسيوم' };
      else if (hi != null && v > hi) res = { grade: v > 13.5 ? 4 : v > 12.5 ? 3 : v > 11.5 ? 2 : 1, what: 'فرط الكالسيوم' };
      break;
    default: return null;
  }
  if (!res) return null;
  return { ...res, label: `الدرجة ${res.grade} (${GRADE_AR[res.grade]})` };
}
