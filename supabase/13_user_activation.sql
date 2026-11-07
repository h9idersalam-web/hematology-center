-- =====================================================================
--  التفعيل بكود خاص بكل مستخدم
--
--  1. يسجّل المستخدم بالبريد وكلمة المرور (Supabase Auth كما هو)، فيُنشأ ملفه
--     بحالة pending تلقائياً (الدالة handle_new_user في الملف 01).
--  2. المدير يصدر كوداً لمستخدم بعينه: عشوائي آمن، مرة واحدة، لمدة محددة.
--     لا يُحفظ الكود نفسه، بل بصمته (SHA-256 مع ملح عشوائي)، ويظهر للمدير مرة واحدة فقط.
--  3. المستخدم يُدخل الكود في صفحة الانتظار، فتتحقق activate_account على الخادم
--     وتجعل حسابه active. خمس محاولات خاطئة تقفل الإدخال 15 دقيقة، وعشر تلغي الكود.
--  4. الحساب غير المفعّل لا يقرأ إلا ملفه الشخصي، ولا يستدعي إلا activate_account.
--
--  يُشغَّل بعد الملف 12. آمن للتشغيل أكثر من مرة. لا يحذف أي مستخدم ولا يغيّر
--  حالة أو صلاحية أي حساب موجود؛ يلغي فقط الأكواد القديمة غير المستخدمة لأنها
--  محفوظة نصاً ولا ترتبط بمستخدم.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. الجداول (لا سياسات قراءة: لا يصل إليها أحد عبر الواجهة البرمجية)
-- ---------------------------------------------------------------------
create table if not exists public.user_activation_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id),
  code_hash     text not null,            -- SHA-256(salt || code) بالنظام الست عشري
  salt          text not null,
  role          user_role not null,       -- التخصص الذي يُمنح عند التفعيل (يحدده المدير)
  months        int  not null check (months between 1 and 36),
  expires_at    timestamptz not null,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  used_at       timestamptz,
  revoked_at    timestamptz,
  revoke_reason text
);
-- كود صالح واحد على الأكثر لكل مستخدم
create unique index if not exists user_activation_codes_one_open
  on public.user_activation_codes(user_id) where used_at is null and revoked_at is null;

create table if not exists public.activation_attempts (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references public.profiles(id),
  at       timestamptz not null default now(),
  ok       boolean not null
);
create index if not exists activation_attempts_user_at on public.activation_attempts(user_id, at desc);

alter table public.user_activation_codes enable row level security;
alter table public.activation_attempts   enable row level security;
revoke all on public.user_activation_codes from public, anon, authenticated;
revoke all on public.activation_attempts   from public, anon, authenticated;

-- سبب الإيقاف يظهر لصاحب الحساب في صفحته
alter table public.profiles add column if not exists suspended_at     timestamptz;
alter table public.profiles add column if not exists suspended_reason text;

-- الأكواد القديمة: نص صريح وغير مرتبطة بمستخدم. تُلغى غير المستخدمة، ويبقى الجدول سجلاً لا يُقرأ.
-- «غير مستخدم» = used_at فارغ (لا used_by وحدها؛ الملف 22)
update public.activation_codes set revoked = true where used_at is null and used_by is null and not revoked;
drop policy if exists codes_admin on public.activation_codes;
revoke all on public.activation_codes from public, anon, authenticated;
drop function if exists public.admin_create_code(user_role, int);
drop function if exists public.admin_revoke_code(text);
drop function if exists public.redeem_activation_code(text);

-- ---------------------------------------------------------------------
-- 2. حماية أعمدة الحساب: لا يغيّر المستخدم حالته ولا تخصصه ولا صلاحية المدير
--    (الصلاحيات تمنع ذلك أصلاً؛ هذا قفل ثانٍ لو مُنحت صلاحية تعديل خطأً)
-- ---------------------------------------------------------------------
create or replace function public.protect_profile_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.id is distinct from old.id or new.status is distinct from old.status
       or new.role is distinct from old.role or new.is_admin is distinct from old.is_admin
       or new.subscription_ends is distinct from old.subscription_ends
       or new.activated_at is distinct from old.activated_at or new.email is distinct from old.email
       or new.suspended_at is distinct from old.suspended_at
       or new.suspended_reason is distinct from old.suspended_reason) then
    raise exception 'لا يمكنك تغيير حالة حسابك أو صلاحياته' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- تعديل الاسم والهاتف للحساب المفعّل فقط
alter policy profiles_self_update on public.profiles
  using (id = (select auth.uid()) and (select public.is_active_user()))
  with check (id = (select auth.uid()));

-- الإشعارات للحساب المفعّل فقط
drop policy if exists notif_own on public.notifications;
create policy notif_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_user()));

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
     and public.is_active_user()
$$;

