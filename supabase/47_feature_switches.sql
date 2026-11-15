-- =====================================================================
-- 47: إيقاف أقسام مؤقتاً مع الإبقاء على برمجتها وبياناتها (بطلب صاحب المشروع 2026/11/15)
--   - قسمان قابلان للإيقاف: المزج (mixing) والتمريض (nursing). يبدآن موقوفين.
--   - المدير يشغّلهما أو يوقفهما من «لوحة المدير › الأقسام» (admin_set_feature). لا يُحذف شيء:
--     الجداول والدوال والشاشات والسجلات كلها باقية، وتعود كما كانت عند التشغيل.
--   - المزج موقوف: لا تُنشأ طلبات مزج جديدة، وتُجمَّد الطلبات المفتوحة (لا تحضير ولا إرسال)،
--     ولا تُقفل الجرعات المحضّرة/المرسلة التعديل، ولا تصل إشعارات المزج. عند التشغيل تُزامَن طلبات
--     المزج للجرعات المعتمدة المفتوحة فيعود كل شيء.
--   - التمريض موقوف: لا يُسجَّل إعطاء ولا تفاعل. «تم إعطاء الجرعة بالكامل» لكل يوم يؤكده طبيب الاختصاص
--     أو المقيم الأقدم أو مسؤول الصيادلة أو الصيدلي السريري، بلا سجلات إعطاء لكل دواء.
--   - دورا «صيدلي المزج» و«ممرض» لا يُسندان (كود تفعيل، تغيير صلاحية، دور عمل المدير) ما دام قسمهما موقوفاً،
--     وتُلغى الأكواد المفتوحة بهما عند الإيقاف. الحسابات الموجودة بهذين الدورين لا تتغير تلقائياً.
--   آمن للتشغيل أكثر من مرة، ولا يغيّر اختيار المدير بعد أول تشغيل.
-- =====================================================================

create table if not exists public.app_features (
  id          uuid not null unique default gen_random_uuid(),   -- لسجل التعديلات
  key         text primary key check (key in ('mixing', 'nursing')),
  enabled     boolean not null default true,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);
alter table public.app_features enable row level security;
revoke all on public.app_features from public, anon, authenticated;

insert into public.app_features(key, enabled) values ('mixing', false), ('nursing', false)
on conflict (key) do nothing;

create or replace trigger audit_app_features after insert or update or delete on public.app_features
  for each row execute function public.audit_trigger();
create or replace trigger no_delete_app_features before delete on public.app_features
  for each row execute function public.forbid_delete();

-- ---------------------------------------------------------------------
-- القراءة
create or replace function public.feature_on(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from app_features where key = p_key), true)
$$;
revoke all on function public.feature_on(text) from public, anon, authenticated;

-- للواجهة (وصفحة التسجيل قبل الدخول): {"mixing": false, "nursing": false}
create or replace function public.get_features() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, enabled), '{}'::jsonb) from app_features
$$;
revoke all on function public.get_features() from public;
grant execute on function public.get_features() to anon, authenticated;

