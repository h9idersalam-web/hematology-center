-- =====================================================================
--  14: سلسلة الموافقات الجديدة (قرارات صاحب المشروع، 7 تشرين الثاني 2026)
--
--   1. أرشفة البروتوكول واستبدال ملف بروتوكول معتمد: طبيب الاختصاص ومسؤول الصيادلة ومدير البرنامج
--   2. الموافقة على خطة العلاج أو رفضها: الطبيب المختص بالمريض حصراً، ولكل مريض طبيب مختص إلزاماً
--   3. أُلغيت خطوة تحقق الصيدلي: تصل الدورة إلى المزج تلقائياً فور اعتماد الطبيب، بكل أيامها،
--      دون صورة هوية أو وصفة
--   4. الصيدلي السريري أو مسؤوله يرفق صورة الدورة من طبلة المريض (مهمة إلزامية عليه)، وتصل
--      إلى المزج للتحقق، لكنها لا تمنع المزج من البدء
--   5. التفاعل أثناء الإعطاء يُبلَّغ به كل مقدمي الرعاية المفعّلين
--   6. إغلاق الدورة: طبيب الاختصاص والمقيم الأقدم ومسؤول الصيادلة (لا الممرض)
--   7. تأجيل الدورة: يُضاف مسؤول الصيادلة
--   8. طلب الصيدلي السريري: يقرّره الطبيب المختص بالمريض أو المقيم الأقدم أو مسؤول الصيادلة
--   9. طلب مسؤول الصيادلة: يقرّره الطبيب المختص بالمريض أو المقيم الأقدم
--  10. طلب صيدلي المزج: يُبلَّغ به الطبيب المختص والمقيم الأقدم ومسؤول الصيادلة،
--      ويقرّره الطبيب المختص بالمريض أو المقيم الأقدم
--  11. تعديل الطبيب (اختصاص أو مقيم أقدم) لا يُسقط اعتماد الدورة. تعديل جاء بطلب من المزج أو
--      مسؤول الصيادلة (أو طلب صيدلي سريري قرّره غير طبيب) يُسقطه، فيُعلَّق المزج حتى يُعاد الاعتماد
--  12. صيدلي المزج يطلب تعديل الجرعات فقط
--  13. رديف مسؤول الصيادلة: صيدلي سريري يحدده المدير، ويفعّل مسؤول الصيادلة صلاحياته أو يوقفها
--  14. إذا أُوقفت صلاحيات الرديف يبقى صيدلياً سريرياً عادياً
--
--  يُشغَّل بعد الملف 13. آمن للتشغيل أكثر من مرة. لا يحذف بيانات ولا يغيّر دور أي مستخدم.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. أعمدة جديدة
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists is_deputy         boolean not null default false;
alter table public.profiles add column if not exists deputy_active     boolean not null default false;
alter table public.profiles add column if not exists deputy_changed_at timestamptz;
alter table public.profiles add column if not exists deputy_changed_by uuid references public.profiles(id);

-- صورة الدورة من طبلة المريض
alter table public.cycles add column if not exists chart_attachment_id uuid references public.attachments(id);
alter table public.cycles add column if not exists chart_by            uuid references public.profiles(id);
alter table public.cycles add column if not exists chart_at            timestamptz;

-- طلب المزج يُنشأ تلقائياً عند الاعتماد: الهوية والوصفة لم تعودا شرطاً، ويُحفظ سبب التعليق
alter table public.mixing_orders alter column id_card_attachment_id drop not null;
alter table public.mixing_orders alter column prescription_attachment_id drop not null;
alter table public.mixing_orders add column if not exists hold_reason text;

alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check
  check (kind in ('lab', 'id_card', 'prescription', 'imaging', 'report', 'other', 'chart'));

create index if not exists idx_cycles_chart on public.cycles(chart_attachment_id);

-- قفل الأعمدة: المستخدم لا يغيّر حالته ولا تخصصه ولا صلاحية الرديف بنفسه
create or replace function public.protect_profile_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.id is distinct from old.id or new.status is distinct from old.status
       or new.role is distinct from old.role or new.is_admin is distinct from old.is_admin
       or new.subscription_ends is distinct from old.subscription_ends
       or new.activated_at is distinct from old.activated_at or new.email is distinct from old.email
       or new.suspended_at is distinct from old.suspended_at
       or new.suspended_reason is distinct from old.suspended_reason
       or new.is_deputy is distinct from old.is_deputy or new.deputy_active is distinct from old.deputy_active
       or new.deputy_changed_at is distinct from old.deputy_changed_at
       or new.deputy_changed_by is distinct from old.deputy_changed_by) then
    raise exception 'لا يمكنك تغيير حالة حسابك أو صلاحياته' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. الدور الفعلي: الرديف المفعّل يعمل بصلاحيات مسؤول الصيادلة في كل مكان
