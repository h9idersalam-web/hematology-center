// من يستطيع ماذا في الواجهة. هذا لإخفاء الأزرار فقط؛
// الحماية الحقيقية في دوال قاعدة البيانات، وهي ترفض أي إجراء خارج الصلاحية.
// state.profile.role هو الدور الفعلي: الرديف المفعّل يظهر هنا مسؤولاً للصيادلة.
import { state } from './app.js';

const RULES = {
  editPatient: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist'],
  archivePatient: ['specialist'],
  postpone: ['specialist', 'senior_resident', 'chief_clinical_pharmacist'],
  createProtocol: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist'],
  approveProtocol: ['specialist'],
  // أرشفة البروتوكول واستبدال ملفه المعتمد: ومعهم مدير البرنامج (is_admin) أياً كان دوره
  manageProtocol: ['specialist', 'chief_clinical_pharmacist'],
  createPlan: ['specialist', 'senior_resident', 'chief_clinical_pharmacist'],
  approvePlan: ['specialist'],          // والطبيب المختص بالمريض حصراً، يُتحقق منه في الشاشة
  stopPlan: ['specialist', 'senior_resident'],
  approveCycle: ['specialist', 'senior_resident'],
  chart: ['clinical_pharmacist', 'chief_clinical_pharmacist'],
  doctorEdit: ['specialist', 'senior_resident'],
  requestEdit: ['clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist'],
  decide: ['specialist', 'senior_resident', 'chief_clinical_pharmacist'],   // التفصيل في can_decide_request
  completeCycle: ['specialist', 'senior_resident', 'chief_clinical_pharmacist'],
  upload: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist', 'nurse'],
  labs: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'nurse'],
  prepare: ['mixing_pharmacist'],
  administer: ['nurse'],
  seeMixing: ['clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist', 'specialist', 'senior_resident'],
  seeNursing: ['nurse', 'specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist'],
  // التقارير: الكل يقرأ
  editInventory: ['internal_pharmacist'],     // ومعهم المدير أياً كان دوره
  writeHandover: ['clinical_pharmacist', 'chief_clinical_pharmacist'],
  seeRequests: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist'],
};

export const role = () => state.profile?.role;

export function can(action) {
  const p = state.profile;
  if (!p) return false;
  if ((action === 'manageProtocol' || action === 'editInventory') && p.is_admin) return true;
  // تفعيل صلاحيات الرديف: لمسؤول الصيادلة الأصلي فقط، لا للرديف نفسه
  if (action === 'toggleDeputy') return p.base_role === 'chief_clinical_pharmacist' || (p.is_admin && p.role === 'chief_clinical_pharmacist');
  return (RULES[action] || []).includes(p.role);
}
