-- =====================================================================
--  الخطوة 3: البحث في المرضى وملخص حالة كل مريض
--  يُشغَّل بعد الملف 05. آمن للتشغيل أكثر من مرة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. توحيد الكتابة العربية للبحث
--    أ إ آ ٱ ← ا ، ة ← ه ، ى ← ي ، ؤ ← و ، ئ ← ي ، الأرقام العربية ← لاتينية
--    وتُحذف الحركات والتطويل. فيجد البحث «احمد» عند كتابة «أحمد» والعكس.
-- ---------------------------------------------------------------------
create or replace function public.ar_norm(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(translate(
           regexp_replace(coalesce(t, ''), '[ًٌٍَُِّْـ]', '', 'g'),
           'أإآٱةىؤئ٠١٢٣٤٥٦٧٨٩',
           'ااااهيوي0123456789'))
$$;
revoke all on function public.ar_norm(text) from public, anon, authenticated;

alter table public.patients
  add column if not exists search_key text
  generated always as (public.ar_norm(full_name || ' ' || file_no || ' ' || coalesce(phone, ''))) stored;

-- ---------------------------------------------------------------------
-- 2. ملخص المريض: بياناته، وطبيبه، وخطته الحالية، والجلسة السابقة والقادمة
--    security_invoker: تُطبَّق عليه سياسات الأمان نفسها، فلا يراه إلا المستخدم المفعّل.
-- ---------------------------------------------------------------------
create or replace view public.patient_overview with (security_invoker = true) as
select p.id, p.file_no, p.full_name, p.birth_date, p.sex, p.phone, p.height_cm, p.weight_kg,
       p.allergies, p.specialist_id, sp.full_name as specialist_name,
       p.created_at, p.archived_at, p.archive_reason, p.search_key,
       t.id as treatment_id, t.protocol_name, t.diagnosis, t.stage,
       t.status as treatment_status, t.total_cycles,
       nx.cycle_no as next_cycle_no, nx.planned_date as next_date, nx.status as next_status,
       lg.cycle_no as last_cycle_no, lg.planned_date as last_date
from public.patients p
left join public.profiles sp on sp.id = p.specialist_id
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

revoke all on public.patient_overview from anon, public;
grant select on public.patient_overview to authenticated;

create index if not exists idx_treatments_patient_status on public.treatments(patient_id, status);
create index if not exists idx_cycles_treatment_status   on public.cycles(treatment_id, status, cycle_no);
