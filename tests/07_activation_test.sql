-- اختبار التفعيل بكود خاص بكل مستخدم ومحاولات تجاوزه (محلياً فقط، بعد 01)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

-- مستخدمون جدد يسجلون كما من التطبيق (أحدهم يحاول منح نفسه المدير عبر بيانات التسجيل)
insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000021', 'new1@t', '{"full_name":"مستخدم جديد","role":"nurse"}'),
 ('00000000-0000-0000-0000-000000000022', 'new2@t', '{"full_name":"مستخدم ثانٍ","role":"specialist","is_admin":true,"status":"active"}'),
 ('00000000-0000-0000-0000-000000000023', 'new3@t', '{"full_name":"مستخدم ثالث","role":"nurse"}');
select 'V1 new users pending, not admin: ' || string_agg(status || '/' || is_admin, ',' order by id)
  from profiles where id in ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000023');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';

-- ===== غير المفعّل: لا بيانات، لا كتابة، لا رفع حالته
select 'V2 pending reads: patients=' || (select count(*) from patients) || ' protocols=' || (select count(*) from protocols)
    || ' others profiles=' || (select count(*) from profiles where id <> auth.uid())
    || ' notifications=' || (select count(*) from notifications)
    || ' files=' || (select count(*) from storage.objects)
    || ' overview=' || (select count(*) from patient_overview);
do $$ begin update profiles set status = 'active' where id = auth.uid(); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V3 self status change blocked OK'; end $$;
do $$ begin update profiles set is_admin = true where id = auth.uid(); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V3b self admin blocked OK'; end $$;
update profiles set full_name = 'تغيير' where id = auth.uid();
select 'V3c pending name edit rows: ' || (select count(*) from profiles where id = auth.uid() and full_name = 'تغيير');
do $$ begin insert into profiles(id, full_name, role, status, is_admin) values (gen_random_uuid(), 'x', 'nurse', 'active', true); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V3d profile insert blocked OK'; end $$;
do $$ begin perform register_patient('x', null, 'male', 170, 70, null, null, null); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V4 pending RPC blocked: %', sqlerrm; end $$;
do $$ begin perform admin_issue_code(auth.uid(), 6); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V4b self-issue code blocked OK'; end $$;
do $$ begin perform admin_list_users(); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V4c user list blocked OK'; end $$;
do $$ begin perform count(*) from user_activation_codes; raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V5 codes table blocked OK'; end $$;
do $$ begin perform count(*) from activation_attempts; raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V5b attempts table blocked OK'; end $$;
do $$ begin perform count(*) from activation_codes; raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V5c old codes table blocked OK'; end $$;
do $$ begin insert into storage.objects(bucket_id, name) values ('patient-files', 'patients/x/a.jpg'); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V5d pending upload blocked OK'; end $$;
select 'V6 no code yet: ' || (activate_account('ABCDE-FGHJK')->>'error');

-- ===== المدير يصدر كوداً لـ 22 (ويحدد التخصص: يطلب «اختصاص» فيمنحه المدير «مقيم أقدم»)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select admin_issue_code('00000000-0000-0000-0000-000000000022', 6, 72, 'senior_resident')->>'code' as c22 \gset
select admin_issue_code('00000000-0000-0000-0000-000000000023', 3, 1)->>'code' as c23 \gset
select 'V7 list has code info without code: '
    || (select bool_and(not (u ? 'code_hash') and (u->'code' is null or not (u->'code' ? 'code_hash')))
          from jsonb_array_elements(admin_list_users()) u)
    || ' open codes: ' || (select count(*) from jsonb_array_elements(admin_list_users()) u where jsonb_typeof(u->'code') = 'object');
do $$ begin perform admin_issue_code(auth.uid(), 6); raise exception 'FAIL';
exception when others then raise notice 'V7b admin self code: %', sqlerrm; end $$;
reset role;
select 'V8 stored as hash only: ' || bool_and(code_hash ~ '^[0-9a-f]{64}$' and code_hash <> replace(:'c22', '-', ''))
  from user_activation_codes where user_id = '00000000-0000-0000-0000-000000000022';
set role authenticated;

-- ===== 23 يحاول كود 22 ← خاطئ (الكود مرتبط بصاحبه)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
select 'V9 other user code: ' || (activate_account(:'c22')->>'error');

