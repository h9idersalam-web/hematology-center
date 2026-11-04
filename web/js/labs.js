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
