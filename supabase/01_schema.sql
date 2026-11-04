-- =====================================================================
--  نظام متابعة مرضى الدم — الخطوة 1: قاعدة البيانات والصلاحيات
--  يُشغَّل مرة واحدة في: Supabase › SQL Editor › New query › Run
-- =====================================================================
--  المبادئ:
--  1) كل قراءة تمرّ بسياسات RLS: لا يرى البيانات إلا مستخدم مفعّل باشتراك ساري.
--  2) كل كتابة سريرية تمرّ بدوال مضبوطة الصلاحيات (RPC)، لا بكتابة مباشرة.
--  3) لا يُحذف شيء: الحذف أرشفة مع سبب، وسجل التعديلات لا يُعدَّل ولا يُحذف.
--  4) تعديلات الصيادلة لا تُطبَّق قبل موافقة الطبيب المختص.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. الأنواع
-- ---------------------------------------------------------------------
do $$ begin
  create type user_role as enum (
    'specialist',                 -- طبيب اختصاص
    'senior_resident',            -- طبيب مقيم أقدم
    'intern',                     -- طبيب دوري (عرض فقط)
    'clinical_pharmacist',        -- صيدلي سريري
    'chief_clinical_pharmacist',  -- مسؤول الصيادلة السريريين
    'mixing_pharmacist',          -- صيدلي المزج الكيميائي
    'nurse'                       -- ممرض
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_status as enum ('pending', 'active', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type change_kind as enum (
    'dose',       -- تعديل قيمة جرعة
    'infusion',   -- المحلول ومعدل التسريب
    'add_drug',   -- إضافة دواء
    'remove_drug',-- حذف (أرشفة) دواء
    'diagnosis',  -- التشخيص والمرحلة
    'protocol'    -- تغيير نوع البروتوكول
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. المستخدمون وأكواد التفعيل
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text not null,
  phone              text,
  role               user_role not null,
  status             user_status not null default 'pending',
  is_admin           boolean not null default false,
  subscription_ends  date,                 -- null للمدير = بلا انتهاء
  activated_at       timestamptz,
  created_at         timestamptz not null default now()
);
alter table public.profiles add column if not exists email text;

create table if not exists public.activation_codes (
  code        text primary key,
  role        user_role not null,
  months      int not null check (months between 1 and 36),
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid references public.profiles(id),
  used_at     timestamptz,
  revoked     boolean not null default false
);

-- ---------------------------------------------------------------------
-- 3. المرضى والبروتوكولات والعلاج
-- ---------------------------------------------------------------------
create sequence if not exists public.patient_file_seq;

create table if not exists public.patients (
  id              uuid primary key default gen_random_uuid(),
  file_no         text unique not null default
                    'HEM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.patient_file_seq')::text, 4, '0'),
  full_name       text not null,
  birth_date      date,
  sex             text check (sex in ('male', 'female')),
  height_cm       numeric(5,1) check (height_cm between 30 and 250),
  weight_kg       numeric(5,1) check (weight_kg between 1 and 300),
  phone           text,
  allergies       text,
  specialist_id   uuid references public.profiles(id),
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archive_reason  text
);

create table if not exists public.protocols (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  disease            text not null,
  kind               text not null default 'iv' check (kind in ('iv', 'oral', 'mixed')),
  cycle_length_days  int  not null check (cycle_length_days between 1 and 120),
  total_cycles       int  not null check (total_cycles between 1 and 60),
  notes              text,
  file_path          text,                 -- نسخة PDF في التخزين
  approved_by        uuid references public.profiles(id),
  approved_at        timestamptz,
  archived_at        timestamptz,
  created_by         uuid references public.profiles(id) default auth.uid(),
  created_at         timestamptz not null default now()
);

create table if not exists public.protocol_drugs (
  id           uuid primary key default gen_random_uuid(),
  protocol_id  uuid not null references public.protocols(id),
  drug_name    text not null,
  dose_value   numeric not null check (dose_value > 0),
  dose_unit    text not null check (dose_unit in ('mg/m2', 'mg/kg', 'mg', 'units/m2', 'units')),
  route        text not null,              -- IV / SC / PO ...
  days         text not null,              -- '1' أو '1,15' أو '1-5'
  max_dose     numeric,                    -- سقف الجرعة بوحدة الناتج
  is_mixed     boolean not null default true,  -- يُحضَّر في قسم المزج
  sort         int not null default 0
);

create table if not exists public.treatments (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references public.patients(id),
  protocol_id        uuid not null references public.protocols(id),
  protocol_name      text not null,
  diagnosis          text not null,
  icd10              text,
  stage              text,
  cycle_length_days  int not null,
  total_cycles       int not null,
  start_date         date not null,
  height_cm          numeric(5,1) not null,
  weight_kg          numeric(5,1) not null,
  bsa                numeric(4,2) not null,
  status             text not null default 'active'
                       check (status in ('pending_approval', 'active', 'completed', 'stopped')),
  stop_reason        text,
  created_by         uuid references public.profiles(id) default auth.uid(),
  approved_by        uuid references public.profiles(id),
  created_at         timestamptz not null default now()
);

create table if not exists public.cycles (
  id                       uuid primary key default gen_random_uuid(),
  treatment_id             uuid not null references public.treatments(id),
  cycle_no                 int not null,
  planned_date             date not null,
  status                   text not null default 'planned'
                             check (status in ('planned', 'held', 'given', 'cancelled')),
  postpone_reason          text,
  doctor_approved_by       uuid references public.profiles(id),
  doctor_approved_at       timestamptz,
  pharmacist_verified_by   uuid references public.profiles(id),
  pharmacist_verified_at   timestamptz,
  unique (treatment_id, cycle_no)
);

