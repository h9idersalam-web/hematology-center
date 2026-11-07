-- =====================================================================
--  24: حذف المستخدم يمسح بريده القديم من هوية الدخول أيضاً (auth.identities)
--
--  ما كُشف: عند حذف مستخدم له أثر يُحرَّر بريده في auth.users (يصبح deleted-…@removed.invalid)،
--  لكن نسخة منه تبقى في auth.identities.identity_data. لا تمنع التسجيل بالبريد نفسه، لكنها تُبقي
--  البريد القديم مخزناً في الحساب المحذوف.
--
--  الإصلاح:
--   1. admin_delete_user يستبدل البريد في هوية الدخول أيضاً عند الحذف.
--   2. لمرة واحدة: الحسابات المحذوفة سابقاً (deleted_at) تُستبدل نسخة بريدها بالطريقة نفسها.
--  لا يمسّ أي حساب غير محذوف، ولا يحذف أي صف.
--
--  يُشغَّل بعد الملف 22. آمن للتشغيل أكثر من مرة.
-- =====================================================================

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
  -- نسخة البريد في هوية الدخول (auth.identities) تُستبدل أيضاً، فلا يبقى البريد القديم في الحساب المحذوف
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', 'deleted-' || p_user || '@removed.invalid')
   where user_id = p_user and identity_data ? 'email';
  return 'removed';
end $$;

-- لمرة واحدة: الحسابات المحذوفة قبل هذا الإصلاح
update auth.identities i
   set identity_data = i.identity_data || jsonb_build_object('email', 'deleted-' || i.user_id || '@removed.invalid')
  from public.profiles p
 where p.id = i.user_id and p.deleted_at is not null
   and i.identity_data ? 'email'
   and i.identity_data->>'email' is distinct from 'deleted-' || i.user_id || '@removed.invalid';

revoke all on function public.admin_delete_user(uuid, text) from public, anon;
grant execute on function public.admin_delete_user(uuid, text) to authenticated;
