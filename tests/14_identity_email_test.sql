-- اختبار الملف 24: البريد القديم يُستبدل في auth.identities عند الحذف (بعد 13)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
\set ADM '00000000-0000-0000-0000-000000000039'
\set K1 '00000000-0000-0000-0000-000000000071'
\set K2 '00000000-0000-0000-0000-000000000072'
\set K3 '00000000-0000-0000-0000-000000000073'
insert into auth.users(id, email, raw_user_meta_data) values
 (:'K1', 'keep1@t', '{"full_name":"يُحذف الآن","role":"nurse"}'),
 (:'K2', 'old2@t',  '{"full_name":"حُذف قبل الإصلاح","role":"nurse"}'),
 (:'K3', 'live3@t', '{"full_name":"حساب فعّال","role":"nurse"}');
insert into auth.identities(user_id, provider_id, identity_data) values
 (:'K1', :'K1', '{"email":"keep1@t","email_verified":true}'),
 (:'K2', :'K2', '{"email":"old2@t","email_verified":true}'),
 (:'K3', :'K3', '{"email":"live3@t","email_verified":true}');
-- كلهم لهم أثر (كود قديم مستخدم) فيُحذف حساب الدخول فقط
insert into activation_codes(code, role, months, created_by, used_by, used_at) values
 ('ID-K1', 'nurse', 6, :'ADM', :'K1', now()), ('ID-K2', 'nurse', 6, :'ADM', :'K2', now());
-- K2 حُذف بالطريقة القديمة (قبل الإصلاح): بريد هويته باقٍ
update profiles set deleted_at = now(), status = 'suspended' where id = :'K2';
update auth.users set email = 'deleted-' || :'K2' || '@removed.invalid' where id = :'K2';

set role authenticated;
set request.jwt.claim.sub = :'ADM';
select 'I1 delete: ' || admin_delete_user(:'K1', 'اختبار');
reset role;
select 'I2 identity email replaced on delete: ' || (identity_data->>'email' = 'deleted-' || :'K1' || '@removed.invalid')
       || ' · other keys kept: ' || (identity_data->>'email_verified') from auth.identities where user_id = :'K1';
select 'I3 before one-time fix, old account still has email: ' || (identity_data->>'email') from auth.identities where user_id = :'K2';
\i supabase/24_delete_user_identity_email.sql
select 'I4 one-time fix: ' || (identity_data->>'email' = 'deleted-' || :'K2' || '@removed.invalid') from auth.identities where user_id = :'K2';
select 'I5 live account untouched: ' || (identity_data->>'email') from auth.identities where user_id = :'K3';
-- البريد المحرَّر يُسجَّل به حساب جديد
insert into auth.users(id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000074', 'keep1@t', '{"full_name":"حساب حقيقي بالبريد نفسه","role":"nurse"}');
select 'I6 same email registers new account: ' || full_name || ' / ' || status from profiles where id = '00000000-0000-0000-0000-000000000074';
select 'IDENTITY EMAIL DONE';
