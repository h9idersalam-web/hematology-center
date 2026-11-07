-- اختبار الملف 17: حذف المستخدم، وتغيير الصلاحية لأي حالة (بعد 08..10)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

\set ADM '00000000-0000-0000-0000-000000000039'
\set SPA '00000000-0000-0000-0000-000000000032'
\set CP  '00000000-0000-0000-0000-000000000035'
\set NU  '00000000-0000-0000-0000-000000000038'
-- مستخدم جديد بلا أي أثر، ومستخدم ينتظر التفعيل بكود مفتوح
insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000051', 'clean@t', '{"full_name":"بلا أثر","role":"nurse"}'),
 ('00000000-0000-0000-0000-000000000052', 'wait@t',  '{"full_name":"ينتظر التفعيل","role":"nurse"}');
update profiles set status = 'active', subscription_ends = current_date + 30, activated_at = now() where id = '00000000-0000-0000-0000-000000000051';

set role authenticated;
set request.jwt.claim.sub = :'ADM';
-- ===== تغيير الصلاحية لحساب موقوف ولحساب ينتظر التفعيل
select admin_suspend_user(:'NU', 'اختبار');
select admin_update_user(:'NU', null, 'intern');
select 'D1 suspended role changed: ' || role || '/' || status from profiles where id = :'NU';
select (admin_issue_code('00000000-0000-0000-0000-000000000052', 6, 72, 'nurse'))->>'code' as code \gset
select admin_update_user('00000000-0000-0000-0000-000000000052', null, 'clinical_pharmacist');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000052';
select 'D2 pending activates with new role: ' || (activate_account(:'code')->>'role');

-- ===== الحذف
set request.jwt.claim.sub = :'ADM';
select 'D3 ' || t.err('delete without reason', format($q$select admin_delete_user(%L, ' ')$q$, '00000000-0000-0000-0000-000000000051'));
select 'D4 ' || t.err('delete self', format($q$select admin_delete_user(%L, 'x')$q$, :'ADM'));
select 'D5 ' || t.err('delete specialist with patients', format($q$select admin_delete_user(%L, 'x')$q$, :'SPA'));
select 'D6 clean user: ' || admin_delete_user('00000000-0000-0000-0000-000000000051', 'سُجّل بالخطأ');
reset role;
select 'D7 fully gone: auth=' || (select count(*) from auth.users where id = '00000000-0000-0000-0000-000000000051')
       || ' profile=' || (select count(*) from profiles where id = '00000000-0000-0000-0000-000000000051')
       || ' audited=' || (select count(*) from audit_log where row_id = '00000000-0000-0000-0000-000000000051' and action = 'DELETE_USER');
set role authenticated;
set request.jwt.claim.sub = :'ADM';
select 'D8 user with records: ' || admin_delete_user(:'CP', 'انتهى التعاقد');
reset role;
select 'D9 name kept on records, login removed: ' || p.full_name || ' · ' || p.status || ' · banned=' || (u.banned_until = 'infinity')
       || ' · email freed=' || (u.email like 'deleted-%') || ' · requests by him=' || (select count(*) from change_requests where requested_by = :'CP')
  from profiles p join auth.users u on u.id = p.id where p.id = :'CP';
set role authenticated;
set request.jwt.claim.sub = :'ADM';
select 'D10 hidden from user list: ' || not exists (select 1 from jsonb_array_elements(admin_list_users()) x where x->>'id' = :'CP');
select 'D11 ' || t.err('reactivate deleted', format('select admin_reactivate_user(%L)', :'CP'));
select 'D12 ' || t.err('delete twice', format($q$select admin_delete_user(%L, 'x')$q$, :'CP'));
set request.jwt.claim.sub = :'CP';
select 'D13 deleted user reads patients: ' || (select count(*) from patients);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
select 'D14 ' || t.err('non-admin deletes', format($q$select admin_delete_user(%L, 'x')$q$, :'NU'));
reset role;
select 'ADMIN DELETE DONE';