create table if not exists public.cycle_doses (
  id               uuid primary key default gen_random_uuid(),
  cycle_id         uuid not null references public.cycles(id),
  drug_name        text not null,
  route            text not null,
  days             text not null,
  dose_value       numeric,                -- الجرعة في البروتوكول (مثلاً 375)
  dose_unit        text,                   -- mg/m2 ...
  calculated       numeric,                -- الناتج قبل السقف
  final_dose       numeric not null,       -- الجرعة المعتمدة
  final_unit       text not null,          -- mg / units
  capped           boolean not null default false,
  is_mixed         boolean not null default true,
  diluent          text,
  infusion_rate    text,
  source           text not null default 'cycle1' check (source in ('protocol', 'cycle1', 'edited', 'added')),
  edited_from      numeric,
  sort             int not null default 0,
  archived_at      timestamptz,
  archive_reason   text
);

-- ---------------------------------------------------------------------
-- 4. المرفقات والتحاليل
-- ---------------------------------------------------------------------
create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id),
  kind         text not null check (kind in ('lab', 'id_card', 'prescription', 'imaging', 'report', 'other')),
  title        text,
  file_path    text not null,              -- المسار داخل حاوية patient-files
  taken_on     date,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.lab_results (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id),
  attachment_id  uuid references public.attachments(id),
  test_date      date not null,
  test_name      text not null,
  value          numeric not null,
  unit           text,
  ref_low        numeric,
  ref_high       numeric,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. طلبات التعديل وموافقة الطبيب المختص
-- ---------------------------------------------------------------------
create table if not exists public.change_requests (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients(id),
  treatment_id     uuid not null references public.treatments(id),
  cycle_id         uuid references public.cycles(id),
  requested_by     uuid not null references public.profiles(id),
  requester_role   user_role not null,
  reason_category  text,                   -- وظائف الكبد، الكلى، سمّية...
  report           text,                   -- تقرير الأسباب والملاحظات
  attachment_id    uuid references public.attachments(id),
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'partially_approved', 'rejected')),
  decided_by       uuid references public.profiles(id),
  decided_at       timestamptz,
  decision_note    text,                   -- سبب الرفض (اختياري)
  created_at       timestamptz not null default now()
);

create table if not exists public.change_request_items (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.change_requests(id),
  kind             change_kind not null,
  target_dose_id   uuid references public.cycle_doses(id),
  old_value        text,
  new_value        text,
  payload          jsonb not null default '{}'::jsonb,
  apply_onward     boolean not null default false,   -- هذه الدورة وما بعدها
  approved         boolean                           -- null = لم يُقرَّر
);

-- ---------------------------------------------------------------------
-- 6. المزج الكيميائي والإعطاء
-- ---------------------------------------------------------------------
create table if not exists public.mixing_orders (
  id                        uuid primary key default gen_random_uuid(),
  cycle_id                  uuid not null references public.cycles(id),
  day                       int  not null default 1,    -- يوم الإعطاء داخل الدورة (1، 15 ...)
  patient_id                uuid not null references public.patients(id),
  id_card_attachment_id     uuid not null references public.attachments(id),
  prescription_attachment_id uuid not null references public.attachments(id),
  transferred_by            uuid not null references public.profiles(id),
  transferred_at            timestamptz not null default now(),
  status                    text not null default 'incoming'
                              check (status in ('incoming', 'in_progress', 'partially_sent', 'sent', 'held')),
  unique (cycle_id, day)
);

create table if not exists public.mixing_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.mixing_orders(id),
  cycle_dose_id  uuid not null references public.cycle_doses(id),
  prepared_by    uuid references public.profiles(id),
  prepared_at    timestamptz,
  sent_by        uuid references public.profiles(id),
  sent_at        timestamptz,
  unique (order_id, cycle_dose_id)
);

create table if not exists public.administrations (
  id             uuid primary key default gen_random_uuid(),
  cycle_dose_id  uuid not null references public.cycle_doses(id),
  patient_id     uuid not null references public.patients(id),
  day            int  not null default 1,
  nurse_id       uuid not null references public.profiles(id) default auth.uid(),
  given_at       timestamptz not null default now(),
  vitals         jsonb not null default '{}'::jsonb,
  reaction       text,
  notes          text
);

-- ---------------------------------------------------------------------
-- 7. الإشعارات وسجل التعديلات
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id),
  kind        text not null,
  title       text not null,
  body        text,
  link_type   text,
  link_id     uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_role  user_role,
  action      text not null,              -- INSERT / UPDATE / DELETE
  table_name  text not null,
  row_id      text,
  old_data    jsonb,
  new_data    jsonb
);

create index if not exists idx_patients_specialist on public.patients(specialist_id);
create index if not exists idx_treatments_patient  on public.treatments(patient_id);
create index if not exists idx_cycles_date         on public.cycles(planned_date);
create index if not exists idx_doses_cycle         on public.cycle_doses(cycle_id);
create index if not exists idx_labs_patient        on public.lab_results(patient_id, test_date);
create index if not exists idx_attach_patient      on public.attachments(patient_id);
create index if not exists idx_cr_status           on public.change_requests(status);
create index if not exists idx_notif_user          on public.notifications(user_id, read_at);
create index if not exists idx_audit_row           on public.audit_log(table_name, row_id);

-- ---------------------------------------------------------------------
-- 8. دوال مساعدة للصلاحيات
-- ---------------------------------------------------------------------
create or replace function public.my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid() and status = 'active'), false)
$$;

-- مستخدم مفعّل واشتراكه ساري
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and status = 'active'
      and (is_admin or subscription_ends is null or subscription_ends >= current_date)
  )
$$;

