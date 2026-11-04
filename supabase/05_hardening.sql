-- =====================================================================
--  الخطوة 1 (هـ): تحصين قاعدة البيانات بعد فحص أداة الأمان في Supabase
--  يُشغَّل بعد الملفات 01 و02 و03. آمن للتشغيل أكثر من مرة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. سحب الصلاحيات الجانبية من الجداول والتسلسلات
--    (تفريغ جدول كامل TRUNCATE، وإنشاء المُشغّلات، والمراجع)
--    كل كتابة تمرّ بالدوال المضبوطة، فلا حاجة لهذه الصلاحيات.
-- ---------------------------------------------------------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- الجداول والدوال التي تُضاف لاحقاً لا تُمنح للزائر غير المسجّل تلقائياً
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, trigger, references on tables from authenticated;

-- ---------------------------------------------------------------------
-- 2. تثبيت مسار البحث في الدوال الحسابية
-- ---------------------------------------------------------------------
alter function public.bsa_mosteller(numeric, numeric) set search_path = '';
alter function public.days_list(text) set search_path = '';
alter function public.forbid_delete() set search_path = '';
alter function public.audit_log_immutable() set search_path = '';
alter function public._calc_dose(numeric, text, numeric, numeric, numeric) set search_path = '';

-- ---------------------------------------------------------------------
-- 3. سياسات تتحقق من هوية المستخدم مرة واحدة لكل استعلام، لا لكل صف
-- ---------------------------------------------------------------------
alter policy notif_own on public.notifications
  using (user_id = (select auth.uid()));

alter policy profiles_read on public.profiles
  using (id = (select auth.uid()) or (select public.is_active_user()));

alter policy profiles_self_update on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 4. فهارس الروابط الأكثر استخداماً
-- ---------------------------------------------------------------------
create index if not exists idx_protocol_drugs_protocol on public.protocol_drugs(protocol_id);
create index if not exists idx_treatments_protocol     on public.treatments(protocol_id);
create index if not exists idx_cr_items_request        on public.change_request_items(request_id);
create index if not exists idx_cr_items_dose           on public.change_request_items(target_dose_id);
create index if not exists idx_cr_cycle                on public.change_requests(cycle_id);
create index if not exists idx_cr_patient              on public.change_requests(patient_id);
create index if not exists idx_mixing_items_dose       on public.mixing_items(cycle_dose_id);
create index if not exists idx_mixing_orders_patient   on public.mixing_orders(patient_id);
create index if not exists idx_admin_dose_day          on public.administrations(cycle_dose_id, day);
create index if not exists idx_admin_patient           on public.administrations(patient_id);
