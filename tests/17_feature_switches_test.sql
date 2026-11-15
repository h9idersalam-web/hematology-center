-- اختبار إيقاف قسمي المزج والتمريض وتشغيلهما (الملف 47). محلياً فقط، بعد 08 و10 (يستخدم مستخدميهما).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

\set SPA   '00000000-0000-0000-0000-000000000032'
\set CP    '00000000-0000-0000-0000-000000000092'
\set NU    '00000000-0000-0000-0000-000000000093'
\set MX    '00000000-0000-0000-0000-000000000094'
\set ADM   '00000000-0000-0000-0000-000000000039'

-- بداية معروفة: القسمان يعملان، ومستخدم ينتظر التفعيل طلب دور ممرض
reset role;
update app_features set enabled = true;
update profiles set acting_role = null where id = :'ADM';
insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000091', 'nurse51@t', '{"full_name":"ممرض جديد","role":"nurse"}'),
 ('00000000-0000-0000-0000-000000000092', 'cp52@t', '{"full_name":"صيدلي سريري","role":"clinical_pharmacist"}'),
 ('00000000-0000-0000-0000-000000000093', 'nu53@t', '{"full_name":"ممرض","role":"nurse"}'),
 ('00000000-0000-0000-0000-000000000094', 'mx54@t', '{"full_name":"صيدلي المزج","role":"mixing_pharmacist"}');
update profiles set status = 'active', subscription_ends = current_date + 30
 where id in ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000094');

set role anon;
select 'W0 anon reads features: ' || get_features()::text;
set role authenticated;

-- خطة معتمدة قبل الإيقاف: لها طلبات مزج، وجرعة محضّرة
set request.jwt.claim.sub = :'SPA';
select register_patient('مريض الأقسام', null, 'male', 170, 70, null, null, :'SPA') as pt \gset
select create_treatment(:'pt', (select id from protocols where name = 'ABVD'), 'لمفوما هودجكن', null, null, current_date) as tid \gset
select id as c1 from cycles where treatment_id = :'tid' and cycle_no = 1 \gset
select approve_cycle(:'c1');
select 'W1 orders when mixing on: ' || count(*) from mixing_orders where cycle_id = :'c1';
set request.jwt.claim.sub = :'MX';
select mi.id as mi, mi.cycle_dose_id as mi_dose from mixing_items mi join mixing_orders o on o.id = mi.order_id
 where o.cycle_id = :'c1' and o.day = 1 limit 1 \gset
select mark_prepared(:'mi', true);

set request.jwt.claim.sub = :'ADM';
select admin_issue_code('00000000-0000-0000-0000-000000000091', 6)->>'role' as code_role \gset
select 'W2 open nurse code issued: ' || :'code_role';

-- ===== غير المدير لا يوقف قسماً
set request.jwt.claim.sub = :'SPA';
select 'W3 ' || t.err('non-admin toggles', $q$select admin_set_feature('mixing', false)$q$);

-- ===== الإيقاف
set request.jwt.claim.sub = :'ADM';
select 'W4 off mixing: ' || admin_set_feature('mixing', false)::text;
select 'W4b off nursing (nurse code revoked): ' || (admin_set_feature('nursing', false)->>'revoked_codes');
select 'W4c again no change: ' || (admin_set_feature('nursing', false)->>'changed');
select 'W4d features: ' || get_features()::text;

-- المزج موقوف: لا تحضير ولا إرسال، والجرعة المحضّرة لا تقفل التعديل
set request.jwt.claim.sub = :'MX';
select 'W5 ' || t.err('prepare while off', format('select mark_prepared(%L, true)', (select mi.id from mixing_items mi join mixing_orders o on o.id = mi.order_id where o.cycle_id = :'c1' and mi.prepared_at is null limit 1)));
select 'W5b ' || t.err('send while off', format('select send_prepared(%L)', (select order_id from mixing_items where id = :'mi')));
reset role;
select 'W6 frozen orders kept: ' || count(*) from mixing_orders where cycle_id = :'c1';
set role authenticated;