-- ---------------------------------------------------------------------
create or replace function public.my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select case when role = 'clinical_pharmacist' and is_deputy and deputy_active
              then 'chief_clinical_pharmacist'::user_role else role end
    from profiles where id = auth.uid()
$$;

-- الدور المسجّل نفسه (مسؤول الصيادلة الأصلي وحده يفعّل الرديف)
create or replace function public._base_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function public._notify_roles(p_roles user_role[], p_kind text, p_title text, p_body text,
                                                p_link_type text default null, p_link_id uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, kind, title, body, link_type, link_id)
  select id, p_kind, p_title, p_body, p_link_type, p_link_id
    from profiles
   where status = 'active'
     and (case when role = 'clinical_pharmacist' and is_deputy and deputy_active
               then 'chief_clinical_pharmacist'::user_role else role end) = any(p_roles)
     and id is distinct from auth.uid()
$$;

-- كل مقدمي الرعاية المفعّلين عدا المرسِل
create or replace function public._notify_all(p_kind text, p_title text, p_body text,
                                              p_link_type text default null, p_link_id uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, kind, title, body, link_type, link_id)
  select id, p_kind, p_title, p_body, p_link_type, p_link_id
    from profiles
   where status = 'active' and id is distinct from auth.uid()
$$;

-- ---------------------------------------------------------------------
-- 3. الرديف: المدير يحدده، ومسؤول الصيادلة يفعّل صلاحياته أو يوقفها
-- ---------------------------------------------------------------------
create or replace function public.admin_set_deputy(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_p profiles;
begin
  perform _require_admin();
  select * into v_p from profiles where id = p_user for update;
  if v_p.id is null then raise exception 'المستخدم غير موجود'; end if;
  if p_on and v_p.role <> 'clinical_pharmacist' then
    raise exception 'الرديف يكون صيدلياً سريرياً';
  end if;
  update profiles set is_deputy = p_on,
                      deputy_active = case when p_on then deputy_active else false end,
                      deputy_changed_at = now(), deputy_changed_by = auth.uid()
   where id = p_user;
  perform _notify(p_user, 'info',
                  case when p_on then 'عُيّنت رديفاً لمسؤول الصيادلة السريريين'
                       else 'أُلغي تعيينك رديفاً لمسؤول الصيادلة' end,
                  case when p_on then 'تُفعَّل صلاحياتك حين يمنحها مسؤول الصيادلة.' end, null, null);
  if p_on then
    perform _notify_roles(array['chief_clinical_pharmacist']::user_role[], 'info', 'رديف جديد لمسؤول الصيادلة',
                          v_p.full_name || '. فعّل صلاحياته من الصفحة الرئيسية حين تريد.', null, null);
  end if;
end $$;

create or replace function public.chief_set_deputy_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_p profiles;
begin
  if not is_active_user() or _base_role() <> 'chief_clinical_pharmacist' then
    raise exception 'تفعيل صلاحيات الرديف لمسؤول الصيادلة السريريين فقط' using errcode = '42501';
  end if;
  select * into v_p from profiles where id = p_user for update;
  if v_p.id is null or not v_p.is_deputy or v_p.role <> 'clinical_pharmacist' then
    raise exception 'هذا المستخدم ليس رديفاً';
  end if;
  update profiles set deputy_active = coalesce(p_active, false),
                      deputy_changed_at = now(), deputy_changed_by = auth.uid()
   where id = p_user;
  perform _notify(p_user, 'info',
                  case when p_active then 'فُعّلت صلاحيات رديف مسؤول الصيادلة لديك'
                       else 'أُوقفت صلاحيات الرديف، وبقيت صلاحيات الصيدلي السريري' end,
                  null, null, null);
end $$;

-- قائمة المستخدمين للمدير: تُضاف حالة الرديف
create or replace function public.admin_list_users()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone, 'role', p.role,
      'status', p.status, 'is_admin', p.is_admin, 'subscription_ends', p.subscription_ends,
      'activated_at', p.activated_at, 'created_at', p.created_at,
      'suspended_at', p.suspended_at, 'suspended_reason', p.suspended_reason,
      'is_deputy', p.is_deputy, 'deputy_active', p.deputy_active,
      'code', (select jsonb_build_object('expires_at', c.expires_at, 'created_at', c.created_at,
                                          'role', c.role, 'months', c.months,
                                          'expired', c.expires_at < now())
                 from user_activation_codes c
                where c.user_id = p.id and c.used_at is null and c.revoked_at is null),
      'failed_15m', (select count(*) from activation_attempts a
                      where a.user_id = p.id and not a.ok and a.at > now() - interval '15 minutes')
    ) order by (p.status = 'pending') desc, p.created_at desc)
    from profiles p), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. المرضى: الطبيب المختص إلزامي لكل مريض
