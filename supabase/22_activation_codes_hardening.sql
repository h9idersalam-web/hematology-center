-- =====================================================================
--  22: تحصين أكواد التفعيل وحذف المستخدم (مراجعة أمنية بطلب صاحب المشروع)
--
--  ما كُشف في المراجعة:
--   أ. activate_account يستهلك الكود بتحديث غير مشروط (where id = ...) معتمداً على فحص سابق في الدالة؛
--      القفل على صف المستخدم يمنع التزامن عملياً، لكن الاستهلاك نفسه ليس ذرياً ولا يعيد فحص الشروط.
--   ب. حذف المستخدم «بلا أثر» كان يحذف كل أكواده، ومنها المستخدمة، فيضيع used_at (سجل التفعيل).
--   ج. الملف 13 حدّد الكود القديم «غير المستخدم» بـ used_by is null وحدها.
--   د. لا يوجد في القاعدة ما يمنع إعادة فتح كود مستخدم أو ملغى أو منتهٍ لو عُدّل الجدول مباشرة.
--
--  الإصلاح:
--   1. activate_account: قفل صف الكود (for update)، واستهلاكه بتحديث ذري مشروط
--      (used_at is null and revoked_at is null and expires_at > now())، ولا تفعيل إن لم يُستهلك صف واحد بالضبط.
--   2. قادح على user_activation_codes: الكود المستخدم لا يتغير ولا يُحذف؛ لا يُستهلك كود ملغى أو منتهٍ؛
--      ولا يُلغى إلغاء كود.
--   3. قادح على activation_codes (الجدول القديم، لا تستخدمه أي دالة): لا يُستهلك كود مستخدم (used_at)
--      أو ملغى (revoked) أو منتهٍ؛ ولا يُعاد فتح كود مستخدم أو ملغى؛ ولا يُحذف كود مستخدم.
--   4. حذف المستخدم: من استخدم كود تفعيل (جديداً أو قديماً) له أثر، فيُحذف حساب دخوله فقط ويبقى ملفه
--      وأكواده كما هي (used_at محفوظ). والحذف الكامل يحذف أكواده غير المستخدمة فقط، ويحفظ ملخصها في سجل التعديلات.
--
--  يُشغَّل بعد الملف 21. آمن للتشغيل أكثر من مرة. لا يحذف ولا يغيّر أي بيانات موجودة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. الاستهلاك الذري للكود
-- ---------------------------------------------------------------------
create or replace function public.activate_account(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_p profiles; v_c user_activation_codes; v_in text; v_fail int; v_fail_code int;
  v_last timestamptz; v_end date; v_used int;
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

  -- الكود المفتوح الوحيد للمستخدم، مقفلاً حتى نهاية العملية
  select * into v_c from user_activation_codes
   where user_id = v_p.id and used_at is null and revoked_at is null
   for update;

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
  if v_c.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'انتهت صلاحية الكود. اطلب كوداً جديداً من إدارة المركز.');
  end if;

  if length(v_in) <> 10 or encode(digest(v_c.salt || v_in, 'sha256'), 'hex') <> v_c.code_hash then
    insert into activation_attempts(user_id, ok) values (v_p.id, false);
    select count(*) into v_fail_code from activation_attempts
     where user_id = v_p.id and not ok and at >= v_c.created_at;
    if v_fail_code >= c_max_code then
      update user_activation_codes set revoked_at = now(), revoke_reason = 'محاولات خاطئة كثيرة'
       where id = v_c.id and used_at is null and revoked_at is null;
      return jsonb_build_object('ok', false, 'error', 'أُلغي الكود بعد محاولات خاطئة كثيرة. اطلب كوداً جديداً من إدارة المركز.');
    end if;
    return jsonb_build_object('ok', false, 'error', 'الكود غير صحيح.',
                              'remaining', greatest(0, c_max_15m - (v_fail + 1)));
  end if;

  -- كود صحيح: استهلاك ذري مشروط؛ لا تفعيل إلا إذا استُهلك هذا الصف الآن بالضبط
  update user_activation_codes set used_at = now()
   where id = v_c.id and user_id = v_p.id
     and used_at is null and revoked_at is null and expires_at > now();
  get diagnostics v_used = row_count;
  if v_used <> 1 then
    return jsonb_build_object('ok', false, 'error', 'لم يعد هذا الكود صالحاً. اطلب كوداً جديداً من إدارة المركز.');
  end if;

  v_end := (greatest(coalesce(v_p.subscription_ends, current_date), current_date)
            + make_interval(months => v_c.months))::date;
  insert into activation_attempts(user_id, ok) values (v_p.id, true);
  update profiles set status = 'active', role = v_c.role, subscription_ends = v_end,
                      activated_at = coalesce(activated_at, now())
   where id = v_p.id;
  return jsonb_build_object('ok', true, 'active_until', v_end, 'role', v_c.role);
end $$;

