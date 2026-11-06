-- =====================================================================
--  إلغاء حساب AUC لـ Carboplatin (يتراجع عن الملف 11 الذي طُبّق على القاعدة)
--  Carboplatin يُحسب بالملغ/م² كبقية الأدوية.
--  - بروتوكولات Carboplatin الأربعة (TEC، Pola-R-ICE، ICE المجزأ، Pembro-ICE)
--    كانت غير معتمدة ولم تُستخدم لأي مريض، فتُؤرشف ويُغيَّر اسمها (الحذف ممنوع
--    في التطبيق) لتُعاد بجرعة ملغ/م² بأسمائها.
--  - يتوقف الملف إن وُجدت جرعة AUC في خطة مريض أو بروتوكول AUC معتمد أو مستخدم.
--  - قيد الوحدات الجديد NOT VALID: يمنع AUC في كل إدخال أو تعديل جديد، ويُبقي
--    أسطر البروتوكولات المؤرشفة كما هي للسجل.
--  آمن للتشغيل أكثر من مرة، وعلى قاعدة لم يُطبَّق عليها الملف 11.
-- =====================================================================

do $$
declare v_ids uuid[];
begin
  if exists (select 1 from public.cycle_doses where dose_unit = 'AUC') then
    raise exception 'توجد جرعات AUC في خطط مرضى؛ لا يُلغى الحساب قبل معالجتها';
  end if;
  select array_agg(distinct p.id) into v_ids
    from public.protocols p join public.protocol_drugs d on d.protocol_id = p.id
   where d.dose_unit = 'AUC' and p.archived_at is null;
  if v_ids is null then return; end if;
  if exists (select 1 from public.protocols where id = any(v_ids) and approved_at is not null)
     or exists (select 1 from public.treatments where protocol_id = any(v_ids)) then
    raise exception 'بروتوكول بجرعة AUC معتمد أو مستخدم؛ لا يُؤرشف تلقائياً';
  end if;
  update public.protocols
     set archived_at = now(),
         name = name || ' (AUC ملغى ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')',
         notes = coalesce(notes, '') || E'\nأُرشف: أُلغي حساب AUC لـ Carboplatin، ويُعاد البروتوكول بجرعة ملغ/م².'
   where id = any(v_ids);
end $$;

alter table public.protocol_drugs drop constraint if exists protocol_drugs_auc_range;
alter table public.protocol_drugs drop constraint if exists protocol_drugs_dose_unit_check;
alter table public.protocol_drugs add constraint protocol_drugs_dose_unit_check
  check (dose_unit in ('mg/m2', 'mg/kg', 'mg', 'units/m2', 'units')) not valid;

drop function if exists public.recalc_auc(uuid);
drop function if exists public._auc_dose(numeric, numeric, numeric, numeric, numeric, date, int);
drop function if exists public._crcl(uuid, numeric);
alter table public.cycle_doses drop column if exists calc_note;

-- إنشاء الخطة: كل دورة تأخذ أدوية البروتوكول المقررة لرقمها فقط
create or replace function public._create_treatment(p_patient uuid, p_protocol uuid, p_diagnosis text,
                                                    p_icd10 text, p_stage text, p_start date,
                                                    p_status text, p_first_cycle_no int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pt patients; v_pr protocols; v_tid uuid; v_bsa numeric; v_cid uuid;
  d protocol_drugs; c record; n int;
begin
  select * into v_pt from patients where id = p_patient and archived_at is null;
  if v_pt.id is null then raise exception 'المريض غير موجود أو مؤرشف'; end if;
  if v_pt.height_cm is null or v_pt.weight_kg is null then
    raise exception 'أدخل طول المريض ووزنه أولاً';
  end if;
  select * into v_pr from protocols where id = p_protocol and archived_at is null;
  if v_pr.id is null then raise exception 'البروتوكول غير موجود'; end if;
  if v_pr.approved_by is null then raise exception 'البروتوكول لم يعتمده طبيب مختص بعد'; end if;

  v_bsa := bsa_mosteller(v_pt.height_cm, v_pt.weight_kg);

  insert into treatments(patient_id, protocol_id, protocol_name, diagnosis, icd10, stage,
                         cycle_length_days, total_cycles, start_date, height_cm, weight_kg, bsa, status,
                         approved_by)
  values (p_patient, p_protocol, v_pr.name, p_diagnosis, p_icd10, p_stage,
          v_pr.cycle_length_days, v_pr.total_cycles, p_start, v_pt.height_cm, v_pt.weight_kg, v_bsa, p_status,
          case when p_status = 'active' then auth.uid() end)
  returning id into v_tid;

  for n in p_first_cycle_no .. v_pr.total_cycles loop
    insert into cycles(treatment_id, cycle_no, planned_date)
    values (v_tid, n, p_start + (n - p_first_cycle_no) * v_pr.cycle_length_days)
    returning id into v_cid;

    for d in select * from protocol_drugs
              where protocol_id = p_protocol
                and (cycles is null or n = any(days_list(cycles)))
              order by sort loop
      select * into c from _calc_dose(d.dose_value, d.dose_unit, v_bsa, v_pt.weight_kg, d.max_dose);
      insert into cycle_doses(cycle_id, drug_name, route, days, dose_value, dose_unit, calculated,
                              final_dose, final_unit, capped, is_mixed, instructions, source, sort)
      values (v_cid, d.drug_name, d.route, d.days, d.dose_value, d.dose_unit, c.calculated,
              c.final_dose, c.final_unit, c.capped, d.is_mixed, d.instructions,
              case when n = p_first_cycle_no then 'protocol' else 'cycle1' end, d.sort);
    end loop;
  end loop;
  return v_tid;
end $$;

revoke all on function public._create_treatment(uuid, uuid, text, text, text, date, text, int) from public, anon, authenticated;