-- ---------------------------------------------------------------------
-- 3. المدير: إصدار كود، إلغاؤه، إيقاف حساب، إعادة تفعيله، قائمة المستخدمين
-- ---------------------------------------------------------------------
create or replace function public._require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'للمدير فقط' using errcode = '42501'; end if;
end $$;

-- كود من 10 رموز (XXXXX-XXXXX) من 32 حرفاً ورقماً بلا التباس (لا O ولا 0 ولا I ولا 1)
-- 32 يقسم 256 فلا انحياز في الاختيار؛ 50 بت من العشوائية.
create or replace function public.admin_issue_code(p_user uuid, p_months int default 6,
                                                   p_valid_hours int default 72, p_role user_role default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_p profiles; v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_code text := '';
  v_salt text; v_exp timestamptz; b bytea; i int;
begin
  perform _require_admin();
  select * into v_p from profiles where id = p_user for update;
  if v_p.id is null then raise exception 'المستخدم غير موجود'; end if;
  if v_p.id = auth.uid() then raise exception 'لا تصدر كوداً لحسابك'; end if;
  if v_p.is_admin then raise exception 'حساب المدير لا يحتاج كوداً'; end if;
  if v_p.status = 'suspended' then raise exception 'الحساب موقوف؛ أعد تفعيله أولاً'; end if;
  if p_months is null or p_months not between 1 and 36 then raise exception 'مدة الاشتراك بين 1 و36 شهراً'; end if;
  if p_valid_hours is null or p_valid_hours not between 1 and 168 then raise exception 'صلاحية الكود بين ساعة و7 أيام'; end if;

  b := gen_random_bytes(10);
  for i in 0..9 loop
    v_code := v_code || substr(v_chars, 1 + (get_byte(b, i) % 32), 1);
  end loop;
  v_salt := encode(gen_random_bytes(16), 'hex');
  v_exp := now() + make_interval(hours => p_valid_hours);

  update user_activation_codes set revoked_at = now(), revoke_reason = 'استُبدل بكود جديد'
   where user_id = p_user and used_at is null and revoked_at is null;
  insert into user_activation_codes(user_id, code_hash, salt, role, months, expires_at, created_by)
  values (p_user, encode(digest(v_salt || v_code, 'sha256'), 'hex'), v_salt,
          coalesce(p_role, v_p.role), p_months, v_exp, auth.uid());

  -- يظهر الكود هنا مرة واحدة فقط
  return jsonb_build_object('code', substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5),
                            'expires_at', v_exp, 'role', coalesce(p_role, v_p.role), 'months', p_months);
end $$;

