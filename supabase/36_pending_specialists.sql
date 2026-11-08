-- =====================================================================
-- 36: أطباء اختصاص قبل انضمامهم للتطبيق (بطلب صاحب المشروع 2026/11/8)
--   1. المدير يضيف الطبيب باسمه فقط، فيظهر في قائمة «الطبيب المختص» عند تسجيل المرضى بعبارة «لم ينضم بعد».
--   2. عند انضمامه وتفعيله طبيب اختصاص يربطه المدير بالاسم المضاف، فينتقل كل مرضاه لحسابه دفعة واحدة.
--   3. قبل انضمامه يوافق المدير على خطط مرضاه وهو يعمل بدور طبيب الاختصاص، وتصل إشعاراتهم للمدير.
--   لا يحذف شيئاً. register_patient وupdate_patient بالتوقيع نفسه: p_specialist يقبل حساب طبيب أو طبيباً مضافاً مسبقاً.
-- =====================================================================

create table if not exists public.pending_specialists (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (length(trim(full_name)) between 3 and 120),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  linked_to   uuid references public.profiles(id),
  linked_at   timestamptz,
  archived_at timestamptz
);
create unique index if not exists uq_pending_specialist_name on public.pending_specialists (lower(trim(full_name)))
  where linked_at is null and archived_at is null;
alter table public.pending_specialists enable row level security;
drop policy if exists pending_specialists_read on public.pending_specialists;
create policy pending_specialists_read on public.pending_specialists for select to authenticated using (public.is_active_user());
revoke all on public.pending_specialists from anon, public;
grant select on public.pending_specialists to authenticated;
drop trigger if exists audit_pending_specialists on public.pending_specialists;
create trigger audit_pending_specialists after insert or update or delete on public.pending_specialists
  for each row execute function public.audit_trigger();
drop trigger if exists no_delete_pending_specialists on public.pending_specialists;
create trigger no_delete_pending_specialists before delete on public.pending_specialists
  for each row execute function public.forbid_delete();

alter table public.patients add column if not exists pending_specialist_id uuid references public.pending_specialists(id);
create index if not exists idx_patients_pending_specialist on public.patients(pending_specialist_id);

-- الطبيب المختار: حساب طبيب اختصاص، أو طبيب مضاف مسبقاً لم ينضم بعد
create or replace function public._resolve_specialist(p_id uuid, out o_specialist uuid, out o_pending uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from profiles where id = p_id and role = 'specialist') then o_specialist := p_id; return; end if;
  if exists (select 1 from pending_specialists where id = p_id and linked_at is null and archived_at is null) then o_pending := p_id; return; end if;
  raise exception 'الطبيب المختص المختار غير صحيح';
end $$;

