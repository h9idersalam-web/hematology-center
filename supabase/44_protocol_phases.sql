-- =====================================================================
-- 44: مراحل البروتوكولات (بطلب صاحب المشروع 2026/11/9، الخيار 3)
--   - لكل بروتوكول: المجموعة (regimen، مثل UKALL14) والمرحلة (phase) وترتيبها في المجموعة (phase_order).
--     بروتوكولان بالترتيب نفسه في مجموعة = بديلان للمرحلة نفسها (مثل HD-MTX أو بديله في UKALL2011).
--   - set_protocol_phase: لطبيب الاختصاص ومسؤول الصيادلة ومدير البرنامج (بيانات وصفية، لا تمسّ الجرعات).
--   - next_phase_plan: بعد انتهاء مرحلة المريض تُنشأ خطة المرحلة التالية بضغطة (بالتشخيص والحالة والدرجة نفسها).
--   لا أوامر drop ولا حذف بيانات.
-- =====================================================================
alter table public.protocols add column if not exists regimen text;
alter table public.protocols add column if not exists phase text
  check (phase in ('induction', 'consolidation', 'interim_maintenance', 'intensification', 'maintenance', 'other'));
alter table public.protocols add column if not exists phase_order int check (phase_order between 1 and 50);

-- تعبئة البروتوكولات متعددة المراحل الموجودة
with m(name, regimen, phase, ord) as (values
  ('UKALL14 Induction Phase 1', 'UKALL14', 'induction', 1),
  ('UKALL14 Induction Phase 2', 'UKALL14', 'induction', 2),
  ('UKALL14 Consolidation 1 & 2', 'UKALL14', 'consolidation', 3),
  ('UKALL14 Consolidation 3', 'UKALL14', 'consolidation', 4),
  ('UKALL14 Consolidation 4', 'UKALL14', 'consolidation', 5),
  ('UKALL14 Maintenance', 'UKALL14', 'maintenance', 6),
  ('UKALL2011 Induction Phase 1', 'UKALL2011', 'induction', 1),
  ('UKALL2011 Induction Phase 2', 'UKALL2011', 'induction', 2),
  ('UKALL2011 High-dose MTX', 'UKALL2011', 'interim_maintenance', 3),
  ('UKALL2011 Interim Maintenance (alternative to HD-MTX)', 'UKALL2011', 'interim_maintenance', 3),
  ('UKALL2011 Delayed Intensification', 'UKALL2011', 'intensification', 4),
  ('UKALL60+ Induction & Consolidation (Arm D)', 'UKALL60+', 'induction', 1),
  ('UKALL60+ Maintenance (Arm D)', 'UKALL60+', 'maintenance', 2),
  ('APL Pediatric AIDA2000: Induction', 'APL AIDA2000', 'induction', 1),
  ('APL Pediatric AIDA2000: Consolidation', 'APL AIDA2000', 'consolidation', 2),
  ('APL Pediatric AIDA2000: Maintenance', 'APL AIDA2000', 'maintenance', 3),
  ('APL: ATRA + ATO Induction', 'APL ATRA + ATO', 'induction', 1),
  ('APL: ATRA + ATO Consolidation', 'APL ATRA + ATO', 'consolidation', 2),
  ('Ven + CLAD/LDAC Induction', 'Ven + CLAD/LDAC', 'induction', 1),
  ('Ven + CLAD/LDAC Consolidation', 'Ven + CLAD/LDAC', 'consolidation', 2),
  ('Ven + Azacitidine Consolidation', 'Ven + CLAD/LDAC', 'consolidation', 2),
  ('IBER', 'IBER', 'induction', 1),
  ('Ibrutinib Maintenance after IBER', 'IBER', 'maintenance', 2))
update public.protocols p set regimen = m.regimen, phase = m.phase, phase_order = m.ord
  from m where p.name = m.name and p.regimen is null;

-- تعديل المجموعة والمرحلة وترتيبها
create or replace function public.set_protocol_phase(p_id uuid, p_regimen text, p_phase text, p_order int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_protocol_manager();
  if p_phase is not null and p_phase not in ('induction', 'consolidation', 'interim_maintenance', 'intensification', 'maintenance', 'other') then
    raise exception 'المرحلة غير صحيحة';
  end if;
  if nullif(trim(coalesce(p_regimen, '')), '') is not null and p_order is null then raise exception 'حدّد ترتيب المرحلة في المجموعة'; end if;
  update protocols set regimen = nullif(trim(coalesce(p_regimen, '')), ''), phase = p_phase,
                       phase_order = case when nullif(trim(coalesce(p_regimen, '')), '') is null then null else p_order end
   where id = p_id;
  if not found then raise exception 'البروتوكول غير موجود'; end if;
end $$;
revoke all on function public.set_protocol_phase(uuid, text, text, int) from public, anon;
grant execute on function public.set_protocol_phase(uuid, text, text, int) to authenticated;

-- خطة المرحلة التالية بعد انتهاء المرحلة الحالية للمريض
create or replace function public.next_phase_plan(p_patient uuid, p_protocol uuid, p_start date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_last treatments; v_cur protocols; v_next protocols;
begin
  if exists (select 1 from treatments where patient_id = p_patient and status in ('active', 'pending_approval')) then
    raise exception 'للمريض خطة قائمة: أكمل المرحلة الحالية أولاً';
  end if;
  select * into v_last from treatments where patient_id = p_patient and status = 'completed' order by created_at desc limit 1;
  if v_last.id is null then raise exception 'لا توجد مرحلة منتهية لهذا المريض'; end if;
  select * into v_cur from protocols where id = v_last.protocol_id;
  if v_cur.regimen is null then raise exception 'البروتوكول السابق ليس ضمن مجموعة مراحل'; end if;
  select * into v_next from protocols where id = p_protocol and archived_at is null;
  if v_next.id is null or v_next.regimen is distinct from v_cur.regimen or v_next.phase_order <= v_cur.phase_order then
    raise exception 'هذا البروتوكول ليس مرحلة تالية في %', v_cur.regimen;
  end if;
  if v_next.approved_by is null then raise exception 'المرحلة التالية (%) غير معتمدة بعد', v_next.name; end if;
  return create_plan_at(p_patient, v_next.id, v_last.diagnosis, v_last.icd10, v_last.stage, p_start, v_last.disease_status, null, 1);
end $$;
revoke all on function public.next_phase_plan(uuid, uuid, date) from public, anon;
grant execute on function public.next_phase_plan(uuid, uuid, date) to authenticated;
