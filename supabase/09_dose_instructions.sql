-- =====================================================================
--  تعليمات الجرعة مع كل دواء (التكرار والتقسيم والشروط)
--  مثل: «كل 12 ساعة: جرعتان يومياً»، «تُقسم جرعتين»، «الحد 1 ملغ فوق 70 سنة».
--  ليست للمحلول أو مدة التسريب؛ تلك يحددها قسم المزج.
--  يُشغَّل بعد الملف 08. آمن للتشغيل أكثر من مرة.
-- =====================================================================

alter table public.protocol_drugs add column if not exists instructions text;
alter table public.cycle_doses    add column if not exists instructions text;

-- إضافة بروتوكول: تقبل instructions لكل دواء
create or replace function public.create_protocol(p_name text, p_disease text, p_kind text,
                                                  p_cycle_length int, p_total_cycles int,
                                                  p_drugs jsonb, p_notes text default null,
                                                  p_file_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; d jsonb; i int := 0;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  insert into protocols(name, disease, kind, cycle_length_days, total_cycles, notes, file_path)
  values (trim(p_name), p_disease, p_kind, p_cycle_length, p_total_cycles, p_notes, p_file_path)
  returning id into v_id;
  for d in select * from jsonb_array_elements(p_drugs) loop
    i := i + 1;
    insert into protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed,
                               instructions, sort)
    values (v_id, d->>'drug_name', (d->>'dose_value')::numeric, d->>'dose_unit', d->>'route', d->>'days',
            nullif(d->>'max_dose', '')::numeric, coalesce((d->>'is_mixed')::boolean, true),
            nullif(trim(d->>'instructions'), ''), i);
  end loop;
  if my_role() = 'specialist' then
    update protocols set approved_by = auth.uid(), approved_at = now() where id = v_id;
  else
    perform _notify_roles(array['specialist']::user_role[], 'protocol', 'بروتوكول بانتظار الاعتماد',
                          p_name, 'protocol', v_id);
  end if;
  return v_id;
end $$;

-- إنشاء الخطة: تنتقل التعليمات من البروتوكول إلى جرعات كل الدورات
create or replace function public._create_treatment(p_patient uuid, p_protocol uuid, p_diagnosis text,
                                                    p_icd10 text, p_stage text, p_start date,
                                                    p_status text, p_first_cycle_no int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pt patients; v_pr protocols; v_tid uuid; v_bsa numeric; v_cid uuid; v_first uuid;
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

    if v_first is null then
      v_first := v_cid;
      for d in select * from protocol_drugs where protocol_id = p_protocol order by sort loop
        select * into c from _calc_dose(d.dose_value, d.dose_unit, v_bsa, v_pt.weight_kg, d.max_dose);
        insert into cycle_doses(cycle_id, drug_name, route, days, dose_value, dose_unit, calculated,
                                final_dose, final_unit, capped, is_mixed, instructions, source, sort)
        values (v_cid, d.drug_name, d.route, d.days, d.dose_value, d.dose_unit, c.calculated,
                c.final_dose, c.final_unit, c.capped, d.is_mixed, d.instructions, 'protocol', d.sort);
      end loop;
    else
      insert into cycle_doses(cycle_id, drug_name, route, days, dose_value, dose_unit, calculated,
                              final_dose, final_unit, capped, is_mixed, diluent, infusion_rate, instructions,
                              source, sort)
      select v_cid, drug_name, route, days, dose_value, dose_unit, calculated,
             final_dose, final_unit, capped, is_mixed, diluent, infusion_rate, instructions, 'cycle1', sort
      from cycle_doses where cycle_id = v_first and archived_at is null;
    end if;
  end loop;
  return v_tid;
end $$;

revoke all on function public.create_protocol(text, text, text, int, int, jsonb, text, text) from public, anon;
grant execute on function public.create_protocol(text, text, text, int, int, jsonb, text, text) to authenticated;
revoke all on function public._create_treatment(uuid, uuid, text, text, text, date, text, int) from public, anon, authenticated;
