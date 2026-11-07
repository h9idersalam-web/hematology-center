-- =====================================================================
--  17: حذف مستخدم من لوحة الإدارة، وتغيير الصلاحية لأي حالة حساب
--
--   حذف المستخدم (admin_delete_user):
--     - بلا أي أثر في السجلات الطبية أو الإدارية: يُحذف حسابه نهائياً (حساب الدخول وملفه وإشعاراته وأكواده)
--     - له أثر (أنشأ أو اعتمد أو أعطى شيئاً، أو هو طبيب مختص لمرضى): يُحذف حساب الدخول فلا يستطيع
--       الدخول أبداً ولا يظهر في القوائم، ويبقى اسمه على ما سجّله، لأن السجل الطبي يجب أن يبيّن من فعل ماذا.
--       بريده يتحرر فيمكن أن يسجّل به حساب جديد.
--     - لا يُحذف المدير ولا حسابك، ولا طبيب مختص لمرضى قبل نقلهم إلى طبيب آخر.
--     - كل حذف يُسجَّل في سجل التعديلات مع السبب.
--   تغيير الصلاحية (admin_update_user): لكل حساب (مفعّل أو موقوف أو بانتظار التفعيل)؛
--     ولمن ينتظر التفعيل يتغير معه دور كوده المفتوح.
--
--  يُشغَّل بعد الملف 16. آمن للتشغيل أكثر من مرة. لا يحذف أي مستخدم بنفسه.
-- =====================================================================

alter table public.profiles add column if not exists deleted_at     timestamptz;
alter table public.profiles add column if not exists deleted_reason text;

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
       or new.deputy_changed_by is distinct from old.deputy_changed_by
       or new.acting_role is distinct from old.acting_role
       or new.deleted_at is distinct from old.deleted_at or new.deleted_reason is distinct from old.deleted_reason) then
    raise exception 'لا يمكنك تغيير حالة حسابك أو صلاحياته' using errcode = '42501';
  end if;
  return new;
end $$;

