-- اختبار الملف 22: أكواد التفعيل وحذف المستخدم (بعد 07..12)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
\set ADM '00000000-0000-0000-0000-000000000039'
\set U1 '00000000-0000-0000-0000-000000000061'
\set U2 '00000000-0000-0000-0000-000000000062'
\set U3 '00000000-0000-0000-0000-000000000063'
insert into auth.users(id, email, raw_user_meta_data) values
 (:'U1', 'h1@t', '{"full_name":"مفعّل بلا نشاط","role":"nurse"}'),
 (:'U2', 'h2@t', '{"full_name":"كود منتهٍ","role":"nurse"}'),
 (:'U3', 'h3@t', '{"full_name":"ينتظر ولم يُفعَّل","role":"nurse"}');

set role authenticated;
set request.jwt.claim.sub = :'ADM';
select (admin_issue_code(:'U1', 6, 72, 'nurse'))->>'code' as c1 \gset
select (admin_issue_code(:'U2', 6, 1, 'nurse'))->>'code' as c2 \gset
select (admin_issue_code(:'U3', 6, 72, 'nurse'))->>'code' as c3 \gset

-- ===== 1. الاستهلاك والإعادة
set request.jwt.claim.sub = :'U1';
select 'C1 activate: ' || (activate_account(:'c1')->>'ok');
select 'C2 reuse: ' || (activate_account(:'c1')->>'error');
reset role;
select 'C3 used_at set: ' || (used_at is not null) from user_activation_codes where user_id = :'U1';

-- ===== 2. حماية الجدول: مستخدم/ملغى/منتهٍ (حتى بتعديل مباشر)
select 'C4 ' || t.err('reopen used code', format('update user_activation_codes set used_at = null where user_id = %L', :'U1'));
select 'C5 ' || t.err('delete used code', format('delete from user_activation_codes where user_id = %L', :'U1'));
-- منتهٍ: الدالة ترفض، والاستهلاك المباشر يُرفض
update user_activation_codes set expires_at = now() - interval '1 minute' where user_id = :'U2';
set role authenticated;
set request.jwt.claim.sub = :'U2';
select 'C6 expired via function: ' || (activate_account(:'c2')->>'error');
reset role;
select 'C7 ' || t.err('consume expired directly', format('update user_activation_codes set used_at = now() where user_id = %L', :'U2'));
select 'C8 ' || t.err('extend expiry', format($q$update user_activation_codes set expires_at = now() + interval '1 day' where user_id = %L$q$, :'U2'));
-- ملغى
update user_activation_codes set revoked_at = now(), revoke_reason = 'اختبار' where user_id = :'U2';
select 'C9 ' || t.err('consume revoked directly', format('update user_activation_codes set used_at = now() where user_id = %L', :'U2'));
select 'C10 ' || t.err('un-revoke', format('update user_activation_codes set revoked_at = null where user_id = %L', :'U2'));

-- ===== 3. الجدول القديم activation_codes
insert into activation_codes(code, role, months, created_by, used_by, used_at) values ('LEG-USED', 'nurse', 6, :'ADM', :'ADM', now() - interval '1 day');
insert into activation_codes(code, role, months, created_by, revoked) values ('LEG-REV', 'nurse', 6, :'ADM', true);
insert into activation_codes(code, role, months, created_by, expires_at) values ('LEG-EXP', 'nurse', 6, :'ADM', now() - interval '1 day');
insert into activation_codes(code, role, months, created_by) values ('LEG-OPEN', 'nurse', 6, :'ADM');
-- كود استُخدم دون used_by (حالة شاذة): used_at وحده يكفي لاعتباره مستخدماً
insert into activation_codes(code, role, months, created_by, used_at) values ('LEG-USED-NOBY', 'nurse', 6, :'ADM', now() - interval '2 day');
select 'C11 ' || t.err('legacy: reuse used (change used_by)', $q$update activation_codes set used_by = '00000000-0000-0000-0000-000000000062' where code = 'LEG-USED'$q$);
select 'C12 ' || t.err('legacy: reuse used without used_by', $q$update activation_codes set used_by = '00000000-0000-0000-0000-000000000062', used_at = now() where code = 'LEG-USED-NOBY'$q$);
select 'C13 ' || t.err('legacy: consume revoked', $q$update activation_codes set used_by = '00000000-0000-0000-0000-000000000062', used_at = now() where code = 'LEG-REV'$q$);
select 'C14 ' || t.err('legacy: consume expired', $q$update activation_codes set used_by = '00000000-0000-0000-0000-000000000062', used_at = now() where code = 'LEG-EXP'$q$);
select 'C15 ' || t.err('legacy: un-revoke', $q$update activation_codes set revoked = false where code = 'LEG-REV'$q$);
select 'C16 ' || t.err('legacy: delete used', $q$delete from activation_codes where code = 'LEG-USED-NOBY'$q$);
update activation_codes set used_by = :'U2', used_at = now() where code = 'LEG-OPEN';
select 'C17 legacy: valid open code consumable: ' || (used_at is not null) from activation_codes where code = 'LEG-OPEN';
-- إعادة تشغيل منطق الملف 13 لا تلغي كوداً مستخدماً بلا used_by
update public.activation_codes set revoked = true where used_at is null and used_by is null and not revoked;
select 'C18 used-without-used_by not revoked by rerun: ' || (not revoked) from activation_codes where code = 'LEG-USED-NOBY';

-- ===== 4. حذف المستخدم يحفظ used_at
select 'C19 user_refs of activated user (no clinical activity): ' || _user_refs(:'U1');
set role authenticated;
set request.jwt.claim.sub = :'ADM';
select 'C20 delete activated user: ' || admin_delete_user(:'U1', 'اختبار');
select 'C21 delete never-activated user: ' || admin_delete_user(:'U3', 'اختبار');
reset role;
select 'C22 used_at kept after delete: ' || (select count(*) from user_activation_codes where user_id = :'U1' and used_at is not null)
       || ' · legacy used_at kept: ' || (select count(*) from activation_codes where code = 'LEG-USED' and used_at is not null);
select 'C23 never-activated fully gone, codes summarised in audit: '
       || (select count(*) from profiles where id = :'U3') || ' profiles · '
       || (select jsonb_array_length(new_data->'unused_codes') from audit_log where action = 'DELETE_USER' and row_id = :'U3');
select 'ACTIVATION HARDENING DONE';