-- ---------------------------------------------------------------------
create or replace function public.register_patient(p_full_name text, p_birth_date date, p_sex text,
                                                   p_height_cm numeric, p_weight_kg numeric,
                                                   p_phone text default null, p_allergies text default null,
                                                   p_specialist uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sp uuid;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  v_sp := coalesce(p_specialist, case when my_role() = 'specialist' then auth.uid() end);
  if v_sp is null then raise exception 'اختر الطبيب المختص بالمريض'; end if;
  if not exists (select 1 from profiles where id = v_sp and role = 'specialist') then
    raise exception 'الطبيب المختص المختار غير صحيح';
  end if;
  insert into patients(full_name, birth_date, sex, height_cm, weight_kg, phone, allergies, specialist_id)
  values (trim(p_full_name), p_birth_date, p_sex, p_height_cm, p_weight_kg, p_phone, p_allergies, v_sp)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_patient(p_id uuid, p_full_name text, p_birth_date date, p_sex text,
                                                 p_height_cm numeric, p_weight_kg numeric,
                                                 p_phone text, p_allergies text, p_specialist uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  if p_specialist is null then raise exception 'اختر الطبيب المختص بالمريض'; end if;
  if not exists (select 1 from profiles where id = p_specialist and role = 'specialist') then
    raise exception 'الطبيب المختص المختار غير صحيح';
  end if;
  update patients set full_name = trim(p_full_name), birth_date = p_birth_date, sex = p_sex,
                      height_cm = p_height_cm, weight_kg = p_weight_kg, phone = p_phone,
                      allergies = p_allergies, specialist_id = p_specialist
   where id = p_id and archived_at is null;
  if not found then raise exception 'المريض غير موجود أو مؤرشف'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. البروتوكول: الأرشفة واستبدال الملف المعتمد
-- ---------------------------------------------------------------------
create or replace function public._require_protocol_manager() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_role('specialist', 'chief_clinical_pharmacist')) then
    raise exception 'لطبيب الاختصاص ومسؤول الصيادلة ومدير البرنامج فقط' using errcode = '42501';
  end if;
end $$;

create or replace function public.archive_protocol(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_protocol_manager();
  update protocols set archived_at = now() where id = p_id and archived_at is null;
end $$;

create or replace function public.set_protocol_file(p_id uuid, p_file_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_p protocols; v_role user_role; v_manager boolean;
begin
  if not is_admin() then
    perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  end if;
  v_role := my_role();
  v_manager := is_admin() or v_role in ('specialist', 'chief_clinical_pharmacist');
  select * into v_p from protocols where id = p_id;
  if v_p.id is null or v_p.archived_at is not null then raise exception 'البروتوكول غير موجود أو مؤرشف'; end if;
  if p_file_path is null or p_file_path not like 'protocols/' || p_id::text || '/%' then
    raise exception 'مسار الملف غير صحيح';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'patient-files' and name = p_file_path) then
    raise exception 'لم يُرفع الملف بعد';
  end if;
  if not v_manager and v_p.approved_by is not null and v_p.file_path is not null then
    raise exception 'استبدال ملف بروتوكول معتمد لطبيب الاختصاص ومسؤول الصيادلة ومدير البرنامج فقط';
  end if;

  update protocols set file_path = p_file_path where id = p_id;

  if v_role is distinct from 'specialist' then
    perform _notify_roles(array['specialist']::user_role[], 'protocol',
                          'أُرفق ملف مرجعي لبروتوكول ' || v_p.name,
                          case when v_p.approved_by is null then 'راجعه قبل الاعتماد' else 'راجعه مقابل الأدوية المعتمدة' end,
                          'protocol', p_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. خطة العلاج: الموافقة والرفض للطبيب المختص بالمريض حصراً
-- ---------------------------------------------------------------------
create or replace function public._require_patient_specialist(p_patient uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_sp uuid;
begin
  perform require_role('specialist');
  select specialist_id into v_sp from patients where id = p_patient;
  if v_sp is null then raise exception 'حدّد الطبيب المختص للمريض أولاً من ملفه'; end if;
  if v_sp <> auth.uid() then raise exception 'القرار للطبيب المختص بهذا المريض فقط' using errcode = '42501'; end if;
end $$;

create or replace function public.approve_treatment(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t treatments;
begin
  select * into v_t from treatments where id = p_tid;
  if v_t.id is null then raise exception 'الخطة غير موجودة'; end if;
  perform _require_patient_specialist(v_t.patient_id);
  update treatments set status = 'active', approved_by = auth.uid()
   where id = p_tid and status = 'pending_approval';
  if not found then raise exception 'الخطة ليست بانتظار الموافقة'; end if;
  perform _notify(v_t.created_by, 'decision', 'وافق الطبيب المختص على خطة العلاج', null, 'patient', v_t.patient_id);
end $$;

create or replace function public.reject_treatment(p_tid uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t treatments;
begin
  select * into v_t from treatments where id = p_tid;
  if v_t.id is null then raise exception 'الخطة غير موجودة'; end if;
  perform _require_patient_specialist(v_t.patient_id);
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الرفض'; end if;
  update treatments set status = 'stopped', stop_reason = 'رفضها الطبيب المختص: ' || trim(p_reason)
   where id = p_tid and status = 'pending_approval';
  if not found then raise exception 'الخطة ليست بانتظار الموافقة'; end if;
  update cycles set status = 'cancelled', postpone_reason = 'رُفضت خطة العلاج'
   where treatment_id = p_tid and status in ('planned', 'held');
  perform _notify(v_t.created_by, 'decision', 'رفض الطبيب المختص خطة العلاج', trim(p_reason), 'patient', v_t.patient_id);
end $$;

-- ---------------------------------------------------------------------
-- 7. المزج: يُنشأ تلقائياً عند الاعتماد، ويُعلَّق عند إسقاط الاعتماد
-- ---------------------------------------------------------------------
-- حالة كل طلب مزج حسب أدويته (الأدوية المحذوفة من الدورة لا تُحسب)
create or replace function public._refresh_orders(p_cycle uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update mixing_orders o set status = s.st,
                             hold_reason = case when s.st = 'held' then 'لا توجد أدوية للتحضير' end
    from (select o2.id,
                 case when count(*) filter (where cd.archived_at is null) = 0 then 'held'
                      when count(*) filter (where cd.archived_at is null and mi.sent_at is null) = 0 then 'sent'
                      when count(*) filter (where mi.sent_at is not null) > 0 then 'partially_sent'
                      when count(*) filter (where cd.archived_at is null and mi.prepared_at is not null) > 0 then 'in_progress'
                      else 'incoming' end as st
            from mixing_orders o2
            join mixing_items mi on mi.order_id = o2.id
            join cycle_doses cd on cd.id = mi.cycle_dose_id
           where o2.cycle_id = p_cycle
           group by o2.id) s
   where o.id = s.id;
end $$;

-- ينشئ طلب مزج لكل يوم فيه أدوية تُحضَّر، ويضيف ما استجد من أدوية. للدورة المعتمدة فقط.
create or replace function public._sync_mixing(p_cycle uuid, p_by uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_new int;
begin
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

-- يُسقط اعتماد الدورة ويعلّق مزجها حتى يُعاد الاعتماد
create or replace function public._hold_cycle(p_cycle uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update cycles set doctor_approved_by = null, doctor_approved_at = null,
                    pharmacist_verified_by = null, pharmacist_verified_at = null
   where id = p_cycle;
  update mixing_orders set status = 'held', hold_reason = p_reason
   where cycle_id = p_cycle and status <> 'sent';
end $$;

-- اعتماد الدورة: الطبيب المختص أو المقيم الأقدم. تصل إلى المزج فوراً.
create or replace function public.approve_cycle(p_cycle uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_name text; v_first uuid;
begin
  perform require_role('specialist', 'senior_resident');
  select * into v_c from cycles where id = p_cycle;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.status <> 'active' then raise exception 'خطة العلاج غير فعّالة'; end if;
  update cycles set doctor_approved_by = auth.uid(), doctor_approved_at = now()
   where id = p_cycle and status = 'planned' and doctor_approved_by is null;
  if not found then raise exception 'الدورة غير قابلة للاعتماد'; end if;

  perform _sync_mixing(p_cycle, auth.uid());
  select full_name into v_name from patients where id = v_t.patient_id;
  select id into v_first from mixing_orders where cycle_id = p_cycle order by day limit 1;
  if v_first is not null then
    perform _notify_roles(array['mixing_pharmacist']::user_role[], 'mixing', 'دورة معتمدة وصلت إلى المزج',
                          v_name || ' · ' || v_t.protocol_name || ' · الدورة ' || v_c.cycle_no, 'mixing_order', v_first);
  end if;
  if v_c.chart_attachment_id is null then
    perform _notify_roles(array['clinical_pharmacist', 'chief_clinical_pharmacist']::user_role[], 'task',
                          'أرفق صورة الدورة من طبلة المريض',
                          v_name || ' · ' || v_t.protocol_name || ' · الدورة ' || v_c.cycle_no, 'cycle', p_cycle);
  end if;
end $$;

-- أُلغيت: لم يعد للصيدلي خطوة تحقق، ولا تحويل يدوي إلى المزج
create or replace function public.verify_cycle(p_cycle uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'أُلغيت خطوة تحقق الصيدلي: تصل الدورة إلى المزج بعد اعتماد الطبيب مباشرة';
end $$;

create or replace function public.transfer_to_mixing(p_cycle uuid, p_id_card uuid, p_prescription uuid,
                                                     p_day int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'أُلغي التحويل اليدوي: تصل الدورة إلى المزج تلقائياً بعد اعتماد الطبيب';
end $$;

-- صورة الدورة من طبلة المريض: الصيدلي السريري أو مسؤوله، وتصل إلى المزج للتحقق
create or replace function public.set_cycle_chart(p_cycle uuid, p_attachment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_name text; v_first uuid;
begin
  perform require_role('clinical_pharmacist', 'chief_clinical_pharmacist');
  select * into v_c from cycles where id = p_cycle;
  if v_c.id is null or v_c.status not in ('planned', 'held') then raise exception 'الدورة مغلقة أو غير موجودة'; end if;
  select * into v_t from treatments where id = v_c.treatment_id;
  if not exists (select 1 from attachments where id = p_attachment and patient_id = v_t.patient_id and kind = 'chart') then
    raise exception 'الصورة لا تخص هذا المريض أو نوعها غير صحيح';
  end if;
  update cycles set chart_attachment_id = p_attachment, chart_by = auth.uid(), chart_at = now() where id = p_cycle;

  select full_name into v_name from patients where id = v_t.patient_id;
  select id into v_first from mixing_orders where cycle_id = p_cycle order by day limit 1;
  perform _notify_roles(array['mixing_pharmacist']::user_role[], 'mixing', 'وصلت صورة الطبلة للتحقق',
                        v_name || ' · ' || v_t.protocol_name || ' · الدورة ' || v_c.cycle_no,
                        case when v_first is null then 'cycle' else 'mixing_order' end, coalesce(v_first, p_cycle));
end $$;

-- علامة التحضير: لا تُحضَّر دورة معلّقة أو دواء حُذف
create or replace function public.mark_prepared(p_item uuid, p_prepared boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_mi mixing_items; v_o mixing_orders;
begin
  perform require_role('mixing_pharmacist');
  select * into v_mi from mixing_items where id = p_item;
  select * into v_o from mixing_orders where id = v_mi.order_id;
  if v_o.id is null then raise exception 'الدواء غير موجود'; end if;
  if v_o.status = 'held' then raise exception 'الطلب معلّق: بانتظار إعادة اعتماد الطبيب'; end if;
  if not exists (select 1 from cycle_doses where id = v_mi.cycle_dose_id and archived_at is null) then
    raise exception 'حُذف هذا الدواء من الدورة';
  end if;
  update mixing_items set prepared_by = case when p_prepared then auth.uid() end,
                          prepared_at = case when p_prepared then now() end
   where id = p_item and sent_at is null;
  if not found then raise exception 'الدواء أُرسل من قبل ولا يمكن تغييره'; end if;
  perform _refresh_orders(v_o.cycle_id);
end $$;

create or replace function public.send_prepared(p_order uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_o mixing_orders; v_name text;
begin
  perform require_role('mixing_pharmacist');
  select * into v_o from mixing_orders where id = p_order;
  if v_o.id is null then raise exception 'الطلب غير موجود'; end if;
  if v_o.status = 'held' then raise exception 'الطلب معلّق: بانتظار إعادة اعتماد الطبيب'; end if;
  if not exists (select 1 from cycles where id = v_o.cycle_id and doctor_approved_by is not null) then
    raise exception 'الدورة غير معتمدة من الطبيب';
  end if;
  update mixing_items mi set sent_by = auth.uid(), sent_at = now()
    from cycle_doses cd
   where mi.order_id = p_order and mi.prepared_at is not null and mi.sent_at is null
     and cd.id = mi.cycle_dose_id and cd.archived_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'ضع علامة الصح على دواء واحد على الأقل'; end if;
  perform _refresh_orders(v_o.cycle_id);

  select full_name into v_name from patients where id = v_o.patient_id;
  perform _notify_roles(array['clinical_pharmacist', 'chief_clinical_pharmacist', 'nurse']::user_role[],
                        'mixing_sent', 'وصلت أدوية محضّرة من قسم المزج',
                        v_name || ' · ' || v_n || ' دواء', 'mixing_order', p_order);
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 8. تعديل الجرعات وما يتبعه
-- ---------------------------------------------------------------------
-- جرعة تغيّرت: لا تُعدَّل جرعة أُرسلت من المزج ولم تُعطَ، وما حُضّر ولم يُرسل يُعاد تحضيره
create or replace function public._doses_changed(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_drug text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  select cd.drug_name into v_drug
    from mixing_items mi join mixing_orders o on o.id = mi.order_id join cycle_doses cd on cd.id = mi.cycle_dose_id
   where mi.cycle_dose_id = any(p_ids) and mi.sent_at is not null
     and not exists (select 1 from administrations a where a.cycle_dose_id = mi.cycle_dose_id and a.day = o.day)
   limit 1;
  if v_drug is not null then
    raise exception 'أُرسل % من المزج ولم يُعطَ بعد. لا يُعدَّل قبل إعطائه أو إرجاعه للمزج', v_drug;
  end if;
  update mixing_items set prepared_by = null, prepared_at = null
   where cycle_dose_id = any(p_ids) and sent_at is null and prepared_at is not null;
end $$;

-- تعديل جرعة: لم يعد يُسقط الاعتماد بنفسه؛ من يستدعيه يقرر ذلك حسب صاحب التعديل
create or replace function public._apply_dose(p_dose uuid, p_new numeric, p_onward boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_d cycle_doses; v_c cycles; v_ids uuid[];
begin
  if p_new is null or p_new <= 0 then raise exception 'قيمة الجرعة غير صحيحة'; end if;
  select * into v_d from cycle_doses where id = p_dose and archived_at is null;
  if v_d.id is null then raise exception 'الجرعة غير موجودة'; end if;
  select * into v_c from cycles where id = v_d.cycle_id;
  if v_c.status = 'given' then raise exception 'لا يمكن تعديل جرعة أُعطيت'; end if;

  update cycle_doses set edited_from = coalesce(edited_from, final_dose), final_dose = p_new, source = 'edited'
   where id = p_dose;
  v_ids := array[p_dose];

  if p_onward then
    with u as (
      update cycle_doses cd set edited_from = coalesce(cd.edited_from, cd.final_dose), final_dose = p_new, source = 'edited'
        from cycles c
       where cd.cycle_id = c.id
         and c.treatment_id = v_c.treatment_id
         and c.cycle_no > v_c.cycle_no
         and c.status in ('planned', 'held')
         and cd.drug_name = v_d.drug_name
         and cd.route = v_d.route
         and cd.days = v_d.days
         and cd.sort = v_d.sort
         and cd.archived_at is null
      returning cd.id)
    select v_ids || coalesce(array_agg(id), '{}') into v_ids from u;
  end if;
  perform _doses_changed(v_ids);
end $$;

create or replace function public._apply_item(p_item change_request_items, p_cycle uuid, p_treatment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pl jsonb := p_item.payload; v_t treatments; v_next record; v_tg cycle_doses;
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
    update cycle_doses cd set archived_at = now(), archive_reason = coalesce(v_pl->>'reason', 'حذف بموافقة الطبيب')
      from cycles c
     where cd.cycle_id = c.id and c.status in ('planned', 'held')
       and (cd.id = p_item.target_dose_id
            or (p_item.apply_onward and c.treatment_id = p_treatment
                and c.cycle_no > (select cycle_no from cycles where id = p_cycle)
                and cd.drug_name = v_tg.drug_name and cd.route = v_tg.route
                and cd.days = v_tg.days and cd.sort = v_tg.sort));
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

-- بعد تطبيق التعديلات: إسقاط الاعتماد وتعليق المزج، أو مزامنة المزج مع الجرعات الجديدة
create or replace function public._after_change(p_cycle uuid, p_treatment uuid, p_onward boolean,
                                                p_reset boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c record; v_no int; v_pid uuid; v_name text; v_reset_n int := 0; v_mix_n int := 0;
begin
  select cycle_no into v_no from cycles where id = p_cycle;
  select t.patient_id, p.full_name into v_pid, v_name from treatments t join patients p on p.id = t.patient_id
   where t.id = p_treatment;

  -- دورات أُلغيت (تغيير البروتوكول): يُعلَّق ما لم يُرسل من مزجها
  update mixing_orders o set status = 'held', hold_reason = 'أُلغيت الدورة'
    from cycles cy
   where o.cycle_id = cy.id and cy.treatment_id = p_treatment and cy.status = 'cancelled' and o.status <> 'sent';

  for c in select * from cycles
            where treatment_id = p_treatment and status in ('planned', 'held') and doctor_approved_by is not null
              and (id = p_cycle or (p_onward and cycle_no > v_no)) loop
    if p_reset then
      perform _hold_cycle(c.id, p_reason);
      v_reset_n := v_reset_n + 1;
    else
      perform _sync_mixing(c.id, null);
      if exists (select 1 from mixing_orders where cycle_id = c.id) then v_mix_n := v_mix_n + 1; end if;
    end if;
  end loop;

  if v_reset_n > 0 then
    perform _notify_specialist(v_pid, 'approval', 'دورة تحتاج إعادة اعتماد بعد تعديل', v_name, 'cycle', p_cycle);
    perform _notify_roles(array['senior_resident']::user_role[], 'approval', 'دورة تحتاج إعادة اعتماد بعد تعديل',
                          v_name, 'cycle', p_cycle);
    perform _notify_roles(array['mixing_pharmacist']::user_role[], 'mixing', 'عُلّق مزج دورة حتى يُعاد اعتمادها',
                          v_name, 'cycle', p_cycle);
  elsif v_mix_n > 0 then
    perform _notify_roles(array['mixing_pharmacist']::user_role[], 'mixing', 'تغيّرت أدوية دورة في المزج',
                          v_name || '. راجع الجرعات قبل التحضير.', 'cycle', p_cycle);
  end if;
end $$;

-- تعديلات الأطباء المباشرة: تُطبَّق فوراً ولا تُسقط اعتماد الدورة
create or replace function public.doctor_edit(p_cycle uuid, p_items jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; it jsonb; v_item change_request_items; v_req uuid; v_onward boolean := false;
begin
  perform require_role('specialist', 'senior_resident');
  select * into v_c from cycles where id = p_cycle;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.id is null then raise exception 'الدورة غير موجودة'; end if;

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
    v_onward := v_onward or v_item.apply_onward;
  end loop;

  perform _after_change(p_cycle, v_t.id, v_onward, false, null);

  if my_role() = 'senior_resident' then
    perform _notify_specialist(v_t.patient_id, 'info', 'عدّل الطبيب المقيم الأقدم خطة العلاج',
                               (select full_name from patients where id = v_t.patient_id), 'change_request', v_req);
  end if;
end $$;

-- طلبات الصيادلة
--   الصيدلي السريري: الجرعة، المحلول والتسريب، الأدوية الداعمة
--   صيدلي المزج: الجرعة فقط
--   مسؤول الصيادلة (ورديفه المفعّل): كل الأنواع
create or replace function public.submit_change_request(p_cycle uuid, p_items jsonb, p_reason_category text,
                                                        p_report text, p_attachment uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; it jsonb; v_req uuid; v_kind change_kind; v_role user_role; v_name text;
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
    elsif v_role = 'mixing_pharmacist' and v_kind <> 'dose' then
      raise exception 'صيدلي المزج يطلب تعديل الجرعات فقط';
    end if;
    insert into change_request_items(request_id, kind, target_dose_id, old_value, new_value, payload, apply_onward)
    values (v_req, v_kind, nullif(it->>'target_dose_id', '')::uuid,
            (select final_dose::text from cycle_doses where id = nullif(it->>'target_dose_id', '')::uuid),
            it->>'new_value', coalesce(it->'payload', '{}'::jsonb), coalesce((it->>'apply_onward')::boolean, false));
  end loop;

  select full_name into v_name from patients where id = v_t.patient_id;
  perform _notify_specialist(v_t.patient_id, 'approval', 'طلب تعديل بانتظار القرار', v_name, 'change_request', v_req);
  perform _notify_roles(case when v_role = 'chief_clinical_pharmacist' then array['senior_resident']::user_role[]
                             else array['senior_resident', 'chief_clinical_pharmacist']::user_role[] end,
                        'approval', 'طلب تعديل بانتظار القرار', v_name, 'change_request', v_req);
  return v_req;
end $$;

-- من يقرّر الطلب
--   طلب الصيدلي السريري: الطبيب المختص بالمريض، المقيم الأقدم، مسؤول الصيادلة
--   طلب مسؤول الصيادلة أو صيدلي المزج: الطبيب المختص بالمريض، المقيم الأقدم
create or replace function public.can_decide_request(p_req uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_r change_requests; v_sp uuid; v_role user_role;
begin
  if not is_active_user() then return false; end if;
  select * into v_r from change_requests where id = p_req;
  if v_r.id is null or v_r.requested_by = auth.uid() then return false; end if;
  v_role := my_role();
  select specialist_id into v_sp from patients where id = v_r.patient_id;
  return (v_role = 'specialist' and (v_sp is null or v_sp = auth.uid()))
      or v_role = 'senior_resident'
      or (v_role = 'chief_clinical_pharmacist' and v_r.requester_role = 'clinical_pharmacist');
end $$;

create or replace function public.decide_change_request(p_req uuid, p_approved_items uuid[], p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_r change_requests; it change_request_items; v_n int := 0; v_total int := 0; v_status text;
        v_onward boolean := false; v_reset boolean;
begin
  perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist');
  select * into v_r from change_requests where id = p_req for update;
  if v_r.id is null or v_r.status <> 'pending' then raise exception 'الطلب غير موجود أو تقرّر من قبل'; end if;
  if v_r.requested_by = auth.uid() then raise exception 'لا تقرّر طلباً أرسلته أنت'; end if;
  if not can_decide_request(p_req) then
    raise exception '%', case when v_r.requester_role = 'clinical_pharmacist'
                              then 'القرار للطبيب المختص بهذا المريض أو المقيم الأقدم أو مسؤول الصيادلة'
                              else 'القرار للطبيب المختص بهذا المريض أو المقيم الأقدم' end
      using errcode = '42501';
  end if;

  for it in select * from change_request_items where request_id = p_req loop
    v_total := v_total + 1;
    if it.id = any(coalesce(p_approved_items, '{}')) then
      perform _apply_item(it, v_r.cycle_id, v_r.treatment_id);
      update change_request_items set approved = true where id = it.id;
      v_n := v_n + 1;
      v_onward := v_onward or it.apply_onward;
    else
      update change_request_items set approved = false where id = it.id;
    end if;
  end loop;

  v_status := case when v_n = 0 then 'rejected' when v_n = v_total then 'approved' else 'partially_approved' end;
  update change_requests set status = v_status, decided_by = auth.uid(), decided_at = now(),
                             decision_note = nullif(trim(p_note), '')
   where id = p_req;

  if v_n > 0 then
    -- تعديل من المزج أو مسؤول الصيادلة، أو قرّره غير طبيب: يحتاج اعتماداً جديداً من الطبيب
    v_reset := v_r.requester_role in ('mixing_pharmacist', 'chief_clinical_pharmacist')
               or my_role() not in ('specialist', 'senior_resident');
    perform _after_change(v_r.cycle_id, v_r.treatment_id, v_onward, v_reset,
                          'بانتظار إعادة اعتماد الطبيب بعد تعديل');
  end if;

  perform _notify(v_r.requested_by, 'decision',
                  case v_status when 'approved' then 'وُوفق على تعديلك'
                                when 'rejected' then 'رُفض تعديلك'
                                else 'وُوفق على جزء من تعديلك' end,
                  nullif(trim(p_note), ''), 'change_request', p_req);
  return v_status;
end $$;

-- ---------------------------------------------------------------------
-- 9. الدورة: التأجيل والإغلاق والإيقاف
-- ---------------------------------------------------------------------
create or replace function public.postpone_cycle(p_cycle uuid, p_new_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_shift int;
begin
  perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist');
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب التأجيل'; end if;
  select * into v_c from cycles where id = p_cycle and status in ('planned', 'held');
  if v_c.id is null then raise exception 'الدورة غير قابلة للتأجيل'; end if;
  v_shift := p_new_date - v_c.planned_date;
  update cycles set planned_date = planned_date + v_shift,
                    postpone_reason = case when id = p_cycle then p_reason else postpone_reason end
   where treatment_id = v_c.treatment_id and cycle_no >= v_c.cycle_no and status in ('planned', 'held');
end $$;

create or replace function public.complete_cycle(p_cycle uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tid uuid;
begin
  perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist');
  update cycles set status = 'given' where id = p_cycle and status in ('planned', 'held')
   returning treatment_id into v_tid;
  if not found then raise exception 'الدورة مغلقة من قبل'; end if;
  update mixing_orders set status = 'held', hold_reason = 'أُغلقت الدورة'
   where cycle_id = p_cycle and status <> 'sent';
  update treatments t set status = 'completed'
   where t.id = v_tid
     and not exists (select 1 from cycles c where c.treatment_id = t.id and c.status in ('planned', 'held'));
end $$;

create or replace function public.stop_treatment(p_tid uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('specialist', 'senior_resident');
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الإيقاف'; end if;
  update treatments set status = 'stopped', stop_reason = p_reason where id = p_tid and status <> 'stopped';
  update cycles set status = 'cancelled', postpone_reason = p_reason
   where treatment_id = p_tid and status in ('planned', 'held');
  update mixing_orders o set status = 'held', hold_reason = 'أُوقفت خطة العلاج'
    from cycles c
   where o.cycle_id = c.id and c.treatment_id = p_tid and c.status = 'cancelled' and o.status <> 'sent';
end $$;

-- ---------------------------------------------------------------------
-- 10. الإعطاء: يكفي اعتماد الطبيب، والتفاعل يُبلَّغ به الجميع
-- ---------------------------------------------------------------------
create or replace function public.record_administration(p_dose uuid, p_day int default 1,
                                                        p_vitals jsonb default '{}'::jsonb,
                                                        p_reaction text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_d cycle_doses; v_c cycles; v_t treatments; v_id uuid; v_name text;
begin
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
  if v_d.is_mixed and not exists (select 1 from mixing_items mi join mixing_orders o on o.id = mi.order_id
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

-- ---------------------------------------------------------------------
-- 11. الدورات المعتمدة حالياً تصل إلى المزج كما في السلسلة الجديدة
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select cy.id, cy.doctor_approved_by from cycles cy join treatments t on t.id = cy.treatment_id
            where cy.doctor_approved_by is not null and cy.status = 'planned' and t.status = 'active' loop
    perform public._sync_mixing(c.id, c.doctor_approved_by);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 12. الصلاحيات على الدوال: الداخلية (تبدأ بـ _) لا تُستدعى من الواجهة
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname like '\_%' or f.proname in ('handle_new_user', 'audit_trigger', 'audit_log_immutable',
                                              'forbid_delete', 'protect_profile_columns') then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
