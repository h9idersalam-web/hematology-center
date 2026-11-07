-- =====================================================================
--  26: الصيدلية الداخلية (بقرار صاحب المشروع)
--   تقرير أسبوعي يرفعه مسؤول الصيدلية الداخلية من ملف إكسل (أو ينسخه من الأسبوع السابق)،
--   ويضيف ويعدّل ويحذف أدويته كل أسبوع. لكل دواء: الاسم والعدد والوحدة وتاريخ انتهاء الصلاحية
--   والحالة (متوفر/شحيح/نافد) وملاحظات. يظهر في تبويب «الصيدلية» لكل المستخدمين (قراءة).
--  لا حذف فعلي: «الحذف» أرشفة، وكل تغيير في سجل التعديلات.
--  يحتاج الملف 25 منفّذاً قبله (في تنفيذ منفصل).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. اسم الدور بالعربية (للإشعارات)، وتغيير الدور من المدير يذكر الدور الجديد
-- ---------------------------------------------------------------------
create or replace function public._role_label(p_role user_role) returns text
language sql immutable set search_path = '' as $$
  select case p_role::text
    when 'specialist' then 'طبيب اختصاص' when 'senior_resident' then 'طبيب مقيم أقدم'
    when 'intern' then 'طبيب دوري' when 'clinical_pharmacist' then 'صيدلي سريري'
    when 'chief_clinical_pharmacist' then 'مسؤول الصيادلة السريريين'
    when 'mixing_pharmacist' then 'صيدلي المزج الكيميائي'
    when 'internal_pharmacist' then 'مسؤول الصيدلية الداخلية'
    else 'ممرض' end
$$;
revoke all on function public._role_label(user_role) from public, anon, authenticated;