-- خطة جديدة تُعتمد والمزج موقوف: بلا طلبات مزج ولا إشعار للمزج
set request.jwt.claim.sub = :'SPA';
select register_patient('مريض المزج الموقوف', null, 'female', 160, 60, null, null, :'SPA') as pt2 \gset
select create_treatment(:'pt2', (select id from protocols where name = 'ABVD'), 'لمفوما هودجكن', null, null, current_date) as tid2 \gset
select id as c2 from cycles where treatment_id = :'tid2' and cycle_no = 1 \gset
reset role;
select count(*) as mx_notes_before from notifications where user_id = :'MX' \gset
set role authenticated;
set request.jwt.claim.sub = :'SPA';
select approve_cycle(:'c2');
reset role;
select 'W7 approve while off -> orders: ' || (select count(*) from mixing_orders where cycle_id = :'c2')
    || ', approved: ' || (select doctor_approved_by is not null from cycles where id = :'c2')
    || ', new mixing notes: ' || ((select count(*) from notifications where user_id = :'MX') - :mx_notes_before);

-- قفل الجرعة المحضّرة: لا يعمل والمزج موقوف
select 'W8 dose prepared before off: ' || (prepared_at is not null) from mixing_items where id = :'mi';
select _doses_changed(array[:'mi_dose']::uuid[]);
select 'W8b lock lifted while off: ok';

-- التمريض موقوف: لا إعطاء ولا تفاعل، والصيدلي السريري يؤكد اليوم بلا سجلات إعطاء
set role authenticated;
set request.jwt.claim.sub = :'NU';
select 'W9 ' || t.err('administer while off', format('select record_administration(%L, 1)', :'mi_dose'));
set request.jwt.claim.sub = :'CP';
select 'W10 clinical pharmacist completes day 1: ' || complete_cycle_day(:'c2', 1);
select 'W10b ' || t.err('day 15 not due', format('select complete_cycle_day(%L, 15)', :'c2'));

-- الأدوار الموقوفة لا تُسند
set request.jwt.claim.sub = :'ADM';
select 'W11 ' || t.err('code with off role (requested nurse)', $q$select admin_issue_code('00000000-0000-0000-0000-000000000091', 6)$q$);
select 'W11b code with another role: ' || (admin_issue_code('00000000-0000-0000-0000-000000000091', 6, 72, 'clinical_pharmacist')->>'role');
select 'W11c ' || t.err('change user to mixing', format($q$select admin_update_user(%L, null, 'mixing_pharmacist')$q$, :'CP'));
select 'W11d ' || t.err('admin acts as mixing', $q$select admin_set_acting_role('mixing_pharmacist')$q$);
select admin_update_user(:'MX', null, 'clinical_pharmacist');
select 'W11e existing mixing user moved by admin: ' || role from profiles where id = :'MX';
reset role;
select 'W11f ' || t.err('owner sets off role directly', format($q$update profiles set role = 'nurse' where id = %L$q$, :'CP'));
set role authenticated;

-- ===== التشغيل من جديد: يعود كل شيء
set request.jwt.claim.sub = :'ADM';
select 'W12 on mixing synced: ' || (admin_set_feature('mixing', true)->>'synced_cycles');
reset role;
update profiles set role = 'mixing_pharmacist' where id = :'MX';   -- المزج يعمل الآن: يُعاد صيدلي المزج
select 'W12b cycle approved while off now has orders: ' || (select count(*) > 0 from mixing_orders where cycle_id = :'c2');
select 'W12c lock back: ' || t.err('locked dose', format('select _doses_changed(array[%L]::uuid[])', :'mi_dose'));
set role authenticated;
set request.jwt.claim.sub = :'MX';
select 'W12d prepare works again: ' || (mark_prepared((select mi.id from mixing_items mi join mixing_orders o on o.id = mi.order_id where o.cycle_id = :'c1' and mi.prepared_at is null limit 1), true) is null or true);
set request.jwt.claim.sub = :'ADM';
select 'W13 on nursing: ' || (admin_set_feature('nursing', true)->>'changed');
set request.jwt.claim.sub = :'CP';
select 'W13b ' || t.err('clinical pharmacist completes day when nursing on', format('select complete_cycle_day(%L, 1)', :'c1'));
set request.jwt.claim.sub = :'NU';
select 'W13c ' || t.err('nurse gives unsent mixed drug when both on', format('select record_administration(%L, 1)', :'mi_dose'));
reset role;
select 'W14 audit rows: ' || count(*) from audit_log where table_name = 'app_features';
select 'FEATURES DONE';
