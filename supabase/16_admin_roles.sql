-- =====================================================================
--  16: المدير يغيّر صلاحيات المستخدمين، ويعمل هو بأي دور يختاره
--
--   1. «دور العمل» للمدير (profiles.acting_role): يختار المدير من صفحته أي دور، فيعمل بصلاحياته
--      الحقيقية في القاعدة (my_role) ويصله ما يصل ذلك الدور من إشعارات. يبقى مديراً في كل الأحوال،
--      ويبقى دوره المسجّل كما هو (ولهذا يبقى طبيباً مختصاً لمرضاه إن كان دوره المسجّل طبيب اختصاص).
--      كل إجراء يُسجَّل في سجل التعديلات بالدور الذي عمل به.
--   2. تغيير دور مستخدم من لوحة الإدارة (admin_update_user): يُبلَّغ المستخدم، وتسقط صفة الرديف إن
--      لم يعد صيدلياً سريرياً، ولا يُنقل طبيب اختصاص عن دوره وله مرضى قبل نقلهم لطبيب آخر.
--
--  يُشغَّل بعد الملف 15. آمن للتشغيل أكثر من مرة. لا يغيّر دور أي مستخدم موجود.
-- =====================================================================

alter table public.profiles add column if not exists acting_role user_role;

-- لا يغيّر أحد دور عمله إلا بدالة المدير
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
       or new.acting_role is distinct from old.acting_role) then
    raise exception 'لا يمكنك تغيير حالة حسابك أو صلاحياته' using errcode = '42501';
  end if;
  return new;
end $$;

-- الدور الفعلي لأي ملف: دور عمل المدير، ثم الرديف المفعّل، ثم الدور المسجّل
create or replace function public._effective_role(p profiles) returns user_role
language sql stable set search_path = public as $$
  select case
    when p.is_admin and p.acting_role is not null then p.acting_role
    when p.role = 'clinical_pharmacist' and p.is_deputy and p.deputy_active then 'chief_clinical_pharmacist'::user_role
    else p.role end
$$;

create or replace function public.my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select public._effective_role(p) from profiles p where p.id = auth.uid()
$$;

create or replace function public._notify_roles(p_roles user_role[], p_kind text, p_title text, p_body text,
                                                p_link_type text default null, p_link_id uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, kind, title, body, link_type, link_id)
  select p.id, p_kind, p_title, p_body, p_link_type, p_link_id
    from profiles p
   where p.status = 'active' and public._effective_role(p) = any(p_roles)
     and p.id is distinct from auth.uid()
$$;

-- المدير يختار دور عمله (null = دوره المسجّل)
create or replace function public.admin_set_acting_role(p_role user_role)
returns user_role language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin();
  update profiles set acting_role = case when p_role = role then null else p_role end where id = auth.uid();
  return my_role();
end $$;

-- تفعيل صلاحيات الرديف: مسؤول الصيادلة الأصلي، أو المدير وهو يعمل بدور مسؤول الصيادلة
create or replace function public.chief_set_deputy_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_p profiles;
begin
  if not is_active_user()
     or not (_base_role() = 'chief_clinical_pharmacist' or (is_admin() and my_role() = 'chief_clinical_pharmacist')) then
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

-- تغيير صلاحية (دور) مستخدم من لوحة الإدارة
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
  if v_p.id is null then raise exception 'المستخدم غير موجود'; end if;
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

-- قائمة المستخدمين للمدير: يُضاف عدد مرضى الطبيب المختص
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

revoke all on function public._effective_role(profiles) from public, anon, authenticated;
revoke all on function public.admin_set_acting_role(user_role) from public, anon;
grant execute on function public.admin_set_acting_role(user_role) to authenticated;