create or replace function public.admin_update_user(p_user uuid, p_status user_status default null,
                                                    p_role user_role default null,
                                                    p_subscription_ends date default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_p profiles; v_n int;
begin
  perform _require_admin();
  if p_status is not null then
    raise exception 'غيّر الحالة بأزرار الإيقاف وإعادة التفعيل، والتفعيل بالكود';
  end if;
  select * into v_p from profiles where id = p_user for update;
  if v_p.id is null or v_p.deleted_at is not null then raise exception 'المستخدم غير موجود'; end if;
  if p_role is not null and p_role <> v_p.role then
    if p_user = auth.uid() then
      raise exception 'لا تغيّر دورك المسجّل من هنا؛ اختر دور العمل من صفحتك الرئيسية';
    end if;
    if v_p.role = 'specialist' then
      select count(*) into v_n from patients where specialist_id = p_user and archived_at is null;
      if v_n > 0 then
        raise exception 'هذا الطبيب مختص لـ % من المرضى. انقلهم إلى طبيب اختصاص آخر من ملف كل مريض أولاً', v_n;
      end if;
    end if;
    update profiles set role = p_role,
                        is_deputy = case when p_role = 'clinical_pharmacist' then is_deputy else false end,
                        deputy_active = case when p_role = 'clinical_pharmacist' then deputy_active else false end
     where id = p_user;
    update user_activation_codes set role = p_role
     where user_id = p_user and used_at is null and revoked_at is null;
    perform _notify(p_user, 'info', 'غيّر المدير صلاحيتك', 'دورك الآن: ' || _role_label(p_role), null, null);
  end if;
  if p_subscription_ends is not null then
    update profiles set subscription_ends = p_subscription_ends where id = p_user;
  end if;
end $$;

-- تاريخ اليوم بتوقيت بغداد (الخادم يعمل بتوقيت غرينتش)
create or replace function public.baghdad_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Baghdad')::date
$$;

-- ---------------------------------------------------------------------
-- 2. الجداول
-- ---------------------------------------------------------------------
create table if not exists public.inventory_reports (
  id              uuid primary key default gen_random_uuid(),
  report_date     date not null,
  source          text,                         -- اسم ملف الإكسل، أو «نسخة من تقرير سابق»، أو «إدخال يدوي»
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid references public.profiles(id),
  archive_reason  text
);
create index if not exists idx_inventory_reports_date on public.inventory_reports(report_date desc, created_at desc);

create table if not exists public.inventory_items (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.inventory_reports(id),
  drug_name    text not null check (length(btrim(drug_name)) between 1 and 200),
  quantity     numeric check (quantity is null or quantity >= 0),
  unit         text check (unit is null or length(unit) <= 40),
  expiry_date  date,
  status       text not null default 'available' check (status in ('available', 'low', 'out')),
  notes        text check (notes is null or length(notes) <= 500),
  sort         int not null default 0,
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz,
  archived_at  timestamptz,
  archived_by  uuid references public.profiles(id)
);
create index if not exists idx_inventory_items_report on public.inventory_items(report_id, sort);

-- سجل التعديلات ومنع الحذف الفعلي، والقراءة فقط من الواجهة (الكتابة عبر الدوال)
do $$
declare t text;
begin
  foreach t in array array['inventory_reports', 'inventory_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, trigger, references on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
    execute format('drop trigger if exists no_delete_%1$s on public.%1$I', t);
    execute format('create trigger no_delete_%1$s before delete on public.%1$I
                    for each row execute function public.forbid_delete()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. القراءة
-- ---------------------------------------------------------------------
drop policy if exists inventory_reports_read on public.inventory_reports;
create policy inventory_reports_read on public.inventory_reports for select to authenticated
  using ((select public.is_active_user()));

drop policy if exists inventory_items_read on public.inventory_items;
create policy inventory_items_read on public.inventory_items for select to authenticated
  using ((select public.is_active_user()));

-- ---------------------------------------------------------------------
-- 4. تقرير الصيدلية الداخلية
-- ---------------------------------------------------------------------
create or replace function public._require_inventory() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_active_user() then
    raise exception 'الحساب غير مفعّل أو انتهى الاشتراك' using errcode = '42501';
  end if;
  if not (my_role() = 'internal_pharmacist' or is_admin()) then
    raise exception 'تقرير الصيدلية الداخلية يعدّله مسؤول الصيدلية الداخلية فقط' using errcode = '42501';
  end if;
end $$;

-- يتحقق من دواء واحد ويعيده منظّفاً
create or replace function public._inventory_clean(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare v_name text; v_qty numeric; v_status text;
begin
  v_name := nullif(btrim(coalesce(p->>'drug_name', '')), '');
  if v_name is null then raise exception 'اكتب اسم الدواء'; end if;
  if length(v_name) > 200 then raise exception 'اسم الدواء طويل جداً'; end if;
  begin
    v_qty := nullif(btrim(coalesce(p->>'quantity', '')), '')::numeric;
  exception when others then
    raise exception 'العدد غير صحيح للدواء %', v_name;
  end;
  if v_qty < 0 then raise exception 'العدد لا يكون سالباً (%)', v_name; end if;
  v_status := coalesce(nullif(p->>'status', ''), case when v_qty = 0 then 'out' else 'available' end);
  if v_status not in ('available', 'low', 'out') then raise exception 'حالة الدواء غير صحيحة (%)', v_name; end if;
  return jsonb_build_object(
    'drug_name', v_name, 'quantity', v_qty,
    'unit', nullif(btrim(coalesce(p->>'unit', '')), ''),
    'expiry_date', nullif(p->>'expiry_date', '')::date,
    'status', v_status,
    'notes', nullif(btrim(coalesce(p->>'notes', '')), ''));
end $$;

-- تقرير أسبوعي جديد بأدويته (من ملف إكسل، أو نسخة من تقرير سابق، أو فارغ)
create or replace function public.inventory_create_report(p_report_date date, p_source text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_it jsonb; v_c jsonb; v_i int := 0; v_low int; v_out int;
begin
  perform _require_inventory();
  if p_report_date is null or p_report_date > baghdad_today() + 7 or p_report_date < baghdad_today() - 60 then
    raise exception 'تاريخ التقرير غير صحيح';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'قائمة الأدوية غير صحيحة'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 2000 then raise exception 'عدد الأدوية كبير جداً (الحد 2000)'; end if;

  insert into inventory_reports(report_date, source, created_by)
  values (p_report_date, left(nullif(btrim(coalesce(p_source, '')), ''), 200), auth.uid())
  returning id into v_id;

  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_c := _inventory_clean(v_it);
    v_i := v_i + 1;
    insert into inventory_items(report_id, drug_name, quantity, unit, expiry_date, status, notes, sort, created_by)
    values (v_id, v_c->>'drug_name', (v_c->>'quantity')::numeric, v_c->>'unit', (v_c->>'expiry_date')::date,
            v_c->>'status', v_c->>'notes', v_i, auth.uid());
  end loop;

  select count(*) filter (where status = 'low'), count(*) filter (where status = 'out')
    into v_low, v_out from inventory_items where report_id = v_id;
  perform _notify_roles(array['specialist', 'senior_resident', 'intern', 'clinical_pharmacist', 'chief_clinical_pharmacist',
                              'mixing_pharmacist', 'nurse', 'internal_pharmacist']::user_role[],
          'info', 'تقرير الصيدلية الداخلية الجديد',
          v_i || ' دواءً' || case when v_low + v_out > 0 then ' · ' || v_low || ' شحيح و' || v_out || ' نافد' else '' end,
          'inventory_report', v_id);
  return v_id;
end $$;

-- إضافة دواء (p_item = null) أو تعديله
create or replace function public.inventory_save_item(p_report uuid, p_item uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_r inventory_reports; v_c jsonb; v_id uuid;
begin
  perform _require_inventory();
  v_c := _inventory_clean(p_data);
  if p_item is null then
    select * into v_r from inventory_reports where id = p_report for update;
    if v_r.id is null or v_r.archived_at is not null then raise exception 'التقرير غير موجود'; end if;
    insert into inventory_items(report_id, drug_name, quantity, unit, expiry_date, status, notes, sort, created_by)
    values (p_report, v_c->>'drug_name', (v_c->>'quantity')::numeric, v_c->>'unit', (v_c->>'expiry_date')::date,
            v_c->>'status', v_c->>'notes',
            coalesce((select max(sort) from inventory_items where report_id = p_report), 0) + 1, auth.uid())
    returning id into v_id;
  else
    update inventory_items i
       set drug_name = v_c->>'drug_name', quantity = (v_c->>'quantity')::numeric, unit = v_c->>'unit',
           expiry_date = (v_c->>'expiry_date')::date, status = v_c->>'status', notes = v_c->>'notes',
           updated_by = auth.uid(), updated_at = now()
      from inventory_reports r
     where i.id = p_item and r.id = i.report_id and i.archived_at is null and r.archived_at is null
    returning i.id, i.report_id into v_id, p_report;
    if v_id is null then raise exception 'الدواء غير موجود أو حُذف'; end if;
  end if;
  update inventory_reports set updated_at = now() where id = p_report;
  return v_id;
end $$;

-- «حذف» دواء من التقرير: أرشفة
create or replace function public.inventory_remove_item(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_rep uuid;
begin
  perform _require_inventory();
  update inventory_items set archived_at = now(), archived_by = auth.uid()
   where id = p_item and archived_at is null
  returning report_id into v_rep;
  if v_rep is null then raise exception 'الدواء غير موجود أو حُذف'; end if;
  update inventory_reports set updated_at = now() where id = v_rep;
end $$;

-- «حذف» تقرير كامل (رُفع خطأً): أرشفة مع السبب
create or replace function public.inventory_archive_report(p_report uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_inventory();
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'اذكر سبب الحذف'; end if;
  update inventory_reports set archived_at = now(), archived_by = auth.uid(), archive_reason = btrim(p_reason)
   where id = p_report and archived_at is null;
  if not found then raise exception 'التقرير غير موجود أو حُذف'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. صلاحيات التنفيذ
-- ---------------------------------------------------------------------
revoke all on function public._require_inventory() from public, anon, authenticated;
revoke all on function public._inventory_clean(jsonb) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.baghdad_today()',
                           'public.inventory_create_report(date, text, jsonb)', 'public.inventory_save_item(uuid, uuid, jsonb)',
                           'public.inventory_remove_item(uuid)', 'public.inventory_archive_report(uuid, text)',
                           'public.admin_update_user(uuid, user_status, user_role, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
