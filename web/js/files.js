// رفع ملفات المرضى إلى الحاوية الخاصة وفتحها بروابط مؤقتة.
// الحاوية خاصة: لا رابط دائم لأي ملف، والرابط المؤقت يصلح 10 دقائق فقط.
import { sb, rpc } from './api.js';

export const BUCKET = 'patient-files';
export const KINDS = {
  lab: ['تحليل', 'file'],
  prescription: ['وصفة طبية', 'pill'],
  id_card: ['ملف تعريف المريض', 'users'],
  imaging: ['أشعة أو صورة', 'file'],
  report: ['تقرير طبي', 'file'],
  other: ['أخرى', 'file'],
};
const MAX = 10 * 1024 * 1024;
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

// تصغير صور الهاتف قبل الرفع: أطول ضلع 2000 بكسل بصيغة JPEG
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export function checkFile(file) {
  if (!file) return 'اختر ملفاً';
  const type = file.type || (/\.heic$/i.test(file.name) ? 'image/heic' : '');
  if (!OK_TYPES.includes(type)) return 'نوع الملف غير مدعوم. المسموح: صورة (JPG أو PNG أو HEIC) أو PDF';
  if (file.size > MAX * 3) return 'الملف كبير جداً (الحد 10 ميغابايت)';
  return null;
}

// يرفع الملف ثم يسجّله في ملف المريض، ويعيد معرّف المرفق
export async function uploadAttachment(patientId, file, { kind, title, takenOn } = {}) {
  const bad = checkFile(file);
  if (bad) throw new Error(bad);
  const f = await shrink(file);
  if (f.size > MAX) throw new Error('الملف أكبر من 10 ميغابايت حتى بعد الضغط. صوّره بدقة أقل أو قسّمه.');
  const type = f.type || 'image/heic';
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' }[type];
  const path = `patients/${patientId}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, await f.arrayBuffer(), { contentType: type, upsert: false });
  if (error) throw new Error(/row-level security|unauthorized|403/i.test(error.message) ? 'ليست لديك صلاحية رفع الملفات' : 'تعذّر رفع الملف: ' + error.message);
  return rpc('add_attachment', { p_patient: patientId, p_kind: kind, p_file_path: path, p_title: title || null, p_taken_on: takenOn || null });
}

export async function signedUrl(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) throw new Error('تعذّر فتح الملف');
  return data.signedUrl;
}

export async function openFile(path) {
  const w = window.open('', '_blank');
  try { const url = await signedUrl(path); if (w) w.location = url; else location.href = url; }
  catch (e) { if (w) w.close(); throw e; }
}

export const isImage = (path) => /\.(jpe?g|png|webp)$/i.test(path);
