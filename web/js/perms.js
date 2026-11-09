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
  // الصيدلية الداخلية: الكل يقرأ
  editInventory: ['internal_pharmacist'],     // ومعهم المدير أياً كان دوره
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

// طبيب الاختصاص يرى مرضاه فقط (المريض الذي هو طبيبه المختص): قائمة المرضى، وجلسات اليوم والمتأخرة والمواعيد،
// والجرعات بانتظار اعتماده، وطلبات التعديل. عدد مرضى المركز الكلي يبقى ظاهراً للجميع.
// المدير يرى الجميع حتى وهو يعمل بدور طبيب الاختصاص (يقرّر عن الأطباء الذين لم ينضموا بعد).
export const onlyMine = () => state.profile?.role === 'specialist' && !state.profile.is_admin;
// يضيف شرط «مرضاي» لاستعلام على cycles فيه treatments!inner(patients!inner(...))
export const mineCycles = (x) => (onlyMine() ? x.eq('treatments.patients.specialist_id', state.profile.id) : x);