-- ---------------------------------------------------------------------
-- 2. حماية الأكواد الجديدة على مستوى الجدول (حتى لو عُدّل مباشرة)
-- ---------------------------------------------------------------------
create or replace function public.guard_user_activation_codes() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.used_at is not null then
      raise exception 'كود تفعيل مستخدم: سجله محفوظ ولا يُحذف' using errcode = '42501';
    end if;
    return old;
  end if;
  -- الكود المستخدم لا يتغير منه شيء
  if old.used_at is not null and (
       new.used_at is distinct from old.used_at or new.user_id is distinct from old.user_id
       or new.code_hash is distinct from old.code_hash or new.salt is distinct from old.salt
       or new.role is distinct from old.role or new.months is distinct from old.months
       or new.expires_at is distinct from old.expires_at or new.revoked_at is distinct from old.revoked_at) then
    raise exception 'كود تفعيل مستخدم: لا يُعدَّل' using errcode = '42501';
  end if;
  -- لا يُستهلك كود ملغى أو منتهٍ
  if old.used_at is null and new.used_at is not null and (old.revoked_at is not null or old.expires_at <= now()) then
    raise exception 'لا يُستهلك كود ملغى أو منتهي الصلاحية' using errcode = '42501';
  end if;
  -- لا يُعاد فتح كود ملغى، ولا تُمدد صلاحية كود
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'لا يُعاد فتح كود ملغى' using errcode = '42501';
  end if;
  if new.expires_at > old.expires_at or new.code_hash is distinct from old.code_hash or new.salt is distinct from old.salt then
    raise exception 'لا تُغيَّر بصمة الكود ولا تُمدد صلاحيته؛ أصدر كوداً جديداً' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists user_activation_codes_guard on public.user_activation_codes;
create trigger user_activation_codes_guard before update or delete on public.user_activation_codes
  for each row execute function public.guard_user_activation_codes();

-- ---------------------------------------------------------------------
-- 3. حماية الجدول القديم activation_codes (لا تستخدمه أي دالة منذ الملف 13)
--    «مستخدم» تعني used_at غير فارغ، لا used_by وحدها.
-- ---------------------------------------------------------------------
create or replace function public.guard_legacy_activation_codes() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.used_at is not null then
      raise exception 'كود تفعيل مستخدم: سجله محفوظ ولا يُحذف' using errcode = '42501';
    end if;
    return old;
  end if;
  -- كود مستخدم: لا يتغير وقت استخدامه ولا مستخدمه، ولا يُلغى إلغاؤه
  if old.used_at is not null and (new.used_at is distinct from old.used_at or new.used_by is distinct from old.used_by) then
    raise exception 'كود تفعيل مستخدم: لا يُعدَّل' using errcode = '42501';
  end if;
  -- استهلاك: فقط لكود غير مستخدم وغير ملغى وغير منتهٍ
  if old.used_at is null and (new.used_at is not null or new.used_by is not null)
     and (old.revoked or old.expires_at <= now()) then
    raise exception 'لا يُستهلك كود ملغى أو منتهي الصلاحية' using errcode = '42501';
  end if;
  if old.revoked and not new.revoked then
    raise exception 'لا يُعاد فتح كود ملغى' using errcode = '42501';
  end if;
  if new.expires_at > old.expires_at or new.code is distinct from old.code then
    raise exception 'لا يُغيَّر الكود ولا تُمدد صلاحيته' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists activation_codes_guard on public.activation_codes;
create trigger activation_codes_guard before update or delete on public.activation_codes
  for each row execute function public.guard_legacy_activation_codes();

-- ---------------------------------------------------------------------
-- 4. حذف المستخدم: سجل التفعيل (used_at) يبقى دائماً
-- ---------------------------------------------------------------------
-- الأثر يشمل الآن: كود تفعيل جديد مستخدم، أو كود قديم استُخدم (used_at)، إضافة إلى السجلات الطبية
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
  -- تفعيل سابق بأي من النظامين: سجل يجب حفظه
  total := total + (select count(*) from user_activation_codes where user_id = p_user and used_at is not null);
  total := total + (select count(*) from activation_codes where used_by = p_user and used_at is not null);
  return total;
end $$;

create or replace function public.admin_delete_user(p_user uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v_p profiles; v_n int; v_codes jsonb;
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
    -- لا أثر ولا تفعيل: حذف كامل. أكواده كلها غير مستخدمة؛ يُحفظ ملخصها في سجل التعديلات
    select coalesce(jsonb_agg(jsonb_build_object('created_at', created_at, 'expires_at', expires_at,
                                                 'revoked_at', revoked_at, 'role', role)), '[]'::jsonb)
      into v_codes from user_activation_codes where user_id = p_user;
    insert into audit_log(actor_id, actor_role, action, table_name, row_id, old_data, new_data)
    values (auth.uid(), my_role(), 'DELETE_USER', 'profiles', p_user::text, to_jsonb(v_p),
            jsonb_build_object('reason', trim(p_reason), 'mode', 'deleted', 'unused_codes', v_codes));
    delete from notifications where user_id = p_user;
    delete from activation_attempts where user_id = p_user;
    delete from user_activation_codes where user_id = p_user and used_at is null;   -- المستخدمة لا تُحذف (والقادح يمنعها)
    delete from auth.users where id = p_user;
    return 'deleted';
  end if;

  -- له أثر أو تفعيل سابق: يُحذف حساب الدخول فقط، ويبقى ملفه وأكواده (used_at محفوظ)
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

revoke all on function public.guard_user_activation_codes() from public, anon, authenticated;
revoke all on function public.guard_legacy_activation_codes() from public, anon, authenticated;
revoke all on function public._user_refs(uuid) from public, anon, authenticated;
revoke all on function public.activate_account(text) from public, anon;
grant execute on function public.activate_account(text) to authenticated;
revoke all on function public.admin_delete_user(uuid, text) from public, anon;
grant execute on function public.admin_delete_user(uuid, text) to authenticated;
