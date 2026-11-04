// من يستطيع ماذا في الواجهة. هذا لإخفاء الأزرار فقط؛
// الحماية الحقيقية في دوال قاعدة البيانات، وهي ترفض أي إجراء خارج الصلاحية.
import { state } from './app.js';

const RULES = {
  editPatient: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist'],
  archivePatient: ['specialist'],
  postpone: ['specialist', 'senior_resident'],
};

export function can(action) {
  const p = state.profile;
  return !!p && (RULES[action] || []).includes(p.role);
}
