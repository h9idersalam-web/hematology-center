-- =====================================================================
--  32: حالة المرض في خطة العلاج (بطلب صاحب المشروع)
--   Initial treatment / Relapse / Maintenance  →  initial / relapse / maintenance
--   - عمود treatments.disease_status (اختياري).
--   - create_treatment يأخذ p_disease_status (اختياري؛ الاستدعاءات القديمة بستة معاملات تبقى تعمل).
--   - تعديل التشخيص بطلب تعديل يشمل الحالة، وتغيير البروتوكول ينقلها إلى الخطة الجديدة.
--  درجة المرض (Grade 1–4) تُحفظ في العمود الموجود stage.
-- =====================================================================

alter table public.treatments add column if not exists disease_status text;
do $$ begin
  alter table public.treatments add constraint treatments_disease_status_chk
    check (disease_status is null or disease_status in ('initial', 'relapse', 'maintenance'));
exception when duplicate_object then null; end $$;

drop function if exists public.create_treatment(uuid, uuid, text, text, text, date);
create or replace function public.create_treatment(p_patient uuid, p_protocol uuid, p_diagnosis text,
                                                   p_icd10 text, p_stage text, p_start date,
                                                   p_disease_status text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tid uuid; v_status text;
begin
  perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist');
  if p_disease_status is not null and p_disease_status not in ('initial', 'relapse', 'maintenance') then
    raise exception 'حالة المرض غير صحيحة';
  end if;
  if exists (select 1 from treatments where patient_id = p_patient and status in ('active', 'pending_approval')) then
    raise exception 'للمريض خطة علاج قائمة، أوقفها أو غيّر البروتوكول بطلب تعديل';
  end if;
  v_status := case when my_role() in ('specialist', 'senior_resident') then 'active' else 'pending_approval' end;
  v_tid := _create_treatment(p_patient, p_protocol, p_diagnosis, p_icd10, p_stage, p_start, v_status);
  update treatments set disease_status = p_disease_status where id = v_tid;
  if v_status = 'pending_approval' then
    perform _notify_specialist(p_patient, 'approval', 'خطة علاج بانتظار موافقتك',
                               (select full_name from patients where id = p_patient), 'treatment', v_tid);
  elsif my_role() = 'senior_resident' then
    perform _notify_specialist(p_patient, 'info', 'أنشأ الطبيب المقيم خطة علاج',
                               (select full_name from patients where id = p_patient), 'treatment', v_tid);
  end if;
  return v_tid;
end $$;
revoke all on function public.create_treatment(uuid, uuid, text, text, text, date, text) from public, anon;
grant execute on function public.create_treatment(uuid, uuid, text, text, text, date, text) to authenticated;

-- كما في الملف 15، مع حالة المرض في التشخيص وتغيير البروتوكول
create or replace function public._apply_item(p_item change_request_items, p_cycle uuid, p_treatment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pl jsonb := p_item.payload; v_t treatments; v_next record; v_tg cycle_doses; v_ids uuid[]; v_new uuid;
begin
  case p_item.kind
  when 'dose' then
    perform _apply_dose(p_item.target_dose_id, p_item.new_value::numeric, p_item.apply_onward);
  when 'infusion' then
    update cycle_doses set diluent = coalesce(v_pl->>'diluent', diluent),
                           infusion_rate = coalesce(v_pl->>'infusion_rate', infusion_rate)
     where id = p_item.target_dose_id;
    perform _doses_changed(array[p_item.target_dose_id]);
  when 'add_drug' then
    insert into cycle_doses(cycle_id, drug_name, route, days, final_dose, final_unit, is_mixed, diluent,
                            infusion_rate, source, sort)
    select c.id, v_pl->>'drug_name', v_pl->>'route', coalesce(v_pl->>'days', '1'),
           (v_pl->>'final_dose')::numeric, coalesce(v_pl->>'final_unit', 'mg'),
           coalesce((v_pl->>'is_mixed')::boolean, true), v_pl->>'diluent', v_pl->>'infusion_rate', 'added', 99
      from cycles c
     where c.treatment_id = p_treatment
       and c.status in ('planned', 'held')
       and (c.id = p_cycle or (p_item.apply_onward and c.cycle_no > (select cycle_no from cycles where id = p_cycle)));
  when 'remove_drug' then
    select * into v_tg from cycle_doses where id = p_item.target_dose_id;
    select array_agg(cd.id) into v_ids
      from cycle_doses cd join cycles c on c.id = cd.cycle_id
     where c.status in ('planned', 'held') and cd.archived_at is null
       and (cd.id = p_item.target_dose_id
            or (p_item.apply_onward and c.treatment_id = p_treatment
                and c.cycle_no > (select cycle_no from cycles where id = p_cycle)
                and cd.drug_name = v_tg.drug_name and cd.route = v_tg.route
                and cd.days = v_tg.days and cd.sort = v_tg.sort));
    perform _doses_changed(v_ids);   -- يرفض إن أُرسل أحدها من المزج ولم يُعطَ
    update cycle_doses set archived_at = now(), archive_reason = coalesce(v_pl->>'reason', 'حذف بموافقة الطبيب')
     where id = any(v_ids);
  when 'diagnosis' then
    if v_pl ? 'disease_status' and v_pl->>'disease_status' is not null
       and v_pl->>'disease_status' not in ('initial', 'relapse', 'maintenance') then
      raise exception 'حالة المرض غير صحيحة';
    end if;
    update treatments set diagnosis = coalesce(v_pl->>'diagnosis', diagnosis),
                          icd10 = coalesce(v_pl->>'icd10', icd10),
                          stage = coalesce(v_pl->>'stage', stage),
                          disease_status = coalesce(v_pl->>'disease_status', disease_status)
     where id = p_treatment;
  when 'protocol' then
    -- إيقاف الخطة الحالية، وبدء البروتوكول الجديد من أول دورة لم تُعطَ
    select * into v_t from treatments where id = p_treatment;
    select cycle_no, planned_date into v_next from cycles
     where treatment_id = p_treatment and status in ('planned', 'held') order by cycle_no limit 1;
    update treatments set status = 'stopped', stop_reason = 'تغيير البروتوكول بطلب تعديل' where id = p_treatment;
    update cycles set status = 'cancelled', postpone_reason = 'تغيير البروتوكول'
     where treatment_id = p_treatment and status in ('planned', 'held');
    v_new := _create_treatment(v_t.patient_id, (v_pl->>'protocol_id')::uuid, v_t.diagnosis, v_t.icd10, v_t.stage,
                               coalesce((v_pl->>'start_date')::date, v_next.planned_date, current_date), 'active');
    update treatments set disease_status = v_t.disease_status where id = v_new;
  end case;
end $$;
revoke all on function public._apply_item(change_request_items, uuid, uuid) from public, anon, authenticated;
