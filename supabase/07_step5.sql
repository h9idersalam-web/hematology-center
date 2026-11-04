-- =====================================================================
--  الخطوة 5: المرفقات والتحاليل والمزج والتمريض
--  يُشغَّل بعد الملف 06. آمن للتشغيل أكثر من مرة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. لا إعطاء لأي دواء (حتى الفموي أو غير الممزوج) قبل اعتماد الطبيب وتحقق
--    الصيدلاني، ولا في خطة غير فعّالة أو دورة مغلقة.
--    (الأدوية الممزوجة كانت محمية أصلاً لأن التحويل للمزج يشترط الاعتماد.)
-- ---------------------------------------------------------------------
create or replace function public.record_administration(p_dose uuid, p_day int default 1,
                                                        p_vitals jsonb default '{}'::jsonb,
                                                        p_reaction text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_d cycle_doses; v_c cycles; v_t treatments; v_id uuid;
begin
  perform require_role('nurse');
  select cd.* into v_d from cycle_doses cd where cd.id = p_dose and cd.archived_at is null;
  if v_d.id is null then raise exception 'الجرعة غير موجودة'; end if;
  select * into v_c from cycles where id = v_d.cycle_id;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.status <> 'active' then raise exception 'خطة العلاج غير فعّالة'; end if;
  if v_c.status not in ('planned', 'held') then raise exception 'الدورة مغلقة'; end if;
  if v_c.doctor_approved_by is null or v_c.pharmacist_verified_by is null then
    raise exception 'لم يعتمد الطبيب هذه الدورة ويتحقق منها الصيدلاني بعد';
  end if;
  if not (p_day = any(days_list(v_d.days))) then raise exception 'هذا الدواء لا يُعطى في هذا اليوم'; end if;
  -- لا يُسجَّل يوم لم يحن بعد (بتوقيت بغداد)
  if v_c.planned_date + (p_day - 1) > (now() at time zone 'Asia/Baghdad')::date then
    raise exception 'لم يحن موعد اليوم % من الدورة بعد', p_day;
  end if;
  if exists (select 1 from administrations where cycle_dose_id = p_dose and day = p_day) then
    raise exception 'سُجّل إعطاء هذا الدواء في هذا اليوم من قبل';
  end if;
  if v_d.is_mixed and not exists (select 1 from mixing_items mi join mixing_orders o on o.id = mi.order_id
                                   where mi.cycle_dose_id = p_dose and o.day = p_day and mi.sent_at is not null) then
    raise exception 'لم يُرسل هذا الدواء من قسم المزج بعد';
  end if;

  insert into administrations(cycle_dose_id, patient_id, day, vitals, reaction, notes)
  values (p_dose, v_t.patient_id, p_day, coalesce(p_vitals, '{}'::jsonb), nullif(trim(p_reaction), ''), nullif(trim(p_notes), ''))
  returning id into v_id;

  if p_reaction is not null and trim(p_reaction) <> '' then
    perform _notify_specialist(v_t.patient_id, 'alert', 'تفاعل أثناء الإعطاء', v_d.drug_name || ': ' || p_reaction,
                               'patient', v_t.patient_id);
  end if;
  return v_id;
end $$;

revoke all on function public.record_administration(uuid, int, jsonb, text, text) from public, anon;
grant execute on function public.record_administration(uuid, int, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. فهارس لشاشات المزج والتمريض والتحاليل
-- ---------------------------------------------------------------------
create index if not exists idx_mixing_orders_status on public.mixing_orders(status, transferred_at);
create index if not exists idx_mixing_orders_cycle  on public.mixing_orders(cycle_id, day);
create index if not exists idx_mixing_items_order   on public.mixing_items(order_id);
create index if not exists idx_admin_given_at       on public.administrations(given_at);
create index if not exists idx_labs_patient_test    on public.lab_results(patient_id, test_name, test_date);