create or replace function public.has_role(variadic roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and public.my_role() = any(roles)
$$;

-- يرفع خطأً واضحاً إذا لم يملك المستخدم أحد الأدوار
create or replace function public.require_role(variadic roles user_role[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() then
    raise exception 'الحساب غير مفعّل أو انتهى الاشتراك' using errcode = '42501';
  end if;
  if not (public.my_role() = any(roles)) then
    raise exception 'ليست لديك صلاحية لهذا الإجراء' using errcode = '42501';
  end if;
end $$;

-- مساحة سطح الجسم بمعادلة موستيلر
create or replace function public.bsa_mosteller(h numeric, w numeric) returns numeric
language sql immutable as $$
  select round(sqrt(h * w / 3600.0)::numeric, 2)
$$;

-- تحويل نص الأيام إلى قائمة: '1,15' ← {1,15} و '1-5' ← {1,2,3,4,5}
create or replace function public.days_list(p text) returns int[]
language plpgsql immutable as $$
declare part text; a int; b int; out int[] := '{}';
begin
  foreach part in array string_to_array(replace(coalesce(p, '1'), ' ', ''), ',') loop
    if part ~ '^\d+-\d+$' then
      a := split_part(part, '-', 1)::int; b := split_part(part, '-', 2)::int;
      out := out || array(select generate_series(a, b));
    elsif part ~ '^\d+$' then
      out := out || part::int;
    end if;
  end loop;
  return out;
end $$;

-- إرسال إشعار (داخلي)
create or replace function public._notify(p_user uuid, p_kind text, p_title text, p_body text,
                                          p_link_type text default null, p_link_id uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, kind, title, body, link_type, link_id)
  select p_user, p_kind, p_title, p_body, p_link_type, p_link_id
  where p_user is not null
$$;

-- إشعار كل المستخدمين المفعّلين من أدوار معينة (داخلي)
create or replace function public._notify_roles(p_roles user_role[], p_kind text, p_title text, p_body text,
                                                p_link_type text default null, p_link_id uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, kind, title, body, link_type, link_id)
  select id, p_kind, p_title, p_body, p_link_type, p_link_id
  from profiles
  where status = 'active' and role = any(p_roles)
$$;

-- الطبيب المختص للمريض، وإلا كل أطباء الاختصاص
create or replace function public._notify_specialist(p_patient uuid, p_kind text, p_title text, p_body text,
                                                     p_link_type text default null, p_link_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_sp uuid;
begin
  select specialist_id into v_sp from patients where id = p_patient;
  if v_sp is not null then
    perform _notify(v_sp, p_kind, p_title, p_body, p_link_type, p_link_id);
  else
    perform _notify_roles(array['specialist']::user_role[], p_kind, p_title, p_body, p_link_type, p_link_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. إنشاء الملف الشخصي عند التسجيل
--    الواجهة ترسل: full_name, phone, role في بيانات التسجيل
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role user_role;
begin
  begin
    v_role := (new.raw_user_meta_data->>'role')::user_role;
  exception when others then
    v_role := 'intern';   -- أقل صلاحية عند أي خطأ
  end;
  insert into profiles(id, full_name, phone, role, email)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          new.raw_user_meta_data->>'phone',
          coalesce(v_role, 'intern'),
          new.email);
  -- إشعار المدير بطلب تفعيل جديد
  insert into notifications(user_id, kind, title, body, link_type, link_id)
  select p.id, 'new_user', 'طلب تفعيل جديد',
         coalesce(new.raw_user_meta_data->>'full_name', new.email), 'profile', new.id
  from profiles p where p.is_admin;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 10. سجل التعديلات (يُكتب تلقائياً، ولا يُعدَّل ولا يُحذف)
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if tg_op = 'DELETE' then v_id := old.id::text; else v_id := new.id::text; end if;
  insert into audit_log(actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), public.my_role(), tg_op, tg_table_name, v_id,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'patients', 'protocols', 'protocol_drugs', 'treatments', 'cycles',
                           'cycle_doses', 'attachments', 'lab_results', 'change_requests',
                           'change_request_items', 'mixing_orders', 'mixing_items', 'administrations']
  loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- منع تعديل أو حذف سجل التعديلات حتى من المدير
create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'سجل التعديلات لا يُعدَّل ولا يُحذف';
end $$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- منع الحذف الفعلي من الجداول السريرية (الحذف = أرشفة)
create or replace function public.forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'الحذف غير مسموح، استخدم الأرشفة مع ذكر السبب';
end $$;

do $$
declare t text;
begin
  foreach t in array array['patients', 'protocols', 'protocol_drugs', 'treatments', 'cycles', 'cycle_doses',
                           'attachments', 'lab_results', 'change_requests', 'change_request_items',
                           'mixing_orders', 'mixing_items', 'administrations']
  loop
    execute format('drop trigger if exists no_delete_%1$s on public.%1$I', t);
    execute format('create trigger no_delete_%1$s before delete on public.%1$I
                    for each row execute function public.forbid_delete()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 11. أمان الصفوف (RLS)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles', 'activation_codes', 'patients', 'protocols', 'protocol_drugs',
                           'treatments', 'cycles', 'cycle_doses', 'attachments', 'lab_results',
                           'change_requests', 'change_request_items', 'mixing_orders', 'mixing_items',
                           'administrations', 'notifications', 'audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- الملف الشخصي: كل شخص يرى ملفه، والمفعّلون يرون أسماء زملائهم
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());

-- أكواد التفعيل: المدير فقط
drop policy if exists codes_admin on public.activation_codes;
create policy codes_admin on public.activation_codes for select to authenticated
  using (public.is_admin());

-- البيانات السريرية: قراءة لكل مستخدم مفعّل
do $$
declare t text;
begin
  foreach t in array array['patients', 'protocols', 'protocol_drugs', 'treatments', 'cycles', 'cycle_doses',
                           'attachments', 'lab_results', 'change_requests', 'change_request_items',
                           'mixing_orders', 'mixing_items', 'administrations']
  loop
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated
                    using (public.is_active_user())', t);
  end loop;
end $$;

-- سجل التعديلات: الأطباء (عدا الدوري) والصيادلة والمدير
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated
  using (public.is_admin() or public.has_role('specialist', 'senior_resident', 'clinical_pharmacist',
                                              'chief_clinical_pharmacist', 'mixing_pharmacist'));

-- الإشعارات: كل شخص يرى إشعاراته فقط
drop policy if exists notif_own on public.notifications;
create policy notif_own on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- تعديل الاسم والهاتف فقط في الملف الشخصي
grant update (full_name, phone) on public.profiles to authenticated;
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- 12. دوال المدير: أكواد التفعيل والمستخدمون والاشتراكات
-- ---------------------------------------------------------------------
create or replace function public.admin_create_code(p_role user_role, p_months int)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not public.is_admin() then raise exception 'للمدير فقط' using errcode = '42501'; end if;
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_chars, 1 + (get_byte(gen_random_bytes(1), 0) % length(v_chars)), 1);
      if i = 4 then v_code := v_code || '-'; end if;
    end loop;
    exit when not exists (select 1 from activation_codes where code = v_code);
  end loop;
  insert into activation_codes(code, role, months, created_by) values (v_code, p_role, p_months, auth.uid());
  return v_code;
end $$;

create or replace function public.admin_revoke_code(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'للمدير فقط' using errcode = '42501'; end if;
  update activation_codes set revoked = true where code = upper(p_code) and used_by is null;
end $$;

-- تعديل حالة مستخدم أو تخصصه أو اشتراكه
create or replace function public.admin_update_user(p_user uuid, p_status user_status default null,
                                                    p_role user_role default null,
                                                    p_subscription_ends date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'للمدير فقط' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_status is not null and p_status <> 'active' then
    raise exception 'لا يمكنك إيقاف حسابك';
  end if;
  update profiles set
    status = coalesce(p_status, status),
    role = coalesce(p_role, role),
    subscription_ends = coalesce(p_subscription_ends, subscription_ends)
  where id = p_user;
  if p_status = 'suspended' then
    perform _notify(p_user, 'account', 'أُوقف حسابك', 'راجع إدارة المركز');
  end if;
end $$;

-- تمديد الاشتراك بعدد أشهر
create or replace function public.admin_extend_subscription(p_user uuid, p_months int)
returns date language plpgsql security definer set search_path = public as $$
declare v_end date;
begin
  if not public.is_admin() then raise exception 'للمدير فقط' using errcode = '42501'; end if;
  update profiles
     set subscription_ends = (greatest(coalesce(subscription_ends, current_date), current_date)
                              + make_interval(months => p_months))::date
   where id = p_user
   returning subscription_ends into v_end;
  perform _notify(p_user, 'account', 'جُدّد اشتراكك', 'حتى ' || v_end::text);
  return v_end;
end $$;

-- ---------------------------------------------------------------------
-- 13. تفعيل الحساب بالكود (للمستخدم الجديد)
-- ---------------------------------------------------------------------
create or replace function public.redeem_activation_code(p_code text)
returns date language plpgsql security definer set search_path = public as $$
declare v_c activation_codes; v_p profiles; v_end date;
begin
  select * into v_p from profiles where id = auth.uid();
  if v_p.id is null then raise exception 'سجّل الدخول أولاً' using errcode = '42501'; end if;

  select * into v_c from activation_codes where code = upper(trim(p_code)) for update;
  if v_c.code is null then raise exception 'الكود غير صحيح'; end if;
  if v_c.revoked then raise exception 'أُلغي هذا الكود'; end if;
  if v_c.used_by is not null then raise exception 'استُخدم هذا الكود من قبل'; end if;
  if v_c.expires_at < now() then raise exception 'انتهت صلاحية الكود، اطلب كوداً جديداً'; end if;
  if v_c.role <> v_p.role then raise exception 'الكود لا يطابق التخصص الذي اخترته'; end if;

  v_end := (greatest(coalesce(v_p.subscription_ends, current_date), current_date)
            + make_interval(months => v_c.months))::date;

  update activation_codes set used_by = auth.uid(), used_at = now() where code = v_c.code;
  update profiles set status = 'active', subscription_ends = v_end,
                      activated_at = coalesce(activated_at, now())
   where id = auth.uid();
  return v_end;
end $$;

-- ---------------------------------------------------------------------
-- 14. المرضى
--     تسجيل المريض وتعديل بياناته: الأطباء (عدا الدوري) والصيادلة السريريون
-- ---------------------------------------------------------------------
create or replace function public.register_patient(p_full_name text, p_birth_date date, p_sex text,
                                                   p_height_cm numeric, p_weight_kg numeric,
                                                   p_phone text default null, p_allergies text default null,
                                                   p_specialist uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  if p_specialist is not null and not exists
     (select 1 from profiles where id = p_specialist and role = 'specialist') then
    raise exception 'الطبيب المختص المختار غير صحيح';
  end if;
  insert into patients(full_name, birth_date, sex, height_cm, weight_kg, phone, allergies, specialist_id)
  values (trim(p_full_name), p_birth_date, p_sex, p_height_cm, p_weight_kg, p_phone, p_allergies,
          coalesce(p_specialist, case when my_role() = 'specialist' then auth.uid() end))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_patient(p_id uuid, p_full_name text, p_birth_date date, p_sex text,
                                                 p_height_cm numeric, p_weight_kg numeric,
                                                 p_phone text, p_allergies text, p_specialist uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  update patients set full_name = trim(p_full_name), birth_date = p_birth_date, sex = p_sex,
                      height_cm = p_height_cm, weight_kg = p_weight_kg, phone = p_phone,
                      allergies = p_allergies, specialist_id = p_specialist
   where id = p_id and archived_at is null;
  if not found then raise exception 'المريض غير موجود أو مؤرشف'; end if;
end $$;

create or replace function public.archive_patient(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('specialist');
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الأرشفة'; end if;
  update patients set archived_at = now(), archive_reason = p_reason where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 15. البروتوكولات: الصيادلة والأطباء يضيفون، والطبيب المختص يعتمد
-- ---------------------------------------------------------------------
create or replace function public.create_protocol(p_name text, p_disease text, p_kind text,
                                                  p_cycle_length int, p_total_cycles int,
                                                  p_drugs jsonb, p_notes text default null,
                                                  p_file_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; d jsonb; i int := 0;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  insert into protocols(name, disease, kind, cycle_length_days, total_cycles, notes, file_path)
  values (trim(p_name), p_disease, p_kind, p_cycle_length, p_total_cycles, p_notes, p_file_path)
  returning id into v_id;
  for d in select * from jsonb_array_elements(p_drugs) loop
    i := i + 1;
    insert into protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, sort)
    values (v_id, d->>'drug_name', (d->>'dose_value')::numeric, d->>'dose_unit', d->>'route', d->>'days',
            nullif(d->>'max_dose', '')::numeric, coalesce((d->>'is_mixed')::boolean, true), i);
  end loop;
  if my_role() = 'specialist' then
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
  perform require_role('specialist');
  update protocols set approved_by = auth.uid(), approved_at = now() where id = p_id and archived_at is null;
end $$;

create or replace function public.archive_protocol(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('specialist');
  update protocols set archived_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 16. خطة العلاج والدورات والجرعات
-- ---------------------------------------------------------------------
-- حساب جرعة واحدة من البروتوكول
create or replace function public._calc_dose(p_value numeric, p_unit text, p_bsa numeric, p_weight numeric,
                                             p_max numeric, out calculated numeric, out final_dose numeric,
                                             out final_unit text, out capped boolean)
language plpgsql immutable as $$
begin
  calculated := case p_unit
                  when 'mg/m2'    then p_value * p_bsa
                  when 'units/m2' then p_value * p_bsa
                  when 'mg/kg'    then p_value * p_weight
                  else p_value end;
  -- التقريب: 10 فأكثر إلى عدد صحيح، وما دون 10 إلى منزلة عشرية واحدة
  calculated := case when calculated >= 10 then round(calculated, 0) else round(calculated, 1) end;
  final_unit := case when p_unit in ('units/m2', 'units') then 'units' else 'mg' end;
  capped := p_max is not null and calculated > p_max;
  final_dose := case when capped then p_max else calculated end;
end $$;

-- إنشاء الخطة كاملة (داخلي): الدورات بمواعيدها، وجرعات الدورة 1 من البروتوكول،
-- وباقي الدورات نسخة من جرعات الدورة 1
create or replace function public._create_treatment(p_patient uuid, p_protocol uuid, p_diagnosis text,
                                                    p_icd10 text, p_stage text, p_start date,
                                                    p_status text, p_first_cycle_no int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pt patients; v_pr protocols; v_tid uuid; v_bsa numeric; v_cid uuid; v_first uuid;
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

    if v_first is null then
      v_first := v_cid;
      for d in select * from protocol_drugs where protocol_id = p_protocol order by sort loop
        select * into c from _calc_dose(d.dose_value, d.dose_unit, v_bsa, v_pt.weight_kg, d.max_dose);
        insert into cycle_doses(cycle_id, drug_name, route, days, dose_value, dose_unit, calculated,
                                final_dose, final_unit, capped, is_mixed, source, sort)
        values (v_cid, d.drug_name, d.route, d.days, d.dose_value, d.dose_unit, c.calculated,
                c.final_dose, c.final_unit, c.capped, d.is_mixed, 'protocol', d.sort);
      end loop;
    else
      insert into cycle_doses(cycle_id, drug_name, route, days, dose_value, dose_unit, calculated,
                              final_dose, final_unit, capped, is_mixed, diluent, infusion_rate, source, sort)
      select v_cid, drug_name, route, days, dose_value, dose_unit, calculated,
             final_dose, final_unit, capped, is_mixed, diluent, infusion_rate, 'cycle1', sort
      from cycle_doses where cycle_id = v_first and archived_at is null;
    end if;
  end loop;
  return v_tid;
end $$;

-- إنشاء خطة علاج: من الطبيب تُفعَّل مباشرة، ومن الصيدلاني تنتظر موافقة الطبيب المختص
create or replace function public.create_treatment(p_patient uuid, p_protocol uuid, p_diagnosis text,
                                                   p_icd10 text, p_stage text, p_start date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tid uuid; v_status text;
begin
  perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist');
  if exists (select 1 from treatments where patient_id = p_patient and status in ('active', 'pending_approval')) then
    raise exception 'للمريض خطة علاج قائمة، أوقفها أو غيّر البروتوكول بطلب تعديل';
  end if;
  v_status := case when my_role() in ('specialist', 'senior_resident') then 'active' else 'pending_approval' end;
  v_tid := _create_treatment(p_patient, p_protocol, p_diagnosis, p_icd10, p_stage, p_start, v_status);
  if v_status = 'pending_approval' then
    perform _notify_specialist(p_patient, 'approval', 'خطة علاج بانتظار موافقتك',
                               (select full_name from patients where id = p_patient), 'treatment', v_tid);
  elsif my_role() = 'senior_resident' then
    perform _notify_specialist(p_patient, 'info', 'أنشأ الطبيب المقيم خطة علاج',
                               (select full_name from patients where id = p_patient), 'treatment', v_tid);
  end if;
  return v_tid;
end $$;

create or replace function public.approve_treatment(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_creator uuid;
begin
  perform require_role('specialist');
  update treatments set status = 'active', approved_by = auth.uid()
   where id = p_tid and status = 'pending_approval'
   returning created_by into v_creator;
  if not found then raise exception 'الخطة ليست بانتظار الموافقة'; end if;
  perform _notify(v_creator, 'decision', 'وافق الطبيب المختص على خطة العلاج', null, 'treatment', p_tid);
end $$;

create or replace function public.stop_treatment(p_tid uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('specialist', 'senior_resident');
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الإيقاف'; end if;
  update treatments set status = 'stopped', stop_reason = p_reason where id = p_tid and status <> 'stopped';
  update cycles set status = 'cancelled', postpone_reason = p_reason
   where treatment_id = p_tid and status in ('planned', 'held');
end $$;

-- تطبيق تعديل جرعة (داخلي): هذه الدورة، أو هذه وما بعدها
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
       and cd.archived_at is null;
  end if;
  -- أي تعديل يُسقط الاعتماد السابق للدورة
  update cycles set doctor_approved_by = null, doctor_approved_at = null,
                    pharmacist_verified_by = null, pharmacist_verified_at = null
   where id = v_c.id and not exists (select 1 from mixing_orders where cycle_id = v_c.id);
end $$;

-- تطبيق بند طلب تعديل (داخلي)
create or replace function public._apply_item(p_item change_request_items, p_cycle uuid, p_treatment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pl jsonb := p_item.payload; v_t treatments; v_next record;
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
    update cycle_doses cd set archived_at = now(), archive_reason = coalesce(v_pl->>'reason', 'حذف بموافقة الطبيب')
      from cycles c
     where cd.cycle_id = c.id and c.status in ('planned', 'held')
       and (cd.id = p_item.target_dose_id
            or (p_item.apply_onward and c.treatment_id = p_treatment
                and c.cycle_no > (select cycle_no from cycles where id = p_cycle)
                and cd.drug_name = (select drug_name from cycle_doses where id = p_item.target_dose_id)));
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

-- ---------------------------------------------------------------------
-- 17. تعديلات الأطباء المباشرة
--     الاختصاص والمقيم الأقدم: تُطبَّق فوراً. المقيم يُبلِّغ الطبيب المختص.
-- ---------------------------------------------------------------------
create or replace function public.doctor_edit(p_cycle uuid, p_items jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; it jsonb; v_item change_request_items; v_req uuid;
begin
  perform require_role('specialist', 'senior_resident');
  select * into v_c from cycles where id = p_cycle;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.id is null then raise exception 'الدورة غير موجودة'; end if;

  -- يُسجَّل كطلب موافَق عليه مباشرة، ليبقى أثره واضحاً في السجل
  insert into change_requests(patient_id, treatment_id, cycle_id, requested_by, requester_role, report,
                              status, decided_by, decided_at)
  values (v_t.patient_id, v_t.id, p_cycle, auth.uid(), my_role(), p_note, 'approved', auth.uid(), now())
  returning id into v_req;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into change_request_items(request_id, kind, target_dose_id, old_value, new_value, payload,
                                     apply_onward, approved)
    values (v_req, (it->>'kind')::change_kind, nullif(it->>'target_dose_id', '')::uuid,
            (select final_dose::text from cycle_doses where id = nullif(it->>'target_dose_id', '')::uuid),
            it->>'new_value', coalesce(it->'payload', '{}'::jsonb), coalesce((it->>'apply_onward')::boolean, false),
            true)
    returning * into v_item;
    perform _apply_item(v_item, p_cycle, v_t.id);
  end loop;

  if my_role() = 'senior_resident' then
    perform _notify_specialist(v_t.patient_id, 'info', 'عدّل الطبيب المقيم الأقدم خطة العلاج',
                               (select full_name from patients where id = v_t.patient_id), 'change_request', v_req);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 18. طلبات تعديل الصيادلة (لا تُطبَّق قبل موافقة الطبيب المختص)
--     الصيدلي السريري: الجرعة، المحلول والتسريب، الأدوية الداعمة فقط
--     مسؤول الصيادلة وصيدلي المزج: كل الأنواع
-- ---------------------------------------------------------------------
create or replace function public.submit_change_request(p_cycle uuid, p_items jsonb, p_reason_category text,
                                                        p_report text, p_attachment uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; it jsonb; v_req uuid; v_kind change_kind; v_role user_role;
begin
  perform require_role('clinical_pharmacist', 'chief_clinical_pharmacist', 'mixing_pharmacist');
  v_role := my_role();
  if coalesce(trim(p_report), '') = '' then raise exception 'اكتب تقرير أسباب التعديل للطبيب'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'لا توجد تعديلات'; end if;

  select * into v_c from cycles where id = p_cycle;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.id is null then raise exception 'الدورة غير موجودة'; end if;

  insert into change_requests(patient_id, treatment_id, cycle_id, requested_by, requester_role,
                              reason_category, report, attachment_id)
  values (v_t.patient_id, v_t.id, p_cycle, auth.uid(), v_role, p_reason_category, p_report, p_attachment)
  returning id into v_req;

  for it in select * from jsonb_array_elements(p_items) loop
    v_kind := (it->>'kind')::change_kind;
    if v_role = 'clinical_pharmacist' then
      if v_kind not in ('dose', 'infusion', 'add_drug') then
        raise exception 'الصيدلي السريري لا يعدّل التشخيص أو البروتوكول أو يحذف دواءً';
      end if;
      if v_kind = 'add_drug' and coalesce((it->'payload'->>'supportive')::boolean, false) = false then
        raise exception 'الصيدلي السريري يضيف الأدوية الداعمة فقط';
      end if;
    end if;
    insert into change_request_items(request_id, kind, target_dose_id, old_value, new_value, payload, apply_onward)
    values (v_req, v_kind, nullif(it->>'target_dose_id', '')::uuid,
            (select final_dose::text from cycle_doses where id = nullif(it->>'target_dose_id', '')::uuid),
            it->>'new_value', coalesce(it->'payload', '{}'::jsonb), coalesce((it->>'apply_onward')::boolean, false));
  end loop;

  perform _notify_specialist(v_t.patient_id, 'approval', 'طلب تعديل بانتظار موافقتك',
                             (select full_name from patients where id = v_t.patient_id), 'change_request', v_req);
  return v_req;
end $$;

-- قرار الطبيب المختص: الموافقة على بنود محددة أو رفض الطلب، مع سبب اختياري
create or replace function public.decide_change_request(p_req uuid, p_approved_items uuid[], p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_r change_requests; v_sp uuid; it change_request_items; v_n int := 0; v_total int := 0; v_status text;
begin
  perform require_role('specialist');
  select * into v_r from change_requests where id = p_req for update;
  if v_r.id is null or v_r.status <> 'pending' then raise exception 'الطلب غير موجود أو تقرّر من قبل'; end if;
  select specialist_id into v_sp from patients where id = v_r.patient_id;
  if v_sp is not null and v_sp <> auth.uid() then
    raise exception 'القرار للطبيب المختص بهذا المريض';
  end if;

  for it in select * from change_request_items where request_id = p_req loop
    v_total := v_total + 1;
    if it.id = any(coalesce(p_approved_items, '{}')) then
      perform _apply_item(it, v_r.cycle_id, v_r.treatment_id);
      update change_request_items set approved = true where id = it.id;
      v_n := v_n + 1;
    else
      update change_request_items set approved = false where id = it.id;
    end if;
  end loop;

  v_status := case when v_n = 0 then 'rejected' when v_n = v_total then 'approved' else 'partially_approved' end;
  update change_requests set status = v_status, decided_by = auth.uid(), decided_at = now(),
                             decision_note = nullif(trim(p_note), '')
   where id = p_req;

  perform _notify(v_r.requested_by, 'decision',
                  case v_status when 'approved' then 'وافق الطبيب على تعديلك'
                                when 'rejected' then 'رفض الطبيب تعديلك'
                                else 'وافق الطبيب على جزء من تعديلك' end,
                  nullif(trim(p_note), ''), 'change_request', p_req);
  return v_status;
end $$;

-- ---------------------------------------------------------------------
-- 19. اعتماد الدورة والتحقق منها وتأجيلها
-- ---------------------------------------------------------------------
create or replace function public.approve_cycle(p_cycle uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('specialist', 'senior_resident');
  update cycles set doctor_approved_by = auth.uid(), doctor_approved_at = now()
   where id = p_cycle and status = 'planned';
  if not found then raise exception 'الدورة غير قابلة للاعتماد'; end if;
end $$;

create or replace function public.verify_cycle(p_cycle uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('clinical_pharmacist', 'chief_clinical_pharmacist');
  if exists (select 1 from change_requests where cycle_id = p_cycle and status = 'pending') then
    raise exception 'توجد طلبات تعديل لم يقرّرها الطبيب بعد';
  end if;
  update cycles set pharmacist_verified_by = auth.uid(), pharmacist_verified_at = now()
   where id = p_cycle and doctor_approved_by is not null and status = 'planned';
  if not found then raise exception 'يجب اعتماد الطبيب قبل تحقق الصيدلاني'; end if;
end $$;

-- تأجيل الدورة، وإزاحة مواعيد الدورات التالية بالفرق نفسه
create or replace function public.postpone_cycle(p_cycle uuid, p_new_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_shift int;
begin
  perform require_role('specialist', 'senior_resident');
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب التأجيل'; end if;
  select * into v_c from cycles where id = p_cycle and status in ('planned', 'held');
  if v_c.id is null then raise exception 'الدورة غير قابلة للتأجيل'; end if;
  v_shift := p_new_date - v_c.planned_date;
  update cycles set planned_date = planned_date + v_shift,
                    postpone_reason = case when id = p_cycle then p_reason else postpone_reason end
   where treatment_id = v_c.treatment_id and cycle_no >= v_c.cycle_no and status in ('planned', 'held');
end $$;

-- ---------------------------------------------------------------------
-- 20. التحويل إلى قسم المزج والتحضير والإرسال
-- ---------------------------------------------------------------------
create or replace function public.transfer_to_mixing(p_cycle uuid, p_id_card uuid, p_prescription uuid,
                                                     p_day int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_oid uuid;
begin
  perform require_role('clinical_pharmacist', 'chief_clinical_pharmacist');
  select * into v_c from cycles where id = p_cycle;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_c.doctor_approved_by is null or v_c.pharmacist_verified_by is null then
    raise exception 'يجب اعتماد الطبيب وتحقق الصيدلاني قبل التحويل';
  end if;
  if v_t.status <> 'active' then raise exception 'خطة العلاج غير فعّالة'; end if;
  if p_id_card is null or p_prescription is null then
    raise exception 'أرفق صورة ملف تعريف المريض وصورة الوصفة الطبية';
  end if;
  if not exists (select 1 from attachments where id = p_id_card and patient_id = v_t.patient_id and kind = 'id_card')
     or not exists (select 1 from attachments where id = p_prescription and patient_id = v_t.patient_id and kind = 'prescription') then
    raise exception 'المرفقات لا تخص هذا المريض أو نوعها غير صحيح';
  end if;

  if exists (select 1 from mixing_orders where cycle_id = p_cycle and day = p_day) then
    raise exception 'حُوّلت جرع هذا اليوم إلى المزج من قبل';
  end if;
  if not exists (select 1 from cycle_doses where cycle_id = p_cycle and is_mixed and archived_at is null
                   and p_day = any(days_list(days))) then
    raise exception 'لا توجد أدوية تُحضَّر في هذا اليوم من الدورة';
  end if;

  insert into mixing_orders(cycle_id, day, patient_id, id_card_attachment_id, prescription_attachment_id, transferred_by)
  values (p_cycle, p_day, v_t.patient_id, p_id_card, p_prescription, auth.uid())
  returning id into v_oid;

  insert into mixing_items(order_id, cycle_dose_id)
  select v_oid, id from cycle_doses
   where cycle_id = p_cycle and is_mixed and archived_at is null and p_day = any(days_list(days));

  perform _notify_roles(array['mixing_pharmacist']::user_role[], 'mixing', 'طلب مزج جديد',
                        (select full_name from patients where id = v_t.patient_id), 'mixing_order', v_oid);
  return v_oid;
end $$;

-- علامة الصح على دواء محضَّر (أو إزالتها قبل الإرسال)
create or replace function public.mark_prepared(p_item uuid, p_prepared boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_oid uuid;
begin
  perform require_role('mixing_pharmacist');
  update mixing_items set prepared_by = case when p_prepared then auth.uid() end,
                          prepared_at = case when p_prepared then now() end
   where id = p_item and sent_at is null
   returning order_id into v_oid;
  if not found then raise exception 'الدواء أُرسل من قبل ولا يمكن تغييره'; end if;
  update mixing_orders set status = 'in_progress' where id = v_oid and status = 'incoming';
end $$;

-- إرسال المحضَّر: يكفي دواء واحد، ويصل الإشعار للصيادلة السريريين والتمريض معاً
create or replace function public.send_prepared(p_order uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_left int; v_name text;
begin
  perform require_role('mixing_pharmacist');
  update mixing_items set sent_by = auth.uid(), sent_at = now()
   where order_id = p_order and prepared_at is not null and sent_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'ضع علامة الصح على دواء واحد على الأقل'; end if;

  select count(*) into v_left from mixing_items where order_id = p_order and sent_at is null;
  update mixing_orders set status = case when v_left = 0 then 'sent' else 'partially_sent' end where id = p_order;

  select p.full_name into v_name from mixing_orders o join patients p on p.id = o.patient_id where o.id = p_order;
  perform _notify_roles(array['clinical_pharmacist', 'chief_clinical_pharmacist', 'nurse']::user_role[],
                        'mixing_sent', 'وصلت أدوية محضّرة من قسم المزج',
                        v_name || ' · ' || v_n || ' دواء', 'mixing_order', p_order);
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 21. الإعطاء (التمريض)
-- ---------------------------------------------------------------------
create or replace function public.record_administration(p_dose uuid, p_day int default 1,
                                                        p_vitals jsonb default '{}'::jsonb,
                                                        p_reaction text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_d cycle_doses; v_pid uuid; v_id uuid;
begin
  perform require_role('nurse');
  select cd.* into v_d from cycle_doses cd where cd.id = p_dose and cd.archived_at is null;
  if v_d.id is null then raise exception 'الجرعة غير موجودة'; end if;
  if not (p_day = any(days_list(v_d.days))) then raise exception 'هذا الدواء لا يُعطى في هذا اليوم'; end if;
  if exists (select 1 from administrations where cycle_dose_id = p_dose and day = p_day) then
    raise exception 'سُجّل إعطاء هذا الدواء في هذا اليوم من قبل';
  end if;
  if v_d.is_mixed and not exists (select 1 from mixing_items mi join mixing_orders o on o.id = mi.order_id
                                   where mi.cycle_dose_id = p_dose and o.day = p_day and mi.sent_at is not null) then
    raise exception 'لم يُرسل هذا الدواء من قسم المزج بعد';
  end if;
  select t.patient_id into v_pid
    from cycles c join treatments t on t.id = c.treatment_id where c.id = v_d.cycle_id;

  insert into administrations(cycle_dose_id, patient_id, day, vitals, reaction, notes)
  values (p_dose, v_pid, p_day, coalesce(p_vitals, '{}'::jsonb), p_reaction, p_notes)
  returning id into v_id;

  if p_reaction is not null and trim(p_reaction) <> '' then
    perform _notify_specialist(v_pid, 'alert', 'تفاعل أثناء الإعطاء', v_d.drug_name || ': ' || p_reaction,
                               'patient', v_pid);
  end if;
  return v_id;
end $$;

-- إغلاق الدورة بعد اكتمال إعطائها
create or replace function public.complete_cycle(p_cycle uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tid uuid;
begin
  perform require_role('specialist', 'senior_resident', 'nurse');
  update cycles set status = 'given' where id = p_cycle and status in ('planned', 'held')
   returning treatment_id into v_tid;
  if not found then raise exception 'الدورة مغلقة من قبل'; end if;
  update treatments t set status = 'completed'
   where t.id = v_tid
     and not exists (select 1 from cycles c where c.treatment_id = t.id and c.status in ('planned', 'held'));
end $$;

-- ---------------------------------------------------------------------
-- 22. المرفقات والتحاليل والإشعارات
-- ---------------------------------------------------------------------
create or replace function public.add_attachment(p_patient uuid, p_kind text, p_file_path text,
                                                 p_title text default null, p_taken_on date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist',
                       'mixing_pharmacist', 'nurse');
  if p_file_path not like 'patients/' || p_patient::text || '/%' then
    raise exception 'مسار الملف غير صحيح';
  end if;
  insert into attachments(patient_id, kind, title, file_path, taken_on)
  values (p_patient, p_kind, p_title, p_file_path, p_taken_on)
  returning id into v_id;
  return v_id;
end $$;

-- p_results: [{test_name, value, unit, ref_low, ref_high}]
create or replace function public.add_lab_results(p_patient uuid, p_test_date date, p_results jsonb,
                                                  p_attachment uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v_out text := '';
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist', 'nurse');
  for r in select * from jsonb_array_elements(p_results) loop
    insert into lab_results(patient_id, attachment_id, test_date, test_name, value, unit, ref_low, ref_high)
    values (p_patient, p_attachment, p_test_date, r->>'test_name', (r->>'value')::numeric, r->>'unit',
            nullif(r->>'ref_low', '')::numeric, nullif(r->>'ref_high', '')::numeric);
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

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;

-- ---------------------------------------------------------------------
-- 23. صلاحيات تنفيذ الدوال
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname like '\_%' or f.proname in ('handle_new_user', 'audit_trigger', 'audit_log_immutable', 'forbid_delete') then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