create or replace function public.admin_revoke_user_codes(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform _require_admin();
  update user_activation_codes set revoked_at = now(), revoke_reason = 'ألغاه المدير'
   where user_id = p_user and used_at is null and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_suspend_user(p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_p profiles;
begin
  perform _require_admin();
  select * into v_p from profiles where id = p_user for update;
  if v_p.id is null then raise exception 'المستخدم غير موجود'; end if;
  if v_p.id = auth.uid() then raise exception 'لا يمكنك إيقاف حسابك'; end if;
  if v_p.is_admin then raise exception 'لا يُوقف حساب مدير من هنا'; end if;
  update profiles set status = 'suspended', suspended_at = now(),
                      suspended_reason = nullif(trim(p_reason), '')
   where id = p_user;
  update user_activation_codes set revoked_at = now(), revoke_reason = 'أُوقف الحساب'
   where user_id = p_user and used_at is null and revoked_at is null;
end $$;

-- إعادة التفعيل: من فُعّل سابقاً يعود مفعّلاً، ومن لم يُفعَّل قط يعود بانتظار الكود
create or replace function public.admin_reactivate_user(p_user uuid)
returns user_status language plpgsql security definer set search_path = public as $$
declare v_p profiles; v_new user_status;
begin
  perform _require_admin();
  select * into v_p from profiles where id = p_user for update;
  if v_p.id is null then raise exception 'المستخدم غير موجود'; end if;
  if v_p.status <> 'suspended' then raise exception 'الحساب غير موقوف'; end if;
  v_new := case when v_p.activated_at is not null then 'active' else 'pending' end;
  update profiles set status = v_new, suspended_at = null, suspended_reason = null where id = p_user;
  if v_new = 'active' then perform _notify(p_user, 'account', 'أُعيد تفعيل حسابك', null); end if;
  return v_new;
end $$;

-- التخصص والاشتراك فقط؛ الحالة بالدوال المخصصة أعلاه (التفعيل بالكود وحده)
create or replace function public.admin_update_user(p_user uuid, p_status user_status default null,
                                                    p_role user_role default null,
                                                    p_subscription_ends date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin();
  if p_status is not null then
    raise exception 'غيّر الحالة بأزرار الإيقاف وإعادة التفعيل، والتفعيل بالكود';
  end if;
  if p_user = auth.uid() and p_role is not null then raise exception 'لا تغيّر تخصص حسابك من هنا'; end if;
  update profiles set role = coalesce(p_role, role),
                      subscription_ends = coalesce(p_subscription_ends, subscription_ends)
   where id = p_user;
end $$;

-- قائمة المستخدمين مع حالة الكود (دون الكود نفسه) والمحاولات الخاطئة
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
-- 4. التفعيل (للمستخدم نفسه)
--    ترجع نتيجة بدل رفع خطأ عند الكود الخاطئ، كي تُحفظ المحاولة في السجل.
-- ---------------------------------------------------------------------
create or replace function public.activate_account(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_p profiles; v_c user_activation_codes; v_in text; v_fail int; v_fail_code int;
  v_last timestamptz; v_end date;
  c_max_15m constant int := 5;    -- محاولات خاطئة خلال 15 دقيقة قبل القفل
  c_max_code constant int := 10;  -- محاولات خاطئة على الكود الواحد قبل إلغائه
begin
  if auth.uid() is null then raise exception 'سجّل الدخول أولاً' using errcode = '42501'; end if;
  -- قفل صف المستخدم: محاولاته تُعالج واحدة تلو الأخرى
  select * into v_p from profiles where id = auth.uid() for update;
  if v_p.id is null then raise exception 'سجّل الدخول أولاً' using errcode = '42501'; end if;
  if v_p.status = 'suspended' then
    return jsonb_build_object('ok', false, 'error', 'الحساب موقوف؛ راجع إدارة المركز');
  end if;

  select * into v_c from user_activation_codes
   where user_id = v_p.id and used_at is null and revoked_at is null;

  -- القفل المؤقت: المحاولات الخاطئة منذ آخر كود صدر، خلال 15 دقيقة
  select count(*), max(at) into v_fail, v_last from activation_attempts
   where user_id = v_p.id and not ok and at > now() - interval '15 minutes'
     and at > coalesce(v_c.created_at, '-infinity');
  if v_fail >= c_max_15m then
    return jsonb_build_object('ok', false, 'locked', true,
      'retry_minutes', greatest(1, ceil(extract(epoch from (v_last + interval '15 minutes' - now())) / 60)::int),
      'error', 'محاولات كثيرة خاطئة. انتظر قليلاً ثم أعد المحاولة.');
  end if;

  v_in := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));

  if v_c.id is null then
    insert into activation_attempts(user_id, ok) values (v_p.id, false);
    return jsonb_build_object('ok', false, 'error', 'لا يوجد كود صالح لحسابك. اطلب كوداً من إدارة المركز.');
  end if;
  if v_c.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'انتهت صلاحية الكود. اطلب كوداً جديداً من إدارة المركز.');
  end if;

  if length(v_in) <> 10 or encode(digest(v_c.salt || v_in, 'sha256'), 'hex') <> v_c.code_hash then
    insert into activation_attempts(user_id, ok) values (v_p.id, false);
    select count(*) into v_fail_code from activation_attempts
     where user_id = v_p.id and not ok and at >= v_c.created_at;
    if v_fail_code >= c_max_code then
      update user_activation_codes set revoked_at = now(), revoke_reason = 'محاولات خاطئة كثيرة' where id = v_c.id;
      return jsonb_build_object('ok', false, 'error', 'أُلغي الكود بعد محاولات خاطئة كثيرة. اطلب كوداً جديداً من إدارة المركز.');
    end if;
    return jsonb_build_object('ok', false, 'error', 'الكود غير صحيح.',
                              'remaining', greatest(0, c_max_15m - (v_fail + 1)));
  end if;

  -- كود صحيح
  v_end := (greatest(coalesce(v_p.subscription_ends, current_date), current_date)
            + make_interval(months => v_c.months))::date;
  update user_activation_codes set used_at = now() where id = v_c.id;
  insert into activation_attempts(user_id, ok) values (v_p.id, true);
  update profiles set status = 'active', role = v_c.role, subscription_ends = v_end,
                      activated_at = coalesce(activated_at, now())
   where id = v_p.id;
  return jsonb_build_object('ok', true, 'active_until', v_end, 'role', v_c.role);
end $$;

-- ---------------------------------------------------------------------
-- 5. الصلاحيات على الدوال
-- ---------------------------------------------------------------------
revoke all on function public._require_admin() from public, anon, authenticated;
revoke all on function public.protect_profile_columns() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['admin_issue_code(uuid, int, int, user_role)', 'admin_revoke_user_codes(uuid)',
                           'admin_suspend_user(uuid, text)', 'admin_reactivate_user(uuid)',
                           'admin_update_user(uuid, user_status, user_role, date)', 'admin_list_users()',
                           'activate_account(text)', 'mark_notifications_read(uuid[])']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
