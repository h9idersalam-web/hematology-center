-- =====================================================================
--  الدورات التي يُعطى فيها كل دواء (اختياري)
--  مثل: Carfilzomib 20 ملغ/م² في الدورة 1 فقط، ثم 56 من الدورة 2؛
--       Rituximab في الأيام 1 و8 و15 في الدورة 1، ثم اليوم 1 فقط.
--  الحقل فارغ = كل الدورات. الصيغة نفسها للأيام: '1' أو '2-12' أو '1,3,5'.
--
--  وإصلاح: «تطبيق على الدورات اللاحقة» عند تعديل جرعة أو حذف دواء كان يطابق
--  باسم الدواء وحده، فإن تكرر الدواء في البروتوكول (Methotrexate وريدي وداخل القراب)
--  تغيّر الاثنان. صار يطابق السطر نفسه من البروتوكول (الاسم والطريق والأيام والترتيب).
--
--  وإصلاح ثالث: الجرعة الثابتة (ملغ أو وحدة) كانت تُقرَّب كالمحسوبة، فصار
--  MTX داخل القراب 12.5 ملغ يظهر 13. الثابتة تبقى كما كُتبت، والتقريب للمحسوبة فقط.
--
--  يُشغَّل بعد الملف 09. آمن للتشغيل أكثر من مرة.
-- =====================================================================

alter table public.protocol_drugs add column if not exists cycles text;

do $$ begin
  alter table public.protocol_drugs add constraint protocol_drugs_cycles_fmt
    check (cycles is null or cycles ~ '^\d+(-\d+)?(,\d+(-\d+)?)*$');
exception when duplicate_object then null; end $$;

-- حساب الجرعة: التقريب للجرعة المحسوبة من المساحة أو الوزن فقط
create or replace function public._calc_dose(p_value numeric, p_unit text, p_bsa numeric, p_weight numeric,
                                             p_max numeric, out calculated numeric, out final_dose numeric,
                                             out final_unit text, out capped boolean)
language plpgsql immutable set search_path = '' as $$
begin
  calculated := case p_unit
                  when 'mg/m2'    then p_value * p_bsa
                  when 'units/m2' then p_value * p_bsa
                  when 'mg/kg'    then p_value * p_weight
                  else p_value end;
  -- التقريب: 10 فأكثر إلى عدد صحيح، وما دون 10 إلى منزلة عشرية واحدة (للمحسوبة فقط)
  if p_unit in ('mg/m2', 'units/m2', 'mg/kg') then
    calculated := case when calculated >= 10 then round(calculated, 0) else round(calculated, 1) end;
  end if;
  final_unit := case when p_unit in ('units/m2', 'units') then 'units' else 'mg' end;
  capped := p_max is not null and calculated > p_max;
  final_dose := case when capped then p_max else calculated end;
end $$;

-- إضافة بروتوكول: تقبل cycles لكل دواء
create or replace function public.create_protocol(p_name text, p_disease text, p_kind text,
                                                  p_cycle_length int, p_total_cycles int,
                                                  p_drugs jsonb, p_notes text default null,
                                                  p_file_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; d jsonb; i int := 0; v_cy text;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  insert into protocols(name, disease, kind, cycle_length_days, total_cycles, notes, file_path)
  values (trim(p_name), p_disease, p_kind, p_cycle_length, p_total_cycles, p_notes, p_file_path)
  returning id into v_id;
  for d in select * from jsonb_array_elements(p_drugs) loop
    i := i + 1;
    v_cy := nullif(replace(coalesce(d->>'cycles', ''), ' ', ''), '');
    if v_cy is not null and exists (select 1 from unnest(days_list(v_cy)) x where x < 1 or x > p_total_cycles) then
      raise exception 'دورات الدواء % خارج عدد دورات البروتوكول', d->>'drug_name';
    end if;
    insert into protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed,
                               instructions, cycles, sort)
    values (v_id, d->>'drug_name', (d->>'dose_value')::numeric, d->>'dose_unit', d->>'route', d->>'days',
            nullif(d->>'max_dose', '')::numeric, coalesce((d->>'is_mixed')::boolean, true),
            nullif(trim(d->>'instructions'), ''), v_cy, i);
  end loop;
  if my_role() = 'specialist' then
    update protocols set approved_by = auth.uid(), approved_at = now() where id = v_id;
  else
    perform _notify_roles(array['specialist']::user_role[], 'protocol', 'بروتوكول بانتظار الاعتماد',
                          p_name, 'protocol', v_id);
  end if;
  return v_id;
end $$;

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

