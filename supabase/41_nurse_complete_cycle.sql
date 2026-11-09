-- =====================================================================
-- 41: الممرض يغلق الجرعة («تم إعطاء الجرعة بالكامل») بعد اكتمال الإعطاء (بطلب صاحب المشروع 2026/11/9)
--   - الممرض: فقط إذا سُجّل إعطاء كل دواء في كل أيام الجرعة (لا يُغلق جرعة ناقصة).
--   - طبيب الاختصاص والمقيم الأقدم ومسؤول الصيادلة السريريين: كما كان.
-- =====================================================================
create or replace function public.complete_cycle(p_cycle uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tid uuid; v_missing int;
begin
  perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist', 'nurse');
  if my_role() = 'nurse' then
    select count(*) into v_missing
      from cycle_doses cd, unnest(days_list(cd.days)) as d(day)
     where cd.cycle_id = p_cycle and cd.archived_at is null
       and not exists (select 1 from administrations a where a.cycle_dose_id = cd.id and a.day = d.day);
    if v_missing > 0 then
      raise exception 'لم يُسجَّل إعطاء كل الأدوية في كل أيام الجرعة بعد (ناقص %)', v_missing;
    end if;
  end if;
  update cycles set status = 'given' where id = p_cycle and status in ('planned', 'held')
   returning treatment_id into v_tid;
  if not found then raise exception 'الدورة مغلقة من قبل'; end if;
  update mixing_orders set status = 'held', hold_reason = 'أُغلقت الدورة'
   where cycle_id = p_cycle and status <> 'sent';
  update treatments t set status = 'completed'
   where t.id = v_tid
     and not exists (select 1 from cycles c where c.treatment_id = t.id and c.status in ('planned', 'held'));
end $$;
