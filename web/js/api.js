// الاتصال بـ Supabase وترجمة الأخطاء
import { terms } from './terms.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_KEY.startsWith('YOUR-');

export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

const AUTH_ERRORS = [
  [/invalid login credentials/i, 'البريد أو كلمة المرور غير صحيحة'],
  [/user is banned|user_banned/i, 'هذا الحساب محذوف أو محظور. راجع إدارة المركز'],
  [/already registered|already been registered|user already exists/i, 'هذا البريد مسجّل من قبل، سجّل الدخول بدلاً من ذلك'],
  [/password should be at least|weak password/i, 'كلمة المرور قصيرة أو ضعيفة، استخدم 8 أحرف على الأقل'],
  [/unable to validate email|invalid email|email address .* is invalid/i, 'صيغة البريد غير صحيحة'],
  [/email not confirmed/i, 'لم يُؤكَّد بريدك بعد. افتح رسالة التأكيد في بريدك، أو أبلغ إدارة المركز'],
  [/signups? not allowed|signup is disabled/i, 'إنشاء الحسابات متوقف حالياً، راجع إدارة المركز'],
  [/rate limit|too many requests/i, 'محاولات كثيرة، انتظر دقيقة ثم أعد المحاولة'],
  [/failed to fetch|network|load failed/i, 'تعذّر الاتصال بالخادم، تحقق من الإنترنت'],
  [/jwt expired|invalid jwt/i, 'انتهت الجلسة، سجّل الدخول مجدداً'],
  [/protocols_name_key/i, 'يوجد بروتوكول بهذا الاسم من قبل، اختر اسماً مميزاً (مثلاً أضف رقم النسخة)'],
  [/duplicate key/i, 'هذا السجل موجود من قبل'],
  [/violates check constraint/i, 'إحدى القيم خارج الحدود المسموحة، راجع الأرقام المدخلة'],
];

export function errMsg(err) {
  const m = (err && (err.message || err.error_description || err.msg)) || String(err || '');
  for (const [re, ar] of AUTH_ERRORS) if (re.test(m)) return ar;
  if (/[؀-ۿ]/.test(m)) return terms(m);   // رسائل قاعدة البيانات عربية أصلاً، بالمصطلحات المعتمدة
  if (err && err.code === '42501') return 'ليست لديك صلاحية لهذا الإجراء';
  return 'حدث خطأ غير متوقع: ' + m;
}

// استدعاء دالة في قاعدة البيانات مع رفع الخطأ برسالة عربية
export async function rpc(name, params) {
  const { data, error } = await sb.rpc(name, params || {});
  if (error) throw new Error(errMsg(error));
  return data;
}

// تنفيذ استعلام وإرجاع البيانات، أو رفع الخطأ برسالة عربية
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(errMsg(error));
  return data;
}

export async function countOf(table, build) {
  let query = sb.from(table).select('id', { count: 'exact', head: true });
  if (build) query = build(query);
  const { count, error } = await query;
  if (error) throw new Error(errMsg(error));
  return count || 0;
}
