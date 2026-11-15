// الأقسام القابلة للإيقاف مؤقتاً (الملف 47): المزج والتمريض، وصورة الطبلة (الملف 48).
// يشغّلها المدير أو يوقفها من «لوحة المدير › الأقسام». برمجة القسم وبياناته تبقى كاملة وهو موقوف.
// قبل تطبيق الملف 47 على القاعدة (لا توجد get_features) تعمل كل الأقسام كما كانت.
import { sb } from './api.js';

export const features = { mixing: true, nursing: true, chart: true };
let loadedAt = 0;

export async function loadFeatures(force = false) {
  if (!force && Date.now() - loadedAt < 30000) return features;
  try {
    const { data, error } = await sb.rpc('get_features');
    if (!error && data && typeof data === 'object') Object.assign(features, data);
  } catch { /* بلا اتصال: يبقى آخر ما عُرف */ }
  loadedAt = Date.now();
  return features;
}

export const on = (key) => features[key] !== false;

// الدور الذي قسمه موقوف لا يُسند ولا يظهر في قوائم الاختيار
export const ROLE_FEATURE = { nurse: 'nursing', mixing_pharmacist: 'mixing' };
export const roleOn = (role) => !ROLE_FEATURE[role] || on(ROLE_FEATURE[role]);

export const FEATURE_INFO = {
  mixing: { label: 'قسم المزج الكيميائي', role: 'صيدلي المزج الكيميائي', icon: 'pill',
    off: 'لا تُرسل الجرعات المعتمدة إلى المزج، ولا تحضير ولا إرسال، وطلبات المزج المفتوحة محفوظة مجمّدة.',
    onText: 'تصل كل جرعة يعتمدها الطبيب إلى المزج تلقائياً، ومنها الجرعات المعتمدة المفتوحة الآن.' },
  nursing: { label: 'قسم التمريض', role: 'ممرض', icon: 'check',
    off: '«تم إعطاء الجرعة بالكامل» يؤكده الطبيب أو المقيم الأقدم أو مسؤول الصيادلة أو الصيدلي السريري، بلا تسجيل إعطاء لكل دواء.',
    onText: 'يسجّل الممرض إعطاء كل دواء والعلامات الحيوية والتفاعلات، ثم يؤكد اكتمال اليوم.' },
  chart: { label: 'صورة الطبلة', role: null, icon: 'file',
    off: 'لا يُطلب من الصيدلي السريري إرفاق صورة الجرعة من طبلة المريض، ولا تُرفق صور جديدة. الصور المرفقة من قبل باقية.',
    onText: 'بعد اعتماد الطبيب يُطلب من الصيدلي السريري إرفاق صورة الجرعة من طبلة المريض (مهمة في الرئيسية وإشعار).' },
};
