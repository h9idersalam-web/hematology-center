-- =====================================================================
-- 35: (1) طبيب الاختصاص يعدّل أي جرعة محسوبة قبل إنشاء/اعتماد خطة العلاج
--     (2) مدير البرنامج يعيد البروتوكول المؤرشف إلى «غير معتمد»
--  بطلب صاحب المشروع 2026/11/8. لا يحذف شيئاً ولا يغيّر دالة قائمة.
-- =====================================================================

-- (1) إنشاء الخطة مع جرعات معدّلة: { "<protocol_drug_id>": <الجرعة النهائية بوحدتها mg أو units> }
--     تُطبَّق على هذا الدواء في كل دورات الخطة، وتُعلَّم «عُدّلت» مع الجرعة المحسوبة الأصلية (edited_from).
--     التعديل لطبيب الاختصاص فقط (ومدير البرنامج حين يعمل بدوره)، ويُسجَّل في سجل التعديلات.
create or replace function public.create_plan(p_patient uuid, p_protocol uuid, p_diagnosis text,
                                              p_icd10 text, p_stage text, p_start date,
                                              p_disease_status text default null, p_doses jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tid uuid; r record; d protocol_drugs; v_new numeric;
begin
  if p_doses is not null and jsonb_typeof(p_doses) <> 'object' then raise exception 'صيغة الجرعات المعدّلة غير صحيحة'; end if;
  if p_doses is not null and p_doses <> '{}'::jsonb and my_role() <> 'specialist' then
    raise exception 'تعديل الجرعات قبل الاعتماد لطبيب الاختصاص فقط' using errcode = '42501';
  end if;
  v_tid := create_treatment(p_patient, p_protocol, p_diagnosis, p_icd10, p_stage, p_start, p_disease_status);
  for r in select key, value from jsonb_each_text(coalesce(p_doses, '{}'::jsonb)) loop
    select * into d from protocol_drugs where id = r.key::uuid and protocol_id = p_protocol;
    if d.id is null then raise exception 'دواء غير موجود في هذا البروتوكول'; end if;
    begin v_new := r.value::numeric; exception when others then raise exception 'جرعة غير صحيحة لـ %', d.drug_name; end;
    if v_new is null or v_new <= 0 or v_new > 100000 then raise exception 'جرعة غير صحيحة لـ %', d.drug_name; end if;
    update cycle_doses cd
       set edited_from = cd.final_dose, final_dose = v_new, source = 'edited'
      from cycles c
     where c.id = cd.cycle_id and c.treatment_id = v_tid and cd.archived_at is null
       and cd.drug_name = d.drug_name and cd.route = d.route and cd.days = d.days and cd.sort = d.sort
       and cd.final_dose <> v_new;
  end loop;
  return v_tid;
end $$;
revoke all on function public.create_plan(uuid, uuid, text, text, text, date, text, jsonb) from public, anon;
grant execute on function public.create_plan(uuid, uuid, text, text, text, date, text, jsonb) to authenticated;

-- (2) إعادة بروتوكول مؤرشف إلى «غير معتمد»: لمدير البرنامج فقط. يعود لقائمة «بانتظار الاعتماد»
--     ويحتاج اعتماداً جديداً من طبيب الاختصاص قبل استعماله. يُسجَّل في سجل التعديلات.
create or replace function public.restore_protocol(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_p protocols;
begin
  perform _require_admin();
  select * into v_p from protocols where id = p_id;
  if v_p.id is null then raise exception 'البروتوكول غير موجود'; end if;
  if v_p.archived_at is null then raise exception 'البروتوكول غير مؤرشف'; end if;
  update protocols set archived_at = null, approved_by = null, approved_at = null where id = p_id;
  perform _notify_roles(array['specialist']::user_role[], 'protocol', 'بروتوكول أُعيد من الأرشيف بانتظار اعتمادك',
                        v_p.name, 'protocol', p_id);
end $$;
revoke all on function public.restore_protocol(uuid) from public, anon;
grant execute on function public.restore_protocol(uuid) to authenticated;