-- تعديل جرعة: «هذه وما بعدها» يطابق السطر نفسه من البروتوكول لا اسم الدواء وحده
create or replace function public._apply_dose(p_dose uuid, p_new numeric, p_onward boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_d cycle_doses; v_c cycles;
begin
  if p_new is null or p_new <= 0 then raise exception 'قيمة الجرعة غير صحيحة'; end if;
  select * into v_d from cycle_doses where id = p_dose and archived_at is null;
  if v_d.id is null then raise exception 'الجرعة غير موجودة'; end if;
  select * into v_c from cycles where id = v_d.cycle_id;
  if v_c.status = 'given' then raise exception 'لا يمكن تعديل جرعة أُعطيت'; end if;

  update cycle_doses set edited_from = coalesce(edited_from, final_dose), final_dose = p_new, source = 'edited'
   where id = p_dose;

  if p_onward then
    update cycle_doses cd set edited_from = coalesce(cd.edited_from, cd.final_dose), final_dose = p_new, source = 'edited'
      from cycles c
     where cd.cycle_id = c.id
       and c.treatment_id = v_c.treatment_id
       and c.cycle_no > v_c.cycle_no
       and c.status in ('planned', 'held')
       and cd.drug_name = v_d.drug_name
       and cd.route = v_d.route
       and cd.days = v_d.days
       and cd.sort = v_d.sort
       and cd.archived_at is null;
  end if;

  -- أي تعديل يُسقط الاعتماد السابق للدورة
  update cycles set doctor_approved_by = null, doctor_approved_at = null,
                    pharmacist_verified_by = null, pharmacist_verified_at = null
   where id = v_c.id and not exists (select 1 from mixing_orders where cycle_id = v_c.id);
end $$;

-- تطبيق بند طلب تعديل: حذف الدواء «من هذه وما بعدها» يطابق السطر نفسه كذلك
create or replace function public._apply_item(p_item change_request_items, p_cycle uuid, p_treatment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pl jsonb := p_item.payload; v_t treatments; v_next record; v_tg cycle_doses;
begin
  case p_item.kind
  when 'dose' then
    perform _apply_dose(p_item.target_dose_id, p_item.new_value::numeric, p_item.apply_onward);
  when 'infusion' then
    update cycle_doses set diluent = coalesce(v_pl->>'diluent', diluent),
                           infusion_rate = coalesce(v_pl->>'infusion_rate', infusion_rate)
     where id = p_item.target_dose_id;
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
    update cycle_doses cd set archived_at = now(), archive_reason = coalesce(v_pl->>'reason', 'حذف بموافقة الطبيب')
      from cycles c
     where cd.cycle_id = c.id and c.status in ('planned', 'held')
       and (cd.id = p_item.target_dose_id
            or (p_item.apply_onward and c.treatment_id = p_treatment
                and c.cycle_no > (select cycle_no from cycles where id = p_cycle)
                and cd.drug_name = v_tg.drug_name and cd.route = v_tg.route
                and cd.days = v_tg.days and cd.sort = v_tg.sort));
  when 'diagnosis' then
    update treatments set diagnosis = coalesce(v_pl->>'diagnosis', diagnosis),
                          icd10 = coalesce(v_pl->>'icd10', icd10),
                          stage = coalesce(v_pl->>'stage', stage)
     where id = p_treatment;
  when 'protocol' then
    -- إيقاف الخطة الحالية، وبدء البروتوكول الجديد من أول دورة لم تُعطَ
    select * into v_t from treatments where id = p_treatment;
    select cycle_no, planned_date into v_next from cycles
     where treatment_id = p_treatment and status in ('planned', 'held') order by cycle_no limit 1;
    update treatments set status = 'stopped', stop_reason = 'تغيير البروتوكول بطلب تعديل' where id = p_treatment;
    update cycles set status = 'cancelled', postpone_reason = 'تغيير البروتوكول'
     where treatment_id = p_treatment and status in ('planned', 'held');
    perform _create_treatment(v_t.patient_id, (v_pl->>'protocol_id')::uuid, v_t.diagnosis, v_t.icd10, v_t.stage,
                              coalesce((v_pl->>'start_date')::date, v_next.planned_date, current_date), 'active');
  end case;
end $$;

revoke all on function public.create_protocol(text, text, text, int, int, jsonb, text, text) from public, anon;
grant execute on function public.create_protocol(text, text, text, int, int, jsonb, text, text) to authenticated;
revoke all on function public._create_treatment(uuid, uuid, text, text, text, date, text, int) from public, anon, authenticated;
revoke all on function public._apply_dose(uuid, numeric, boolean) from public, anon, authenticated;
revoke all on function public._apply_item(change_request_items, uuid, uuid) from public, anon, authenticated;
