-- اختبار إيقاف «صورة الطبلة» وتشغيلها (الملف 48). محلياً فقط، بعد 17 (يستخدم مستخدميه).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

\set SPA   '00000000-0000-0000-0000-000000000032'
\set CP    '00000000-0000-0000-0000-000000000092'
\set ADM   '00000000-0000-0000-0000-000000000039'

set role authenticated;
set request.jwt.claim.sub = :'ADM';
select 'W20 chart off: ' || (admin_set_feature('chart', false)->>'changed') || ' ' || get_features()::text;

-- اعتماد والطبلة موقوفة: لا مهمة للصيادلة، ولا إرفاق صورة
set request.jwt.claim.sub = :'SPA';
select register_patient('مريض الطبلة', null, 'male', 175, 80, null, null, :'SPA') as pt \gset
select create_treatment(:'pt', (select id from protocols where name = 'ABVD'), 'لمفوما هودجكن', null, null, current_date) as tid \gset
select id as c1 from cycles where treatment_id = :'tid' and cycle_no = 1 \gset
reset role;
select count(*) as cp_before from notifications where user_id = :'CP' and kind = 'task' \gset
set role authenticated;
select approve_cycle(:'c1');
reset role;
select 'W21 no chart task while off: ' || ((select count(*) from notifications where user_id = :'CP' and kind = 'task') - :cp_before);
insert into attachments(patient_id, kind, file_path, title, created_by)
values (:'pt', 'chart', 'patients/x/chart.jpg', 'طبلة', :'CP') returning id as att \gset
set role authenticated;
set request.jwt.claim.sub = :'CP';
select 'W22 ' || t.err('attach chart while off', format('select set_cycle_chart(%L, %L)', :'c1', :'att'));

-- التشغيل: الإرفاق يعمل، والمهمة تعود للجرعات التي تُعتمد بعده
set request.jwt.claim.sub = :'ADM';
select 'W23 chart on: ' || (admin_set_feature('chart', true)->>'changed');
set request.jwt.claim.sub = :'CP';
select set_cycle_chart(:'c1', :'att');
select 'W24 attached when on: ' || (chart_attachment_id is not null) from cycles where id = :'c1';
set request.jwt.claim.sub = :'SPA';
select id as c2 from cycles where treatment_id = :'tid' and cycle_no = 2 \gset
reset role;
update cycles set planned_date = current_date where id = :'c2';
select count(*) as cp_mid from notifications where user_id = :'CP' and kind = 'task' \gset
set role authenticated;
set request.jwt.claim.sub = :'SPA';
select approve_cycle(:'c2');
reset role;
select 'W25 chart task back when on: ' || ((select count(*) from notifications where user_id = :'CP' and kind = 'task') - :cp_mid);
-- الإيقاف من جديد لا يمس الصورة المرفقة
set role authenticated;
set request.jwt.claim.sub = :'ADM';
select admin_set_feature('chart', false);
reset role;
select 'W26 existing photo kept after off: ' || (chart_attachment_id = :'att') from cycles where id = :'c1';
set role authenticated;
set request.jwt.claim.sub = :'ADM';
select 'W27 ' || t.err('unknown section', $q$select admin_set_feature('lab', false)$q$);
select admin_set_feature('chart', true);
reset role;
select 'CHART DONE';
