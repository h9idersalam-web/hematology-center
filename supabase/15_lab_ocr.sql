-- =====================================================================
--  15: القراءة الآلية لصور التحاليل، وحماية الجرعة المرسلة من الحذف
--
--   1. lab_results.entry_method: كيف أُدخلت القيمة
--        manual = كتبها المستخدم
--        ocr    = قرأها التطبيق من صورة التحليل، وراجعها المستخدم وأكدها قبل الحفظ
--      (القراءة نفسها داخل الهاتف بـ Tesseract.js؛ لا خادم ولا ترسل الصورة لأي جهة)
--   2. لا يُحذف دواء من الدورة بعد أن أرسله المزج ولم يُعطَ (كما لا تُعدَّل جرعته منذ الملف 14)
--
--  يُشغَّل بعد الملف 14. آمن للتشغيل أكثر من مرة. لا يحذف بيانات.
-- =====================================================================

alter table public.lab_results add column if not exists entry_method text not null default 'manual';
alter table public.lab_results drop constraint if exists lab_results_entry_method_check;
alter table public.lab_results add constraint lab_results_entry_method_check check (entry_method in ('manual', 'ocr'));

-- كل نتيجة في p_results يمكن أن تحمل "entry_method": "ocr" (ولا يُقبل غيرها إلا manual)
create or replace function public.add_lab_results(p_patient uuid, p_test_date date, p_results jsonb,
                                                  p_attachment uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v_out text := ''; v_method text;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'nurse');
  for r in select * from jsonb_array_elements(p_results) loop
    v_method := case when r->>'entry_method' = 'ocr' then 'ocr' else 'manual' end;
    if v_method = 'ocr' and p_attachment is null then
      raise exception 'القيمة المقروءة آلياً تُحفظ مع صورة التحليل التي قُرئت منها';
    end if;
    insert into lab_results(patient_id, attachment_id, test_date, test_name, value, unit, ref_low, ref_high, entry_method)
    values (p_patient, p_attachment, p_test_date, r->>'test_name', (r->>'value')::numeric, r->>'unit',
            nullif(r->>'ref_low', '')::numeric, nullif(r->>'ref_high', '')::numeric, v_method);
    n := n + 1;
    if (nullif(r->>'ref_low', '') is not null and (r->>'value')::numeric < (r->>'ref_low')::numeric)
       or (nullif(r->>'ref_high', '') is not null and (r->>'value')::numeric > (r->>'ref_high')::numeric) then
      v_out := v_out || case when v_out = '' then '' else '، ' end || (r->>'test_name') || ' ' || (r->>'value');
    end if;
  end loop;
  -- تنبيه ذكي: نتائج خارج المرجع
  if v_out <> '' then
    perform _notify_specialist(p_patient, 'alert', 'تحليل خارج المرجع',
                               (select full_name from patients where id = p_patient) || ': ' || v_out,
                               'patient', p_patient);
  end if;
  return n;
end $$;

-- حذف دواء من الدورة: يمرّ بفحص الجرعات المرسلة كما في تعديل الجرعة
create or replace function public._apply_item(p_item change_request_items, p_cycle uuid, p_treatment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pl jsonb := p_item.payload; v_t treatments; v_next record; v_tg cycle_doses; v_ids uuid[];
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

revoke all on function public.add_lab_results(uuid, date, jsonb, uuid) from public, anon;
grant execute on function public.add_lab_results(uuid, date, jsonb, uuid) to authenticated;
revoke all on function public._apply_item(change_request_items, uuid, uuid) from public, anon, authenticated;
