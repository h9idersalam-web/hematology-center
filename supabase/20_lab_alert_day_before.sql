-- =====================================================================
--  20: إشعار «تحليل خارج المرجع» يشمل التحليل المسحوب قبل الدورة بيوم
--
--  قرار صاحب المشروع: يُرسل الإشعار إذا كان تاريخ سحب العينة يوم الدورة أو قبله بيوم واحد،
--  والدورة مجدولة لم يعتمدها الطبيب بعد. (الملف 19 كان يوم الدورة نفسه فقط.)
--
--  يُشغَّل بعد الملف 19. آمن للتشغيل أكثر من مرة. لا يغيّر أي بيانات.
-- =====================================================================

create or replace function public.add_lab_results(p_patient uuid, p_test_date date, p_results jsonb,
                                                  p_attachment uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v_out text := ''; v_method text; v_id uuid; v_first uuid; v_cycle int;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'nurse');
  for r in select * from jsonb_array_elements(p_results) loop
    v_method := case when r->>'entry_method' = 'ocr' then 'ocr' else 'manual' end;
    if v_method = 'ocr' and p_attachment is null then
      raise exception 'القيمة المقروءة آلياً تُحفظ مع صورة التحليل التي قُرئت منها';
    end if;
    insert into lab_results(patient_id, attachment_id, test_date, test_name, value, unit, ref_low, ref_high, entry_method)
    values (p_patient, p_attachment, p_test_date, r->>'test_name', (r->>'value')::numeric, r->>'unit',
            nullif(r->>'ref_low', '')::numeric, nullif(r->>'ref_high', '')::numeric, v_method)
    returning id into v_id;
    n := n + 1;
    if (nullif(r->>'ref_low', '') is not null and (r->>'value')::numeric < (r->>'ref_low')::numeric)
       or (nullif(r->>'ref_high', '') is not null and (r->>'value')::numeric > (r->>'ref_high')::numeric) then
      v_out := v_out || case when v_out = '' then '' else '، ' end || (r->>'test_name') || ' ' || (r->>'value');
      v_first := coalesce(v_first, v_id);
    end if;
  end loop;

  -- الإشعار: تحليل يوم الدورة أو قبله بيوم، والدورة لم يعتمدها الطبيب بعد
  select c.cycle_no into v_cycle
    from cycles c join treatments t on t.id = c.treatment_id
   where t.patient_id = p_patient and t.status in ('active', 'pending_approval')
     and c.planned_date between p_test_date and p_test_date + 1 and c.status in ('planned', 'held') and c.doctor_approved_by is null
   order by c.planned_date, c.cycle_no limit 1;
  if v_out <> '' and v_cycle is not null then
    perform _notify_specialist(p_patient, 'alert', 'تحليل خارج المرجع',
                               (select full_name from patients where id = p_patient) || ' · قبل الدورة ' || v_cycle || ': ' || v_out,
                               'lab_result', v_first);
  end if;
  return n;
end $$;

-- للواجهة: هل يُرسل إشعار لتحليل بهذا التاريخ؟ (يوم دورة لم تُعتمد أو قبله بيوم)
create or replace function public.lab_alert_cycle(p_patient uuid, p_test_date date)
returns int language sql stable security definer set search_path = public as $$
  select c.cycle_no
    from cycles c join treatments t on t.id = c.treatment_id
   where public.is_active_user() and t.patient_id = p_patient and t.status in ('active', 'pending_approval')
     and c.planned_date between p_test_date and p_test_date + 1 and c.status in ('planned', 'held') and c.doctor_approved_by is null
   order by c.planned_date, c.cycle_no limit 1
$$;

revoke all on function public.add_lab_results(uuid, date, jsonb, uuid) from public, anon;
grant execute on function public.add_lab_results(uuid, date, jsonb, uuid) to authenticated;
revoke all on function public.lab_alert_cycle(uuid, date) from public, anon;
grant execute on function public.lab_alert_cycle(uuid, date) to authenticated;
