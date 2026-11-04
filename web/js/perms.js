// من يستطيع ماذا في الواجهة. هذا لإخفاء الأزرار فقط؛
// الحماية الحقيقية في دوال قاعدة البيانات، وهي ترفض أي إجراء خارج الصلاحية.
import { state } from './app.js';

const RULES = {
  editPatient: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist'],
  archivePatient: ['specialist'],
  postpone: ['specialist', 'senior_resident'],
  createProtocol: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist'],
  approveProtocol: ['specialist'],
  createPlan: ['specialist', 'senior_resident', 'chief_clinical_pharmacist'],
  approvePlan: ['specialist'],
  stopPlan: ['specialist', 'senior_resident'],
  approveCycle: ['specialist', 'senior_resident'],
  verifyCycle: ['clinical_pharmacist', 'chief_clinical_pharmacist'],
  doctorEdit: ['specialist', 'senior_resident'],
  requestEdit: ['clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist'],
  decide: ['specialist'],
  completeCycle: ['specialist', 'senior_resident', 'nurse'],
  upload: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist', 'nurse'],
  labs: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'nurse'],
  transfer: ['clinical_pharmacist', 'chief_clinical_pharmacist'],
  prepare: ['mixing_pharmacist'],
  administer: ['nurse'],
  seeMixing: ['clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist', 'specialist', 'senior_resident'],
  seeNursing: ['nurse', 'specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist'],
  seeRequests: ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist'],
};

export const role = () => state.profile?.role;

export function can(action) {
  const p = state.profile;
  return !!p && (RULES[action] || []).includes(p.role);
}