-- ===== 22: خمس محاولات خاطئة ثم قفل، حتى الكود الصحيح يُرفض أثناء القفل
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
select 'V10 wrong 1: ' || (activate_account('AAAAA-AAAAA')::text);
select activate_account('AAAAA-AAAAB')->>'remaining', activate_account('AAAAA-AAAAC')->>'remaining', activate_account('AAAAA-AAAAD')->>'remaining';
select 'V11 wrong 5 remaining: ' || (activate_account('AAAAA-AAAAE')->>'remaining');
select 'V12 locked: ' || (activate_account(:'c22')::text);
reset role;
select 'V12b still pending: ' || status from profiles where id = '00000000-0000-0000-0000-000000000022';
-- مرور 16 دقيقة
update activation_attempts set at = at - interval '16 minutes' where user_id = '00000000-0000-0000-0000-000000000022';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
select 'V13 correct after lock: ' || (activate_account(lower(replace(:'c22', '-', ' ')))::text);
select 'V13b profile: ' || status || '/' || role || '/' || (subscription_ends = (current_date + interval '6 months')::date) || '/admin=' || is_admin
  from profiles where id = auth.uid();
select 'V14 reuse: ' || (activate_account(:'c22')->>'error');
select 'V15 active now reads protocols: ' || (select count(*) > 0 from protocols);

-- ===== كود منتهي الصلاحية
reset role;
update user_activation_codes set expires_at = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-000000000023';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
select 'V16 expired: ' || (activate_account(:'c23')->>'error');

-- ===== عشر محاولات خاطئة على كود واحد تلغيه (مع مرور الوقت بينها)
reset role;
delete from activation_attempts where user_id = '00000000-0000-0000-0000-000000000023';  -- بداية نظيفة للاختبار
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select admin_issue_code('00000000-0000-0000-0000-000000000023', 3)->>'code' as c23b \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
select activate_account('BBBBB-BBBB' || i)->>'ok' from generate_series(2, 6) i;
reset role;
update activation_attempts set at = at - interval '16 minutes' where user_id = '00000000-0000-0000-0000-000000000023' and at > now() - interval '1 minute';
update user_activation_codes set created_at = created_at - interval '20 minutes' where user_id = '00000000-0000-0000-0000-000000000023' and used_at is null and revoked_at is null;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
select activate_account('CCCCC-CCCC' || i)->>'ok' from generate_series(2, 5) i;
select 'V17 tenth wrong: ' || (activate_account('CCCCC-CCCC6')->>'error');
reset role;
update activation_attempts set at = at - interval '16 minutes' where user_id = '00000000-0000-0000-0000-000000000023';
set role authenticated;
select 'V17b real code after revoke: ' || (activate_account(:'c23b')->>'error');

-- ===== إيقاف وإعادة تفعيل
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select admin_suspend_user('00000000-0000-0000-0000-000000000022', 'انتهى التعاقد');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
select 'V18 suspended reads: patients=' || (select count(*) from patients) || ' own profile=' || (select status || ' ' || suspended_reason from profiles where id = auth.uid());
select 'V18b suspended activate: ' || (activate_account('XXXXX-XXXXX')->>'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'V19 reactivate was active -> ' || admin_reactivate_user('00000000-0000-0000-0000-000000000022');
select admin_suspend_user('00000000-0000-0000-0000-000000000021', 'طلب مرفوض');
select 'V19b reactivate never activated -> ' || admin_reactivate_user('00000000-0000-0000-0000-000000000021');
do $$ begin perform admin_suspend_user(auth.uid()); raise exception 'FAIL';
exception when others then raise notice 'V20 admin self suspend: %', sqlerrm; end $$;
do $$ begin perform admin_update_user('00000000-0000-0000-0000-000000000021', 'active'); raise exception 'FAIL';
exception when others then raise notice 'V20b direct status set: %', sqlerrm; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
select 'V21 reactivated reads protocols: ' || (select count(*) > 0 from protocols);
do $$ begin perform admin_suspend_user('00000000-0000-0000-0000-000000000021'); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V22 non-admin suspend blocked OK'; end $$;
set role anon;
do $$ begin perform activate_account('XXXXX-XXXXX'); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'V23 anon blocked OK'; end $$;
reset role;
select 'ACTIVATION DONE';
