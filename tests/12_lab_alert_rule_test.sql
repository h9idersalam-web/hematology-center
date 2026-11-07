-- اختبار الملفين 19 و20: إشعار التحليل الخارج ليوم دورة لم تُعتمد أو قبله بيوم (بعد 08..11)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

\set SPA '00000000-0000-0000-0000-000000000032'
\set SR  '00000000-0000-0000-0000-000000000034'
\set NU2 '00000000-0000-0000-0000-000000000020'
set role authenticated;
set request.jwt.claim.sub = :'SR';
select register_patient('مريض قاعدة الإشعار', null, 'male', 170, 70, null, null, :'SPA') as pt \gset
select create_treatment(:'pt', (select id from protocols where name = 'ABVD'), 'لمفوما هودجكن', null, null, current_date + 3) as tid \gset
select id as c1 from cycles where treatment_id = :'tid' and cycle_no = 1 \gset
\set LOW '[{"test_name":"PLT","value":40,"unit":"x","ref_low":150,"ref_high":400}]'
set request.jwt.claim.sub = :'NU2';
-- 1. قبل الدورة بثلاثة أيام: لا إشعار
select add_lab_results(:'pt', current_date, :'LOW'::jsonb) as x \gset
-- 1ب. قبل الدورة بيومين: لا إشعار
select add_lab_results(:'pt', current_date + 1, :'LOW'::jsonb) as x \gset
-- 1ج. قبل الدورة بيوم: إشعار
select add_lab_results(:'pt', current_date + 2, :'LOW'::jsonb) as x \gset
select 'A00 helper: day-2=' || coalesce(lab_alert_cycle(:'pt', current_date + 1)::text, 'none') || ' day-1=' || coalesce(lab_alert_cycle(:'pt', current_date + 2)::text, 'none');
-- 2. يوم الدورة وقبل اعتمادها: إشعار
select add_lab_results(:'pt', current_date + 3, :'LOW'::jsonb) as x \gset
select 'A0 ui helper says cycle: ' || coalesce(lab_alert_cycle(:'pt', current_date + 3)::text, 'none') || ', other day: ' || coalesce(lab_alert_cycle(:'pt', current_date)::text, 'none');
reset role;
select 'A1 alerts so far (expect 2: day before, day of cycle 1): ' || count(*) || ' · ' || string_agg(body, ' | ') from notifications where title = 'تحليل خارج المرجع' and body like 'مريض قاعدة الإشعار%';
-- 3. بعد اعتماد الدورة: لا إشعار
set role authenticated;
set request.jwt.claim.sub = :'SPA';
select approve_cycle(:'c1');
set request.jwt.claim.sub = :'NU2';
select add_lab_results(:'pt', current_date + 3, :'LOW'::jsonb) as x \gset
select 'A2 helper after approval: ' || coalesce(lab_alert_cycle(:'pt', current_date + 3)::text, 'none');
-- 4. يوم الدورة الثانية بعد تأجيلها: الإشعار يتبع التاريخ الجديد
set request.jwt.claim.sub = :'SR';
select id as c2 from cycles where treatment_id = :'tid' and cycle_no = 2 \gset
select planned_date as d2 from cycles where id = :'c2' \gset
select postpone_cycle(:'c2', :'d2'::date + 5, 'العدلات منخفضة');
set request.jwt.claim.sub = :'NU2';
select add_lab_results(:'pt', :'d2'::date - 1, :'LOW'::jsonb) as x \gset
select add_lab_results(:'pt', :'d2'::date + 4, :'LOW'::jsonb) as x \gset
reset role;
select 'A3 total alerts (expect 3: cycle 1 ×2 before approval, day before postponed cycle 2): ' || count(*) || ' · ' || string_agg(body, ' | ' order by created_at)
  from notifications where title = 'تحليل خارج المرجع' and body like 'مريض قاعدة الإشعار%';
select 'LAB ALERT RULE DONE';