create or replace function public.register_patient(p_full_name text, p_birth_date date, p_sex text,
                                                   p_height_cm numeric, p_weight_kg numeric,
                                                   p_phone text default null, p_allergies text default null,
                                                   p_specialist uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sp uuid; r record;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  v_sp := coalesce(p_specialist, case when my_role() = 'specialist' then auth.uid() end);
  if v_sp is null then raise exception 'اختر الطبيب المختص بالمريض'; end if;
  select * into r from _resolve_specialist(v_sp);
  insert into patients(full_name, birth_date, sex, height_cm, weight_kg, phone, allergies, specialist_id, pending_specialist_id)
  values (trim(p_full_name), p_birth_date, p_sex, p_height_cm, p_weight_kg, p_phone, p_allergies, r.o_specialist, r.o_pending)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_patient(p_id uuid, p_full_name text, p_birth_date date, p_sex text,
                                                 p_height_cm numeric, p_weight_kg numeric,
                                                 p_phone text, p_allergies text, p_specialist uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  if p_specialist is null then raise exception 'اختر الطبيب المختص بالمريض'; end if;
  select * into r from _resolve_specialist(p_specialist);
  update patients set full_name = trim(p_full_name), birth_date = p_birth_date, sex = p_sex,
                      height_cm = p_height_cm, weight_kg = p_weight_kg, phone = p_phone,
                      allergies = p_allergies, specialist_id = r.o_specialist, pending_specialist_id = r.o_pending
   where id = p_id and archived_at is null;
  if not found then raise exception 'المريض غير موجود أو مؤرشف'; end if;
end $$;

-- 3. القرار على خطط مريض طبيبه لم ينضم بعد: للمدير وهو يعمل بدور طبيب الاختصاص
create or replace function public._require_patient_specialist(p_patient uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_sp uuid; v_pending uuid;
begin
  perform require_role('specialist');
  select specialist_id, pending_specialist_id into v_sp, v_pending from patients where id = p_patient;
  if v_sp is null and v_pending is not null then
    if not is_admin() then raise exception 'طبيب هذا المريض لم ينضم بعد: القرار لمدير البرنامج حتى انضمامه' using errcode = '42501'; end if;
    return;
  end if;
  if v_sp is null then raise exception 'حدّد الطبيب المختص للمريض أولاً من ملفه'; end if;
  if v_sp <> auth.uid() then raise exception 'القرار للطبيب المختص بهذا المريض فقط' using errcode = '42501'; end if;
end $$;

-- إشعارات طبيب لم ينضم بعد تصل لمدير البرنامج
create or replace function public._notify_specialist(p_patient uuid, p_kind text, p_title text, p_body text,
                                                     p_link_type text default null, p_link_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_sp uuid; v_pending uuid; a record;
begin
  select specialist_id, pending_specialist_id into v_sp, v_pending from patients where id = p_patient;
  if v_sp is not null then
    perform _notify(v_sp, p_kind, p_title, p_body, p_link_type, p_link_id);
  elsif v_pending is not null then
    for a in select id from profiles where is_admin and status = 'active' and id is distinct from auth.uid() loop
      perform _notify(a.id, p_kind, p_title, p_body, p_link_type, p_link_id);
    end loop;
  else
    perform _notify_roles(array['specialist']::user_role[], p_kind, p_title, p_body, p_link_type, p_link_id);
  end if;
end $$;

-- 1. إضافة طبيب بالاسم
create or replace function public.admin_add_pending_specialist(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  perform _require_admin();
  if length(v_name) < 3 then raise exception 'اكتب اسم الطبيب'; end if;
  if exists (select 1 from pending_specialists where lower(full_name) = lower(v_name) and linked_at is null and archived_at is null) then
    raise exception 'هذا الاسم مضاف من قبل';
  end if;
  insert into pending_specialists(full_name) values (v_name) returning id into v_id;
  return v_id;
end $$;

-- إخفاء اسم أُضيف بالخطأ (أرشفة، بلا مرضى فقط)
create or replace function public.admin_archive_pending_specialist(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin();
  if exists (select 1 from patients where pending_specialist_id = p_id) then
    raise exception 'لهذا الطبيب مرضى: انقلهم لطبيب آخر أو اربطه بحسابه عند انضمامه';
  end if;
  update pending_specialists set archived_at = now() where id = p_id and linked_at is null and archived_at is null;
  if not found then raise exception 'غير موجود'; end if;
end $$;

-- 2. الربط عند الانضمام: ينتقل كل مرضاه إلى حسابه
create or replace function public.admin_link_pending_specialist(p_pending uuid, p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_name text;
begin
  perform _require_admin();
  if not exists (select 1 from profiles where id = p_user and role = 'specialist' and status = 'active') then
    raise exception 'الحساب المختار ليس طبيب اختصاص مفعّلاً';
  end if;
  select full_name into v_name from pending_specialists where id = p_pending and linked_at is null and archived_at is null;
  if v_name is null then raise exception 'الطبيب المضاف غير موجود أو رُبط من قبل'; end if;
  update patients set specialist_id = p_user, pending_specialist_id = null where pending_specialist_id = p_pending;
  get diagnostics v_n = row_count;
  update pending_specialists set linked_to = p_user, linked_at = now() where id = p_pending;
  perform _notify(p_user, 'info', 'نُقل إليك مرضاك المسجّلون قبل انضمامك', v_n || ' مريض', null, null);
  return v_n;
end $$;

revoke all on function public._resolve_specialist(uuid) from public, anon, authenticated;
revoke all on function public.admin_add_pending_specialist(text) from public, anon;
grant execute on function public.admin_add_pending_specialist(text) to authenticated;
revoke all on function public.admin_archive_pending_specialist(uuid) from public, anon;
grant execute on function public.admin_archive_pending_specialist(uuid) to authenticated;
revoke all on function public.admin_link_pending_specialist(uuid, uuid) from public, anon;
grant execute on function public.admin_link_pending_specialist(uuid, uuid) to authenticated;

-- ملخص المريض: اسم الطبيب المضاف مسبقاً يظهر مع «لم ينضم بعد»
create or replace view public.patient_overview with (security_invoker = true) as
select p.id, p.file_no, p.full_name, p.birth_date, p.sex, p.phone, p.height_cm, p.weight_kg,
       p.allergies, p.specialist_id,
       coalesce(sp.full_name, ps.full_name || ' (لم ينضم بعد)') as specialist_name,
       p.created_at, p.archived_at, p.archive_reason, p.search_key,
       t.id as treatment_id, t.protocol_name, t.diagnosis, t.stage,
       t.status as treatment_status, t.total_cycles,
       nx.cycle_no as next_cycle_no, nx.planned_date as next_date, nx.status as next_status,
       lg.cycle_no as last_cycle_no, lg.planned_date as last_date,
       p.pending_specialist_id
from public.patients p
left join public.profiles sp on sp.id = p.specialist_id
left join public.pending_specialists ps on ps.id = p.pending_specialist_id
left join lateral (
  select tr.* from public.treatments tr
   where tr.patient_id = p.id
   order by (tr.status in ('active', 'pending_approval')) desc, tr.created_at desc
   limit 1) t on true
left join lateral (
  select c.cycle_no, c.planned_date, c.status from public.cycles c
   where c.treatment_id = t.id and c.status in ('planned', 'held')
   order by c.cycle_no limit 1) nx on true
left join lateral (
  select c.cycle_no, c.planned_date from public.cycles c
   where c.treatment_id = t.id and c.status = 'given'
   order by c.cycle_no desc limit 1) lg on true;