-- عدد السجلات التي تشير إلى المستخدم (عدا ما يخصه وحده: إشعاراته وأكواده ومحاولات تفعيله)
create or replace function public._user_refs(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare f record; n int; total int := 0;
begin
  for f in select c.conrelid::regclass as tbl, a.attname as col
             from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
              and not (c.conrelid = 'public.notifications'::regclass and a.attname = 'user_id')
              and not (c.conrelid = 'public.user_activation_codes'::regclass and a.attname = 'user_id')
              and not (c.conrelid = 'public.activation_attempts'::regclass and a.attname = 'user_id') loop
    execute format('select count(*) from %s where %I = $1', f.tbl, f.col) into n using p_user;
    total := total + n;
  end loop;
  return total;
end $$;

create or replace function public.admin_delete_user(p_user uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v_p profiles; v_n int;
begin
  perform _require_admin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الحذف'; end if;
  select * into v_p from profiles where id = p_user for update;
  if v_p.id is null or v_p.deleted_at is not null then raise exception 'المستخدم غير موجود أو حُذف من قبل'; end if;
  if v_p.id = auth.uid() then raise exception 'لا يمكنك حذف حسابك'; end if;
  if v_p.is_admin then raise exception 'لا يُحذف حساب مدير من هنا'; end if;
  select count(*) into v_n from patients where specialist_id = p_user and archived_at is null;
  if v_n > 0 then
    raise exception 'هذا الطبيب مختص لـ % من المرضى. انقلهم إلى طبيب اختصاص آخر من ملف كل مريض أولاً', v_n;
  end if;

  if _user_refs(p_user) = 0 then
    -- لا أثر له: حذف كامل (يُسجَّل حذف الملف في سجل التعديلات)
    insert into audit_log(actor_id, actor_role, action, table_name, row_id, old_data, new_data)
    values (auth.uid(), my_role(), 'DELETE_USER', 'profiles', p_user::text, to_jsonb(v_p),
            jsonb_build_object('reason', trim(p_reason), 'mode', 'deleted'));
    delete from notifications where user_id = p_user;
    delete from activation_attempts where user_id = p_user;
    delete from user_activation_codes where user_id = p_user;
    delete from auth.users where id = p_user;          -- يحذف ملفه معه (on delete cascade)
    return 'deleted';
  end if;

  -- له أثر في السجلات: يُحذف حساب الدخول ويبقى اسمه على ما سجّله
  update user_activation_codes set revoked_at = now(), revoke_reason = 'حُذف الحساب'
   where user_id = p_user and used_at is null and revoked_at is null;
  update profiles set status = 'suspended', suspended_at = coalesce(suspended_at, now()),
                      suspended_reason = 'حُذف الحساب: ' || trim(p_reason),
                      deleted_at = now(), deleted_reason = trim(p_reason),
                      is_deputy = false, deputy_active = false, acting_role = null
   where id = p_user;
  update auth.users set email = 'deleted-' || p_user || '@removed.invalid', banned_until = 'infinity'
   where id = p_user;
  return 'removed';
end $$;

-- الحساب المحذوف لا يُعاد تفعيله
create or replace function public.admin_reactivate_user(p_user uuid)
returns user_status language plpgsql security definer set search_path = public as $$
declare v_p profiles; v_new user_status;
begin
  perform _require_admin();
  select * into v_p from profiles where id = p_user for update;
  if v_p.id is null then raise exception 'المستخدم غير موجود'; end if;
  if v_p.deleted_at is not null then raise exception 'حُذف هذا الحساب ولا يُعاد تفعيله'; end if;
  if v_p.status <> 'suspended' then raise exception 'الحساب غير موقوف'; end if;
  v_new := case when v_p.activated_at is not null then 'active' else 'pending' end;
  update profiles set status = v_new, suspended_at = null, suspended_reason = null where id = p_user;
  if v_new = 'active' then perform _notify(p_user, 'account', 'أُعيد تفعيل حسابك', null); end if;
  return v_new;
end $$;

-- تغيير الصلاحية: لأي حالة حساب
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
    -- من ينتظر التفعيل: يتفعّل بالدور الجديد
    update user_activation_codes set role = p_role
     where user_id = p_user and used_at is null and revoked_at is null;
    perform _notify(p_user, 'info', 'غيّر المدير صلاحيتك', 'دورك الآن: ' || case p_role
              when 'specialist' then 'طبيب اختصاص' when 'senior_resident' then 'طبيب مقيم أقدم'
              when 'intern' then 'طبيب دوري' when 'clinical_pharmacist' then 'صيدلي سريري'
              when 'chief_clinical_pharmacist' then 'مسؤول الصيادلة السريريين'
              when 'mixing_pharmacist' then 'صيدلي المزج الكيميائي' else 'ممرض' end, null, null);
  end if;
  if p_subscription_ends is not null then
    update profiles set subscription_ends = p_subscription_ends where id = p_user;
  end if;
end $$;

-- قائمة المستخدمين: المحذوفون لا يظهرون، ويُذكر هل للمستخدم أثر في السجلات
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
      'is_deputy', p.is_deputy, 'deputy_active', p.deputy_active, 'acting_role', p.acting_role,
      'patients', (select count(*) from patients pt where pt.specialist_id = p.id and pt.archived_at is null),
      'has_records', public._user_refs(p.id) > 0,
      'code', (select jsonb_build_object('expires_at', c.expires_at, 'created_at', c.created_at,
                                          'role', c.role, 'months', c.months,
                                          'expired', c.expires_at < now())
                 from user_activation_codes c
                where c.user_id = p.id and c.used_at is null and c.revoked_at is null),
      'failed_15m', (select count(*) from activation_attempts a
                      where a.user_id = p.id and not a.ok and a.at > now() - interval '15 minutes')
    ) order by (p.status = 'pending') desc, p.created_at desc)
    from profiles p where p.deleted_at is null), '[]'::jsonb);
end $$;

revoke all on function public._user_refs(uuid) from public, anon, authenticated;
revoke all on function public.admin_delete_user(uuid, text) from public, anon;
grant execute on function public.admin_delete_user(uuid, text) to authenticated;
