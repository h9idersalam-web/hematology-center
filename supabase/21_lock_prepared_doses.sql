-- =====================================================================
--  21: لا تُعدَّل الجرعة التي حضّرها صيدلي المزج
--
--  قرار صاحب المشروع: الجرعة المحضّرة (عليها علامة «محضَّر») لا تُعدَّل جرعتها ولا محلولها ولا تُحذف،
--  كالجرعة المرسلة من المزج ولم تُعطَ. إن لزم التعديل: يزيل صيدلي المزج علامة التحضير أولاً
--  (ممكن ما دامت لم تُرسل)، ثم يُعدَّل. ينطبق على تعديل الطبيب المباشر وعلى قرارات طلبات التعديل.
--
--  يُشغَّل بعد الملف 20. آمن للتشغيل أكثر من مرة. لا يغيّر أي بيانات.
-- =====================================================================

create or replace function public._doses_changed(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  select cd.drug_name, o.day, mi.sent_at is not null as sent into v
    from mixing_items mi join mixing_orders o on o.id = mi.order_id join cycle_doses cd on cd.id = mi.cycle_dose_id
   where mi.cycle_dose_id = any(p_ids) and (mi.sent_at is not null or mi.prepared_at is not null)
     and not exists (select 1 from administrations a where a.cycle_dose_id = mi.cycle_dose_id and a.day = o.day)
   order by mi.sent_at nulls last
   limit 1;
  if v.drug_name is not null then
    if v.sent then
      raise exception 'أُرسل % (اليوم %) من المزج ولم يُعطَ بعد، فلا يُعدَّل', v.drug_name, v.day;
    end if;
    raise exception 'حضّر صيدلي المزج % (اليوم %)، فلا يُعدَّل. إن لزم التعديل يزيل صيدلي المزج علامة التحضير أولاً', v.drug_name, v.day;
  end if;
end $$;

revoke all on function public._doses_changed(uuid[]) from public, anon, authenticated;
