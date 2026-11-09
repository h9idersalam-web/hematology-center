// قائمة التشخيصات بالاختصارات الإنكليزية (DLBCL، NHL، AML...)، واقتراحها حسب البروتوكول المختار (من حقل المرض المأخوذ من ملف البروتوكول).
// رمز ICD-10 لا يظهر في الشاشة، ويُحفظ تلقائياً مع التشخيص المختار.
const D = {   // [الاختصار المعروض، الاسم الكامل بالإنكليزية، ICD-10 يُحفظ تلقائياً]
  HL: ['HL', 'Classical Hodgkin lymphoma', 'C81.9'],
  NLPHL: ['NLPHL', 'Nodular lymphocyte predominant Hodgkin lymphoma', 'C81.0'],
  NHL: ['NHL', 'Non-Hodgkin lymphoma', 'C85.9'],
  DLBCL: ['DLBCL', 'Diffuse large B-cell lymphoma', 'C83.3'],
  HGBL: ['HGBL', 'High-grade B-cell lymphoma (MYC with BCL2 and/or BCL6)', 'C83.3'],
  PMBCL: ['PMBCL', 'Primary mediastinal large B-cell lymphoma', 'C85.2'],
  BURKITT: ['BL', 'Burkitt lymphoma', 'C83.7'],
  MCL: ['MCL', 'Mantle cell lymphoma', 'C83.1'],
  FL: ['FL', 'Follicular lymphoma', 'C82.9'],
  MZL: ['MZL', 'Marginal zone lymphoma', 'C88.4'],
  SLL: ['SLL/CLL', 'Small lymphocytic lymphoma / chronic lymphocytic leukaemia', 'C83.0'],
  LPL: ['LPL/WM', 'Lymphoplasmacytic lymphoma / Waldenström macroglobulinaemia', 'C88.0'],
  PCNSL: ['PCNSL', 'Primary CNS lymphoma', 'C83.3'],
  TNHL: ['PTCL', 'Peripheral T-cell lymphoma', 'C84.4'],
  LBL: ['LBL', 'Lymphoblastic lymphoma', 'C83.5'],
  BALL: ['B-ALL', 'B-cell acute lymphoblastic leukaemia', 'C91.0'],
  TALL: ['T-ALL', 'T-cell acute lymphoblastic leukaemia', 'C91.0'],
  AML: ['AML', 'Acute myeloid leukaemia', 'C92.0'],
  APL: ['APL', 'Acute promyelocytic leukaemia', 'C92.4'],
  CML: ['CML', 'Chronic myeloid leukaemia', 'C92.1'],
  HCL: ['HCL', 'Hairy cell leukaemia', 'C91.4'],
  MM: ['MM', 'Multiple myeloma', 'C90.0'],
  AA: ['AA', 'Aplastic anaemia', 'D61.9'],
  SCD: ['SCD', 'Sickle cell disease', 'D57.1'],
};
const NHL_B = ['NHL', 'DLBCL', 'FL', 'MCL', 'MZL', 'HGBL', 'PMBCL', 'BURKITT', 'TNHL'];
const LOW_GRADE = ['NHL', 'FL', 'MZL', 'SLL', 'LPL', 'MCL'];

// قواعد بالترتيب: كل قاعدة تضيف تشخيصاتها إن طابق نصُّ المرض أو اسمُ البروتوكول
const RULES = [
  [/الوشاح/, ['MCL']],
  [/بيركت|Burkitt/i, ['BURKITT']],
  [/المنصف/, ['PMBCL']],
  [/عالية الدرجة|MYC/, ['HGBL']],
  [/الجهاز العصبي|PCNSL/, ['PCNSL']],
  [/DLBCL|الخلايا البائية الكبيرة/, ['DLBCL']],
  [/منخفضة الدرجة|low grade/i, LOW_GRADE],
  [/لاهودجكي?ن|NHL|لاهودجكينية/, NHL_B, /منخفضة الدرجة|low grade/i],   // العامة لا تُضاف مع منخفضة الدرجة
  [/(^|[^ا])هودجكن|\bHL\b/, ['HL', 'NLPHL']],
  [/لمفوما منتكسة/, ['HL', ...NHL_B]],
  [/أرومية لمفاوية/, ['LBL']],
  [/APL|النقويات الحاد/, ['APL']],
  [/AML|ابيضاض نقوي حاد/, ['AML']],
  [/ALL|ابيضاض لمفاوي حاد/, ['BALL', 'TALL']],
  [/نقوي مزمن|CML|Imatinib/, ['CML']],
  [/المشعرة|HCL/, ['HCL']],
  [/الورم النقوي/, ['MM']],
  [/اللاتنسجي/, ['AA']],
  [/المنجلي/, ['SCD']],
];

export const OTHER = '__other__';
// يظهر الاختصار أولاً وبجانبه الاسم الكامل بالإنكليزية، ويُحفظ التشخيص بهذا الشكل نفسه
const item = (k) => ({ key: k, abbr: D[k][0], en: D[k][1], icd: D[k][2], label: `${D[k][0]} — ${D[k][1]}` });

// التشخيصات المقترحة لبروتوكول؛ إن لم يطابق شيء تُعرض كل القائمة
export function diagnosesFor(protocol) {
  const text = `${protocol?.disease || ''} ${protocol?.name || ''}`;
  const keys = [];
  for (const [re, ks, unless] of RULES) if (re.test(text) && !(unless && unless.test(text))) for (const k of ks) if (!keys.includes(k)) keys.push(k);
  return (keys.length ? keys : Object.keys(D)).map(item);
}
export const allDiagnoses = () => Object.keys(D).map(item);

// حالة المرض
export const STATUS = [['initial', 'Initial treatment'], ['relapse', 'Relapse'], ['maintenance', 'Maintenance']];
export const statusLabel = (v) => STATUS.find((x) => x[0] === v)?.[1] || null;
export function guessStatus(protocol) {
  const text = `${protocol?.disease || ''} ${protocol?.name || ''}`;
  if (/صيانة|maintenance/i.test(text)) return 'maintenance';
  if (/منتكس|مقاوم|إنقاذ|relaps|refractory|خط ثانٍ|علاج سابق/i.test(text) && !/علاج أولي أو منتكسة/.test(text)) return 'relapse';
  if (/حديث التشخيص|خط أول|تحريض|induction/i.test(text)) return 'initial';
  return null;
}

// درجة المرض
export const GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'];
