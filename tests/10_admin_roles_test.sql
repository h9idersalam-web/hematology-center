-- اختبار الملف 16: دور عمل المدير، وتغيير صلاحيات المستخدمين (بعد 08 و09)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

\set ADM  '00000000-0000-0000-0000-000000000039'
\set SPA  '00000000-0000-0000-0000-000000000032'
\set CHIEF '00000000-0000-0000-0000-000000000031'
\set CP   '00000000-0000-0000-0000-000000000035'
\set DEP  '00000000-0000-0000-0000-000000000036'
\set MX   '00000000-0000-0000-0000-000000000037'
\set NU   '00000000-0000-0000-0000-000000000038'

set role authenticated;
-- ===== 1. دور العمل للمدير (دوره المسجّل في الاختبار: ممرض)
set request.jwt.claim.sub = :'ADM';
select 'R1 admin base role: ' || my_role();
select 'R2 switch to mixing: ' || admin_set_acting_role('mixing_pharmacist');
select o.id as ord from mixing_orders o join cycles c on c.id = o.cycle_id where o.status in ('incoming', 'in_progress') and c.doctor_approved_by is not null limit 1 \gset
select mi.id as mi from mixing_items mi join cycle_doses cd on cd.id = mi.cycle_dose_id where mi.order_id = :'ord' and mi.sent_at is null and cd.archived_at is null limit 1 \gset
select mark_prepared(:'mi', true);
select 'R3 admin as mixing prepared: ' || (prepared_by = :'ADM') from mixing_items where id = :'mi';
select mark_prepared(:'mi', false);
reset role;
select 'R4 audit records acting role: ' || actor_role from audit_log where actor_id = :'ADM' and table_name = 'mixing_items' order by id desc limit 1;
set role authenticated;
set request.jwt.claim.sub = :'ADM';
select 'R5 ' || t.err('admin as mixing records administration', format('select record_administration(%L, 1)', (select cycle_dose_id from mixing_items where id = :'mi')));
select 'R6 switch to chief: ' || admin_set_acting_role('chief_clinical_pharmacist');
select postpone_cycle(c.id, c.planned_date + 1, 'تجربة المدير') from cycles c join treatments t on t.id = c.treatment_id where t.status = 'active' and c.status = 'planned' limit 1;
select 'R7 admin as chief postponed: ' || count(*) from cycles where postpone_reason = 'تجربة المدير';
select chief_set_deputy_active(:'DEP', true);
select 'R8 admin as chief toggled deputy: ' || deputy_active from profiles where id = :'DEP';
select chief_set_deputy_active(:'DEP', false);
select 'R9 still admin while acting: ' || is_admin();
select 'R10 back to own role: ' || admin_set_acting_role('nurse');
select 'R10b stored as no acting role: ' || coalesce(acting_role::text, 'null') from profiles where id = :'ADM';
-- غير المدير لا يغيّر دور عمله
set request.jwt.claim.sub = :'CP';
select 'R11 ' || t.err('non-admin switches role', $q$select admin_set_acting_role('specialist')$q$);
select 'R12 ' || t.err('user edits acting_role directly', format($q$update profiles set acting_role = 'specialist' where id = %L$q$, :'CP'));

-- ===== 2. المدير يغيّر صلاحية مستخدم
set request.jwt.claim.sub = :'ADM';
select 'R13 ' || t.err('specialist with patients moved', format($q$select admin_update_user(%L, null, 'nurse')$q$, :'SPA'));
select admin_set_deputy(:'DEP', true);
select admin_update_user(:'DEP', null, 'mixing_pharmacist');
select 'R14 role changed, deputy dropped: ' || role || '/' || is_deputy from profiles where id = :'DEP';
select 'R15 ' || t.err('admin changes own registered role', format($q$select admin_update_user(%L, null, 'specialist')$q$, :'ADM'));
set request.jwt.claim.sub = :'CHIEF';
select 'R16 ' || t.err('non-admin changes role', format($q$select admin_update_user(%L, null, 'specialist')$q$, :'NU'));
reset role;
select 'R17 user told: ' || body from notifications where user_id = :'DEP' and title = 'غيّر المدير صلاحيتك';
-- الإشعارات تتبع دور العمل: المدير بدور المزج يصله إشعار المزج
update profiles set acting_role = 'mixing_pharmacist' where id = :'ADM';
set role authenticated;
set request.jwt.claim.sub = :'CP';
select set_cycle_chart(c.id, add_attachment(t.patient_id, 'chart', 'patients/' || t.patient_id || '/c.jpg'))
  from cycles c join treatments t on t.id = c.treatment_id where c.doctor_approved_by is not null and c.status = 'planned' and t.status = 'active' limit 1;
reset role;
select 'R18 admin acting as mixing notified: ' || count(*) from notifications where user_id = :'ADM' and title = 'وصلت صورة الطبلة للتحقق';
update profiles set acting_role = null where id = :'ADM';
select 'ADMIN ROLES DONE';