create or replace function public._role_enabled(p_role user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_role::text
    when 'nurse' then public.feature_on('nursing')
    when 'mixing_pharmacist' then public.feature_on('mixing')
    else true end
$$;
revoke all on function public._role_enabled(user_role) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- التشغيل والإيقاف (المدير)
create or replace function public.admin_set_feature(p_key text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role user_role; v_revoked int := 0; v_synced int := 0; c record;
begin
  perform _require_admin();
  if p_key not in ('mixing', 'nursing') or p_enabled is null then raise exception 'قسم غير معروف'; end if;
  v_role := case p_key when 'mixing' then 'mixing_pharmacist' else 'nurse' end;

  update app_features set enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
   where key = p_key and enabled is distinct from p_enabled;
  if not found then
    return jsonb_build_object('key', p_key, 'enabled', p_enabled, 'changed', false);
  end if;

  if not p_enabled then
    update user_activation_codes set revoked_at = now(), revoke_reason = 'أُوقف قسم هذا الدور'
     where role = v_role and used_at is null and revoked_at is null;
    get diagnostics v_revoked = row_count;
  elsif p_key = 'mixing' then
    -- الجرعات المعتمدة المفتوحة (ومنها ما اعتُمد والمزج موقوف) تأخذ طلبات مزجها
    for c in select cy.id from cycles cy join treatments t on t.id = cy.treatment_id
              where cy.status in ('planned', 'held') and cy.doctor_approved_by is not null and t.status = 'active' loop
      perform _sync_mixing(c.id, null);
      v_synced := v_synced + 1;
    end loop;
  end if;

  return jsonb_build_object('key', p_key, 'enabled', p_enabled, 'changed', true,
                            'revoked_codes', v_revoked, 'synced_cycles', v_synced);
end $$;
revoke all on function public.admin_set_feature(text, boolean) from public, anon;
grant execute on function public.admin_set_feature(text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- الحماية: لا يُسند دور قسم موقوف
create or replace function public._guard_disabled_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'profiles' then
    if new.role is distinct from old.role and not _role_enabled(new.role) then
      raise exception 'دور «%» غير متاح الآن لأن قسمه موقوف؛ اختر دوراً آخر', _role_label(new.role)
        using errcode = 'check_violation';
    end if;
    if new.acting_role is not null and new.acting_role is distinct from old.acting_role
       and not _role_enabled(new.acting_role) then
      raise exception 'دور «%» غير متاح الآن لأن قسمه موقوف', _role_label(new.acting_role)
        using errcode = 'check_violation';
    end if;
  else  -- user_activation_codes
    if new.role is not null and (tg_op = 'INSERT' or new.role is distinct from old.role)
       and not _role_enabled(new.role) then
      raise exception 'دور «%» غير متاح الآن لأن قسمه موقوف؛ اختر دوراً آخر للكود', _role_label(new.role)
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function public._guard_disabled_role() from public, anon, authenticated;

drop trigger if exists profiles_role_enabled on public.profiles;
create trigger profiles_role_enabled before update of role, acting_role on public.profiles
  for each row execute function public._guard_disabled_role();
drop trigger if exists codes_role_enabled on public.user_activation_codes;
create trigger codes_role_enabled before insert or update of role on public.user_activation_codes
  for each row execute function public._guard_disabled_role();

-- الحماية: المزج الموقوف لا يحضّر ولا يرسل ولا يستلم طلبات جديدة
-- (إلغاء علامة التحضير وتعليق الطلبات مسموحان: يفعلهما النظام عند تعديل الجرعة أو إغلاقها)
create or replace function public._guard_mixing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.feature_on('mixing') then return new; end if;
  if tg_table_name = 'mixing_orders' then
    raise exception 'قسم المزج موقوف حالياً' using errcode = 'insufficient_privilege';
  end if;
  if (new.prepared_at is not null and new.prepared_at is distinct from old.prepared_at)
     or (new.sent_at is not null and new.sent_at is distinct from old.sent_at) then
    raise exception 'قسم المزج موقوف حالياً' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function public._guard_mixing() from public, anon, authenticated;

drop trigger if exists mixing_orders_enabled on public.mixing_orders;
create trigger mixing_orders_enabled before insert on public.mixing_orders
  for each row execute function public._guard_mixing();
drop trigger if exists mixing_items_enabled on public.mixing_items;
create trigger mixing_items_enabled before update on public.mixing_items
  for each row execute function public._guard_mixing();

-- الحماية: التمريض الموقوف لا يسجّل إعطاء ولا تفاعلاً
create or replace function public._guard_nursing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.feature_on('nursing') then
    raise exception 'قسم التمريض موقوف حالياً' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function public._guard_nursing() from public, anon, authenticated;

drop trigger if exists administrations_enabled on public.administrations;
create trigger administrations_enabled before insert or update on public.administrations
  for each row execute function public._guard_nursing();

-- ---------------------------------------------------------------------
-- طلبات المزج: لا تُنشأ والمزج موقوف (تُزامَن عند التشغيل في admin_set_feature)
create or replace function public._sync_mixing(p_cycle uuid, p_by uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_new int;
begin
  if not public.feature_on('mixing') then return 0; end if;
  select * into v_c from cycles where id = p_cycle;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_c.doctor_approved_by is null or v_c.status not in ('planned', 'held') or v_t.status <> 'active' then
    return 0;
  end if;
  with ins as (
    insert into mixing_orders(cycle_id, day, patient_id, transferred_by)
    select p_cycle, x.day, v_t.patient_id, coalesce(p_by, v_c.doctor_approved_by)
      from (select distinct unnest(days_list(cd.days)) as day
              from cycle_doses cd where cd.cycle_id = p_cycle and cd.is_mixed and cd.archived_at is null) x
    on conflict (cycle_id, day) do nothing
    returning id)
  select count(*) into v_new from ins;

  insert into mixing_items(order_id, cycle_dose_id)
  select o.id, cd.id
    from mixing_orders o join cycle_doses cd on cd.cycle_id = o.cycle_id
   where o.cycle_id = p_cycle and cd.is_mixed and cd.archived_at is null and o.day = any(days_list(cd.days))
  on conflict (order_id, cycle_dose_id) do nothing;

  perform _refresh_orders(p_cycle);
  return v_new;
end $$;
revoke all on function public._sync_mixing(uuid, uuid) from public, anon, authenticated;

-- الإشعارات: لا تصل لدور قسمه موقوف
create or replace function public._notify_roles(p_roles user_role[], p_kind text, p_title text, p_body text,
                                                p_link_type text default null, p_link_id uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, kind, title, body, link_type, link_id)
  select p.id, p_kind, p_title, p_body, p_link_type, p_link_id
    from profiles p
   where p.status = 'active' and public._effective_role(p) = any(p_roles)
     and public._role_enabled(public._effective_role(p))
     and p.id is distinct from auth.uid()
$$;
revoke all on function public._notify_roles(user_role[], text, text, text, text, uuid) from public, anon, authenticated;

-- قفل الجرعة المحضّرة/المرسلة: لا يُطبَّق والمزج موقوف (لا أحد يزيل علامة التحضير)،
-- ولا على يوم أُكّد «تم إعطاء الجرعة بالكامل» فيه
create or replace function public._doses_changed(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  if not public.feature_on('mixing') then return; end if;
  select cd.drug_name, o.day, mi.sent_at is not null as sent into v
    from mixing_items mi join mixing_orders o on o.id = mi.order_id join cycle_doses cd on cd.id = mi.cycle_dose_id
   where mi.cycle_dose_id = any(p_ids) and (mi.sent_at is not null or mi.prepared_at is not null)
     and not exists (select 1 from administrations a where a.cycle_dose_id = mi.cycle_dose_id and a.day = o.day)
     and not exists (select 1 from cycle_day_completions x where x.cycle_id = o.cycle_id and x.day = o.day)
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

-- «تم إعطاء الجرعة بالكامل» لليوم: والتمريض موقوف يؤكده الطبيب أو الصيدلي بلا سجلات إعطاء لكل دواء
create or replace function public.complete_cycle_day(p_cycle uuid, p_day int)
returns text language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_days int[]; v_missing int; v_nursing boolean := public.feature_on('nursing');
begin
  if v_nursing then
    perform require_role('nurse', 'specialist', 'senior_resident', 'chief_clinical_pharmacist');
  else
    perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist', 'clinical_pharmacist');
  end if;
  select * into v_c from cycles where id = p_cycle for update;
  if v_c.id is null then raise exception 'الدورة غير موجودة'; end if;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.status <> 'active' then raise exception 'خطة العلاج غير فعّالة'; end if;
  if v_c.status not in ('planned', 'held') then raise exception 'الدورة مغلقة من قبل'; end if;
  if v_c.doctor_approved_by is null then raise exception 'لم يعتمد الطبيب هذه الدورة بعد'; end if;

  select array_agg(distinct d order by d) into v_days
    from cycle_doses cd, unnest(days_list(cd.days)) as d
   where cd.cycle_id = p_cycle and cd.archived_at is null;
  if v_days is null or not (p_day = any(v_days)) then raise exception 'لا توجد أدوية في اليوم % من الدورة', p_day; end if;
  if v_c.planned_date + (p_day - 1) > (now() at time zone 'Asia/Baghdad')::date then
    raise exception 'لم يحن موعد اليوم % من الدورة بعد', p_day;
  end if;

  if v_nursing then
    select count(*) into v_missing
      from cycle_doses cd
     where cd.cycle_id = p_cycle and cd.archived_at is null and p_day = any(days_list(cd.days))
       and not exists (select 1 from administrations a where a.cycle_dose_id = cd.id and a.day = p_day);
    if v_missing > 0 then
      raise exception 'لم يُسجَّل إعطاء كل أدوية اليوم % بعد (ناقص %)', p_day, v_missing;
    end if;
  end if;

  insert into cycle_day_completions(cycle_id, day) values (p_cycle, p_day)
  on conflict (cycle_id, day) do nothing;
  if not found then raise exception 'سُجّل اكتمال اليوم % من قبل', p_day; end if;

  -- آخر يوم متبقٍّ: تُغلق الجرعة كلها
  if not exists (select 1 from unnest(v_days) d
                  where not exists (select 1 from cycle_day_completions x where x.cycle_id = p_cycle and x.day = d)) then
    update cycles set status = 'given' where id = p_cycle;
    update mixing_orders set status = 'held', hold_reason = 'أُغلقت الدورة'
     where cycle_id = p_cycle and status <> 'sent';
    update treatments t set status = 'completed'
     where t.id = v_t.id
       and not exists (select 1 from cycles c where c.treatment_id = t.id and c.status in ('planned', 'held'));
    return 'cycle';
  end if;
  return 'day';
end $$;
revoke all on function public.complete_cycle_day(uuid, int) from public, anon;
grant execute on function public.complete_cycle_day(uuid, int) to authenticated;

-- تسجيل الإعطاء: يتوقف والتمريض موقوف؛ والمزج الموقوف لا يشترط إرسال الدواء من المزج
create or replace function public.record_administration(p_dose uuid, p_day int default 1,
                                                        p_vitals jsonb default '{}'::jsonb,
                                                        p_reaction text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_d cycle_doses; v_c cycles; v_t treatments; v_id uuid; v_name text;
begin
  if not public.feature_on('nursing') then
    raise exception 'قسم التمريض موقوف حالياً' using errcode = 'insufficient_privilege';
  end if;
  perform require_role('nurse');
  select cd.* into v_d from cycle_doses cd where cd.id = p_dose and cd.archived_at is null;
  if v_d.id is null then raise exception 'الجرعة غير موجودة'; end if;
  select * into v_c from cycles where id = v_d.cycle_id;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.status <> 'active' then raise exception 'خطة العلاج غير فعّالة'; end if;
  if v_c.status not in ('planned', 'held') then raise exception 'الدورة مغلقة'; end if;
  if v_c.doctor_approved_by is null then
    raise exception 'لم يعتمد الطبيب هذه الدورة بعد';
  end if;
  if not (p_day = any(days_list(v_d.days))) then raise exception 'هذا الدواء لا يُعطى في هذا اليوم'; end if;
  if v_c.planned_date + (p_day - 1) > (now() at time zone 'Asia/Baghdad')::date then
    raise exception 'لم يحن موعد اليوم % من الدورة بعد', p_day;
  end if;
  if exists (select 1 from administrations where cycle_dose_id = p_dose and day = p_day) then
    raise exception 'سُجّل إعطاء هذا الدواء في هذا اليوم من قبل';
  end if;
  if v_d.is_mixed and public.feature_on('mixing')
     and not exists (select 1 from mixing_items mi join mixing_orders o on o.id = mi.order_id
                      where mi.cycle_dose_id = p_dose and o.day = p_day and mi.sent_at is not null) then
    raise exception 'لم يُرسل هذا الدواء من قسم المزج بعد';
  end if;

  insert into administrations(cycle_dose_id, patient_id, day, vitals, reaction, notes)
  values (p_dose, v_t.patient_id, p_day, coalesce(p_vitals, '{}'::jsonb), nullif(trim(p_reaction), ''), nullif(trim(p_notes), ''))
  returning id into v_id;

  if p_reaction is not null and trim(p_reaction) <> '' then
    select full_name into v_name from patients where id = v_t.patient_id;
    perform _notify_all('alert', 'تفاعل أثناء الإعطاء: ' || v_name, v_d.drug_name || ': ' || trim(p_reaction),
                        'patient', v_t.patient_id);
  end if;
  return v_id;
end $$;
revoke all on function public.record_administration(uuid, int, jsonb, text, text) from public, anon;
grant execute on function public.record_administration(uuid, int, jsonb, text, text) to authenticated;
