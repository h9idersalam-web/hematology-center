-- =====================================================================
-- 39: اعتمادات مسؤول الصيادلة (الملف 38) لمسؤول الصيادلة الأصلي وحده، لا للرديف المفعّل
--     (بطلب صاحب المشروع 2026/11/9). الرديف يبقى كما قبل الملف 38: خطته تنتظر موافقة الطبيب،
--     وبروتوكوله ينتظر الاعتماد، ولا يعتمد الخطط ولا البروتوكولات ولا جرعات الدورات.
--     المدير وهو يعمل بدور مسؤول الصيادلة يُعامَل كالأصلي.
-- =====================================================================

-- مسؤول الصيادلة الأصلي: دوره الفعلي مسؤول الصيادلة، وليس صيدلياً سريرياً رديفاً مفعّلاً
create or replace function public._is_real_chief() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public._effective_role(p) = 'chief_clinical_pharmacist'
                          and not (p.role = 'clinical_pharmacist' and p.is_deputy and p.deputy_active
                                   and not (p.is_admin and p.acting_role is not null))
                     from profiles p where p.id = auth.uid() and p.status = 'active'), false)
$$;
revoke all on function public._is_real_chief() from public, anon, authenticated;

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
  v_status := case when my_role() in ('specialist', 'senior_resident') or _is_real_chief() then 'active' else 'pending_approval' end;
  v_tid := _create_treatment(p_patient, p_protocol, p_diagnosis, p_icd10, p_stage, p_start, v_status);
  update treatments set disease_status = p_disease_status where id = v_tid;
  if v_status = 'pending_approval' then
    perform _notify_specialist(p_patient, 'approval', 'خطة علاج بانتظار موافقتك',
                               (select full_name from patients where id = p_patient), 'treatment', v_tid);
  elsif my_role() in ('senior_resident', 'chief_clinical_pharmacist') then   -- (الرديف تذهب خطته معلّقة فلا يصل هنا)
    perform _notify_specialist(p_patient, 'info',
                               case when my_role() = 'senior_resident' then 'أنشأ الطبيب المقيم خطة علاج' else 'أنشأ مسؤول الصيادلة السريريين خطة علاج' end,
                               (select full_name from patients where id = p_patient), 'treatment', v_tid);
  end if;
  return v_tid;
end $$;

create or replace function public._require_patient_specialist(p_patient uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_sp uuid; v_pending uuid;
begin
  if public._is_real_chief() then return; end if;
  perform require_role('specialist');
  select specialist_id, pending_specialist_id into v_sp, v_pending from patients where id = p_patient;
  if v_sp is null and v_pending is not null then
    if not is_admin() then raise exception 'طبيب هذا المريض لم ينضم بعد: القرار لمدير البرنامج حتى انضمامه' using errcode = '42501'; end if;
    return;
  end if;
  if v_sp is null then raise exception 'حدّد الطبيب المختص للمريض أولاً من ملفه'; end if;
  if v_sp <> auth.uid() then raise exception 'القرار للطبيب المختص بهذا المريض فقط' using errcode = '42501'; end if;
end $$;

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
  if my_role() = 'specialist' or _is_real_chief() then
    update protocols set approved_by = auth.uid(), approved_at = now() where id = v_id;
  else
    perform _notify_roles(array['specialist']::user_role[], 'protocol', 'بروتوكول بانتظار الاعتماد',
                          p_name, 'protocol', v_id);
  end if;
  return v_id;
end $$;

create or replace function public.approve_protocol(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('specialist', 'chief_clinical_pharmacist');
  if my_role() = 'chief_clinical_pharmacist' and not _is_real_chief() then
    raise exception 'اعتماد البروتوكول لمسؤول الصيادلة الأصلي، لا للرديف' using errcode = '42501';
  end if;
  update protocols set approved_by = auth.uid(), approved_at = now() where id = p_id and archived_at is null;
end $$;

create or replace function public.approve_cycle(p_cycle uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_name text; v_first uuid;
begin
  perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist');
  if my_role() = 'chief_clinical_pharmacist' and not _is_real_chief() then
    raise exception 'اعتماد الجرعة لمسؤول الصيادلة الأصلي، لا للرديف' using errcode = '42501';
  end if;
  select * into v_c from cycles where id = p_cycle;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.status <> 'active' then raise exception 'خطة العلاج غير فعّالة'; end if;
  update cycles set doctor_approved_by = auth.uid(), doctor_approved_at = now()
   where id = p_cycle and status = 'planned' and doctor_approved_by is null;
  if not found then raise exception 'الدورة غير قابلة للاعتماد'; end if;

  perform _sync_mixing(p_cycle, auth.uid());
  select full_name into v_name from patients where id = v_t.patient_id;
  select id into v_first from mixing_orders where cycle_id = p_cycle order by day limit 1;
  if v_first is not null then
    perform _notify_roles(array['mixing_pharmacist']::user_role[], 'mixing', 'دورة معتمدة وصلت إلى المزج',
                          v_name || ' · ' || v_t.protocol_name || ' · الدورة ' || v_c.cycle_no, 'mixing_order', v_first);
  end if;
  if v_c.chart_attachment_id is null then
    perform _notify_roles(array['clinical_pharmacist', 'chief_clinical_pharmacist']::user_role[], 'task',
                          'أرفق صورة الدورة من طبلة المريض',
                          v_name || ' · ' || v_t.protocol_name || ' · الدورة ' || v_c.cycle_no, 'cycle', p_cycle);
  end if;
end $$;
