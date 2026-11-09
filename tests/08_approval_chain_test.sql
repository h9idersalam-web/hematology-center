-- اختبار سلسلة الموافقات الجديدة (الملف 14). محلياً فقط، بعد 01..07.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

-- أداة اختبار: تنفّذ أمراً يجب أن يُرفض، وتطبع سبب الرفض
create schema if not exists t;
grant usage on schema t to authenticated;
create or replace function t.err(p_label text, p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % was allowed', p_label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  return p_label || ': ' || sqlerrm;
end $$;
grant execute on function t.err(text, text) to authenticated;

-- مستخدمون مفعّلون لهذا الاختبار
insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000031', 'chief8@t', '{"full_name":"مسؤول الصيادلة","role":"chief_clinical_pharmacist"}'),
 ('00000000-0000-0000-0000-000000000032', 'spA@t',    '{"full_name":"د. المختص أ","role":"specialist"}'),
 ('00000000-0000-0000-0000-000000000033', 'spB@t',    '{"full_name":"د. المختص ب","role":"specialist"}'),
 ('00000000-0000-0000-0000-000000000034', 'sr8@t',    '{"full_name":"د. المقيم الأقدم","role":"senior_resident"}'),
 ('00000000-0000-0000-0000-000000000035', 'cp8@t',    '{"full_name":"صيدلي سريري","role":"clinical_pharmacist"}'),
 ('00000000-0000-0000-0000-000000000036', 'dep8@t',   '{"full_name":"الرديف","role":"clinical_pharmacist"}'),
 ('00000000-0000-0000-0000-000000000037', 'mx8@t',    '{"full_name":"صيدلي المزج","role":"mixing_pharmacist"}'),
 ('00000000-0000-0000-0000-000000000038', 'nu8@t',    '{"full_name":"ممرض","role":"nurse"}'),
 ('00000000-0000-0000-0000-000000000039', 'adm8@t',   '{"full_name":"مدير البرنامج","role":"nurse"}'),
 ('00000000-0000-0000-0000-000000000040', 'in8@t',    '{"full_name":"طبيب دوري","role":"intern"}');
update profiles set status = 'active', subscription_ends = current_date + 30
 where id between '00000000-0000-0000-0000-000000000031' and '00000000-0000-0000-0000-000000000040';
update profiles set is_admin = true where id = '00000000-0000-0000-0000-000000000039';

\set CHIEF '00000000-0000-0000-0000-000000000031'
\set SPA   '00000000-0000-0000-0000-000000000032'
\set SPB   '00000000-0000-0000-0000-000000000033'
\set SR    '00000000-0000-0000-0000-000000000034'
\set CP    '00000000-0000-0000-0000-000000000035'
\set DEP   '00000000-0000-0000-0000-000000000036'
\set MX    '00000000-0000-0000-0000-000000000037'
\set NU    '00000000-0000-0000-0000-000000000038'
\set ADM   '00000000-0000-0000-0000-000000000039'
\set INT   '00000000-0000-0000-0000-000000000040'

set role authenticated;
set request.jwt.claim.sub = :'SPA';
select approve_protocol(id) from protocols where name in ('R-CHOP-21', 'ABVD');

-- =====================================================================
-- 1. أرشفة البروتوكول واستبدال الملف المعتمد
-- =====================================================================
select create_protocol('اختبار-أ', 'اختبار', 'iv', 21, 2, '[{"drug_name":"Drug","dose_value":10,"dose_unit":"mg","route":"IV","days":"1"}]') as pa \gset
select create_protocol('اختبار-ب', 'اختبار', 'iv', 21, 2, '[{"drug_name":"Drug","dose_value":10,"dose_unit":"mg","route":"IV","days":"1"}]') as pb \gset
select create_protocol('اختبار-ج', 'اختبار', 'iv', 21, 2, '[{"drug_name":"Drug","dose_value":10,"dose_unit":"mg","route":"IV","days":"1"}]') as pc \gset
reset role;
insert into storage.objects(bucket_id, name) values
  ('patient-files', 'protocols/' || :'pa' || '/v1.pdf'), ('patient-files', 'protocols/' || :'pa' || '/v2.pdf'),
  ('patient-files', 'protocols/' || :'pa' || '/v3.pdf'), ('patient-files', 'protocols/' || :'pa' || '/v4.pdf');
set role authenticated;
select set_protocol_file(:'pa', 'protocols/' || :'pa' || '/v1.pdf');

set request.jwt.claim.sub = :'CP';
select 'P1a ' || t.err('clinical archives', format('select archive_protocol(%L)', :'pa'));
select 'P1b ' || t.err('clinical replaces approved file', format('select set_protocol_file(%L, %L)', :'pa', 'protocols/' || :'pa' || '/v2.pdf'));
set request.jwt.claim.sub = :'SR';
select 'P1c ' || t.err('senior resident archives', format('select archive_protocol(%L)', :'pa'));
set request.jwt.claim.sub = :'CHIEF';
select set_protocol_file(:'pa', 'protocols/' || :'pa' || '/v2.pdf');
select 'P1d chief replaced file: ' || (file_path like '%v2.pdf') from protocols where id = :'pa';
select archive_protocol(:'pb');
select 'P1e chief archived: ' || (archived_at is not null) from protocols where id = :'pb';
set request.jwt.claim.sub = :'ADM';
select set_protocol_file(:'pa', 'protocols/' || :'pa' || '/v3.pdf');
select archive_protocol(:'pc');
select 'P1f admin (nurse role) replaced and archived: ' || (select file_path like '%v3.pdf' from protocols where id = :'pa')
       || '/' || (select archived_at is not null from protocols where id = :'pc');
set request.jwt.claim.sub = :'SPA';
select set_protocol_file(:'pa', 'protocols/' || :'pa' || '/v4.pdf');
select 'P1g specialist still replaces: ' || (file_path like '%v4.pdf') from protocols where id = :'pa';

-- =====================================================================
-- 2. خطة العلاج: الطبيب المختص بالمريض حصراً، والمختص إلزامي
-- =====================================================================
set request.jwt.claim.sub = :'CP';
select 'P2a ' || t.err('patient without specialist', $q$select register_patient('بلا مختص', null, 'male', 170, 70)$q$);
select register_patient('مريض السلسلة', null, 'male', 175, 80, null, null, :'SPA') as pt \gset
select register_patient('مريض الرفض', null, 'female', 160, 60, null, null, :'SPA') as pt2 \gset
select 'P2b ' || t.err('update removes specialist', format($q$select update_patient(%L, 'مريض السلسلة', null, 'male', 175, 80, null, null, null)$q$, :'pt'));

set request.jwt.claim.sub = :'CHIEF';
select create_treatment(:'pt', (select id from protocols where name = 'ABVD'), 'لمفوما هودجكن', null, null, current_date) as tid \gset
select create_treatment(:'pt2', (select id from protocols where name = 'ABVD'), 'لمفوما هودجكن', null, null, current_date) as tid2 \gset
select 'P2c plan from chief starts active (file 38): ' || status from treatments where id = :'tid';
-- تُعاد معلّقة لاختبار قرار الطبيب المختص على الخطط المعلّقة القديمة
reset role; update treatments set status = 'pending_approval', approved_by = null where id in (:'tid', :'tid2'); set role authenticated;
set request.jwt.claim.sub = :'SPB';
select 'P2d ' || t.err('other specialist approves', format('select approve_treatment(%L)', :'tid'));
set request.jwt.claim.sub = :'SR';
select 'P2e ' || t.err('senior resident approves', format('select approve_treatment(%L)', :'tid'));
set request.jwt.claim.sub = :'SPB';
select 'P2f ' || t.err('other specialist rejects', format($q$select reject_treatment(%L, 'سبب')$q$, :'tid2'));
set request.jwt.claim.sub = :'SPA';
select 'P2g ' || t.err('reject without reason', format($q$select reject_treatment(%L, ' ')$q$, :'tid2'));
select approve_treatment(:'tid');
select reject_treatment(:'tid2', 'البروتوكول غير مناسب لعمر المريضة');
select 'P2h approved/rejected: ' || (select status from treatments where id = :'tid') || '/'
       || (select status || ' · ' || stop_reason from treatments where id = :'tid2')
       || ' · open cycles of rejected=' || (select count(*) from cycles where treatment_id = :'tid2' and status in ('planned', 'held'));
reset role;
select 'P2i creator told: ' || string_agg(title, ' | ' order by created_at) from notifications
 where user_id = :'CHIEF' and kind = 'decision';
set role authenticated;

-- =====================================================================
-- 3 و4. الاعتماد يرسل الدورة إلى المزج، وصورة الطبلة من الصيدلي لا تمنع المزج
-- =====================================================================
select id as c1 from cycles where treatment_id = :'tid' and cycle_no = 1 \gset
select id as c2 from cycles where treatment_id = :'tid' and cycle_no = 2 \gset
set request.jwt.claim.sub = :'SPA';
select approve_cycle(:'c1');
select 'P3a orders after approval: ' || string_agg('day ' || day || '=' || status || '/' ||
       (select count(*) from mixing_items mi where mi.order_id = o.id) || ' drugs', ', ' order by day)
  from mixing_orders o where cycle_id = :'c1';
select 'P3b ' || t.err('approve twice', format('select approve_cycle(%L)', :'c1'));
reset role;
select 'P3c notified: mixing=' || count(*) filter (where user_id = :'MX' and kind = 'mixing')
       || ' chart task to clinical=' || count(*) filter (where user_id = :'CP' and kind = 'task')
       || ' chart task to chief=' || count(*) filter (where user_id = :'CHIEF' and kind = 'task')
  from notifications;
set role authenticated;

-- المزج يحضّر قبل وصول صورة الطبلة
set request.jwt.claim.sub = :'MX';
select o.id as o1 from mixing_orders o where cycle_id = :'c1' and day = 1 \gset
select o.id as o15 from mixing_orders o where cycle_id = :'c1' and day = 15 \gset
select mi.id as mi_dox from mixing_items mi join cycle_doses cd on cd.id = mi.cycle_dose_id
 where mi.order_id = :'o1' and cd.drug_name = 'Doxorubicin' \gset
select mi.id as mi_vbl from mixing_items mi join cycle_doses cd on cd.id = mi.cycle_dose_id
 where mi.order_id = :'o1' and cd.drug_name = 'Vinblastine' \gset
select mark_prepared(:'mi_dox', true);
select mark_prepared(:'mi_vbl', true);
select 'P3d prepared before chart: ' || status from mixing_orders where id = :'o1';

set request.jwt.claim.sub = :'NU';
select 'P4a ' || t.err('nurse sets chart', format('select set_cycle_chart(%L, null)', :'c1'));
set request.jwt.claim.sub = :'CP';
select 'P4b ' || t.err('chart with lab attachment', format($q$select set_cycle_chart(%L, add_attachment(%L, 'lab', 'patients/%s/x.jpg'))$q$, :'c1', :'pt', :'pt'));
select add_attachment(:'pt', 'chart', 'patients/' || :'pt' || '/chart1.jpg', 'طبلة الدورة 1') as chart \gset
select set_cycle_chart(:'c1', :'chart');
select 'P4c chart on cycle: ' || (chart_attachment_id = :'chart') || ' by clinical=' || (chart_by = :'CP') from cycles where id = :'c1';
reset role;
select 'P4d mixing told chart arrived: ' || count(*) from notifications where user_id = :'MX' and title = 'وصلت صورة الطبلة للتحقق';
set role authenticated;

-- =====================================================================
-- 11. تعديل الطبيب المباشر لا يُسقط الاعتماد؛ والجرعة المحضّرة لا تُعدَّل (الملف 21)
-- =====================================================================
set request.jwt.claim.sub = :'SR';
select cycle_dose_id as d_dox from mixing_items where id = :'mi_dox' \gset
select 'P11z ' || t.err('edit prepared dose', format($q$select doctor_edit(%L, jsonb_build_array(jsonb_build_object('kind','dose','target_dose_id',%L,'new_value','40','apply_onward',false)))$q$, :'c1', :'d_dox'));
select 'P11y ' || t.err('remove prepared dose', format($q$select doctor_edit(%L, jsonb_build_array(jsonb_build_object('kind','remove_drug','target_dose_id',%L,'payload','{"reason":"x"}'::jsonb)))$q$, :'c1', :'d_dox'));
-- صيدلي المزج يزيل علامة التحضير، فيصبح التعديل ممكناً
set request.jwt.claim.sub = :'MX';
select mark_prepared(:'mi_dox', false);
set request.jwt.claim.sub = :'SR';
select doctor_edit(:'c1', jsonb_build_array(jsonb_build_object('kind', 'dose', 'target_dose_id', :'d_dox', 'new_value', '40', 'apply_onward', false)), 'تخفيض');
select 'P11a doctor edit keeps approval: ' || (doctor_approved_by is not null) from cycles where id = :'c1';
select 'P11b dox edited after untick, vbl still prepared: ' || (select final_dose = 40 from cycle_doses where id = :'d_dox')
       || '/' || (select prepared_at is not null from mixing_items where id = :'mi_vbl');
select 'P11c orders not held: ' || string_agg(status, ',' order by day) from mixing_orders where cycle_id = :'c1';

-- إرسال ثم محاولة تعديل جرعة أُرسلت ولم تُعطَ
set request.jwt.claim.sub = :'MX';
select 'P11d sent: ' || send_prepared(:'o1');
set request.jwt.claim.sub = :'SPA';
select cycle_dose_id as d_vbl from mixing_items where id = :'mi_vbl' \gset
select 'P11e ' || t.err('edit sent-not-given dose', format($q$select doctor_edit(%L, jsonb_build_array(jsonb_build_object('kind','dose','target_dose_id',%L,'new_value','5','apply_onward',false)))$q$, :'c1', :'d_vbl'));

-- =====================================================================
-- 12 و10. صيدلي المزج: الجرعات فقط، ويقرّر المختص أو المقيم الأقدم، ثم يُعاد الاعتماد
-- =====================================================================
set request.jwt.claim.sub = :'MX';
select 'P12a ' || t.err('mixing asks infusion change', format($q$select submit_change_request(%L, jsonb_build_array(jsonb_build_object('kind','infusion','target_dose_id',%L,'payload','{"diluent":"NS"}'::jsonb)), 'أخرى', 'تقرير المزج')$q$, :'c1', :'d_dox'));
select id as d_dtic from cycle_doses where cycle_id = :'c1' and drug_name = 'Dacarbazine' \gset
select submit_change_request(:'c1', jsonb_build_array(jsonb_build_object('kind', 'dose', 'target_dose_id', :'d_dtic', 'new_value', '600', 'apply_onward', false)), 'أخرى', 'الجرعة تتجاوز المتوفر') as rmx \gset
reset role;
select 'P10a mixing request notified: specialist=' || count(*) filter (where user_id = :'SPA')
       || ' other specialist=' || count(*) filter (where user_id = :'SPB')
       || ' SR=' || count(*) filter (where user_id = :'SR')
       || ' chief=' || count(*) filter (where user_id = :'CHIEF')
  from notifications where link_id = :'rmx';
set role authenticated;
set request.jwt.claim.sub = :'CHIEF';
select 'P10b ' || t.err('chief decides mixing request', format('select decide_change_request(%L, null, null)', :'rmx'));
set request.jwt.claim.sub = :'SPB';
select 'P10c ' || t.err('other specialist decides', format('select decide_change_request(%L, null, null)', :'rmx'));
set request.jwt.claim.sub = :'SR';
select 'P10d SR decides: ' || decide_change_request(:'rmx', (select array_agg(id) from change_request_items where request_id = :'rmx'), null);
select 'P11f mixing edit drops approval: ' || (doctor_approved_by is null) from cycles where id = :'c1';
select 'P11g orders held: ' || string_agg(day || '=' || status, ',' order by day) from mixing_orders where cycle_id = :'c1';
set request.jwt.claim.sub = :'MX';
select mi.id as mi_dtic15 from mixing_items mi join cycle_doses cd on cd.id = mi.cycle_dose_id
 where mi.order_id = :'o15' and cd.drug_name = 'Dacarbazine' \gset
select 'P11h ' || t.err('prepare held order', format('select mark_prepared(%L, true)', :'mi_dtic15'));
set request.jwt.claim.sub = :'NU';
select id as d_pred from cycle_doses where cycle_id = :'c1' limit 1 \gset
select 'P11i ' || t.err('nurse gives on dropped approval', format('select record_administration(%L, 1)', :'d_vbl'));
set request.jwt.claim.sub = :'SPA';
select approve_cycle(:'c1');
select 'P11j re-approved, orders resume: ' || string_agg(day || '=' || status, ',' order by day) from mixing_orders where cycle_id = :'c1';

-- =====================================================================
-- 8. طلب الصيدلي السريري: المختص بالمريض أو المقيم الأقدم أو مسؤول الصيادلة
-- =====================================================================
set request.jwt.claim.sub = :'CP';
select 'P8a ' || t.err('clinical removes drug', format($q$select submit_change_request(%L, jsonb_build_array(jsonb_build_object('kind','remove_drug','target_dose_id',%L)), 'أخرى', 'تقرير')$q$, :'c1', :'d_dtic'));
select submit_change_request(:'c1', jsonb_build_array(jsonb_build_object('kind', 'dose', 'target_dose_id', :'d_dtic', 'new_value', '580', 'apply_onward', false)), 'وظائف الكلى', 'تقرير الصيدلي') as rcp1 \gset
select submit_change_request(:'c1', jsonb_build_array(jsonb_build_object('kind', 'dose', 'target_dose_id', :'d_dtic', 'new_value', '560', 'apply_onward', false)), 'وظائف الكلى', 'تقرير الصيدلي') as rcp2 \gset
reset role;
select 'P8b clinical request notified: specialist=' || count(*) filter (where user_id = :'SPA')
       || ' SR=' || count(*) filter (where user_id = :'SR') || ' chief=' || count(*) filter (where user_id = :'CHIEF')
  from notifications where link_id = :'rcp1';
set role authenticated;
set request.jwt.claim.sub = :'INT';
select 'P8c ' || t.err('intern decides', format('select decide_change_request(%L, null, null)', :'rcp1'));
set request.jwt.claim.sub = :'SR';
select 'P8d SR decides clinical request: ' || decide_change_request(:'rcp1', (select array_agg(id) from change_request_items where request_id = :'rcp1'), null);
select 'P8e approval kept after doctor decision: ' || (doctor_approved_by is not null) from cycles where id = :'c1';
set request.jwt.claim.sub = :'CHIEF';
select 'P8f can decide (chief, clinical request): ' || can_decide_request(:'rcp2');
select 'P8g chief decides clinical request: ' || decide_change_request(:'rcp2', (select array_agg(id) from change_request_items where request_id = :'rcp2'), null);
select 'P8h approval dropped after non-doctor decision: ' || (doctor_approved_by is null) from cycles where id = :'c1';

-- =====================================================================
-- 9. طلب مسؤول الصيادلة: المختص بالمريض أو المقيم الأقدم، ويُسقط الاعتماد
-- =====================================================================
set request.jwt.claim.sub = :'SPA';
select approve_cycle(:'c1');
set request.jwt.claim.sub = :'CHIEF';
select submit_change_request(:'c1', jsonb_build_array(jsonb_build_object('kind', 'diagnosis', 'payload', jsonb_build_object('diagnosis', 'لمفوما هودجكن كلاسيكية', 'stage', 'IIA'))), 'أخرى', 'تدقيق التشخيص') as rch \gset
select 'P9a ' || t.err('chief decides own request', format('select decide_change_request(%L, null, null)', :'rch'));
reset role;
select 'P9b chief request notified: specialist=' || count(*) filter (where user_id = :'SPA')
       || ' SR=' || count(*) filter (where user_id = :'SR') || ' chief=' || count(*) filter (where user_id = :'CHIEF')
  from notifications where link_id = :'rch';
set role authenticated;
set request.jwt.claim.sub = :'SPA';
select 'P9c specialist decides chief request: ' || decide_change_request(:'rch', (select array_agg(id) from change_request_items where request_id = :'rch'), null);
select 'P9d dx: ' || diagnosis || ' ' || stage || ' · approval dropped: ' || (select doctor_approved_by is null from cycles where id = :'c1')
  from treatments where id = :'tid';
select approve_cycle(:'c1');

-- =====================================================================
-- 5. التفاعل أثناء الإعطاء يصل إلى كل مقدمي الرعاية
-- =====================================================================
set request.jwt.claim.sub = :'NU';
select 'P5a given with reaction: ' || (record_administration(:'d_vbl', 1, '{}'::jsonb, 'حكة وطفح') is not null);
reset role;
select 'P5b reaction alert reached: ' || string_agg(distinct p.role::text, ',' order by p.role::text)
       || ' · nurse self=' || count(*) filter (where n.user_id = :'NU')
  from notifications n join profiles p on p.id = n.user_id
 where n.kind = 'alert' and n.title like 'تفاعل أثناء الإعطاء%';
set role authenticated;

-- =====================================================================
-- 6 و7. الإغلاق والتأجيل
-- =====================================================================
set request.jwt.claim.sub = :'NU';
select 'P6a ' || t.err('nurse completes cycle', format('select complete_cycle(%L)', :'c1'));
set request.jwt.claim.sub = :'CP';
select 'P7a ' || t.err('clinical postpones', format($q$select postpone_cycle(%L, current_date + 30, 'سبب')$q$, :'c2'));
set request.jwt.claim.sub = :'CHIEF';
select postpone_cycle(:'c2', current_date + 35, 'العدلات منخفضة');
select 'P7b chief postponed: ' || (planned_date = current_date + 35) from cycles where id = :'c2';
select complete_cycle(:'c1');
select 'P6b chief completed: ' || status || ' · unsent orders closed: '
       || (select string_agg(day || '=' || status, ',' order by day) from mixing_orders where cycle_id = :'c1')
  from cycles where id = :'c1';

-- =====================================================================
-- 13 و14. رديف مسؤول الصيادلة
-- =====================================================================
set request.jwt.claim.sub = :'CHIEF';
select 'P13a ' || t.err('chief designates deputy', format('select admin_set_deputy(%L, true)', :'DEP'));
set request.jwt.claim.sub = :'ADM';
select 'P13b ' || t.err('admin makes nurse deputy', format('select admin_set_deputy(%L, true)', :'NU'));
select admin_set_deputy(:'DEP', true);
set request.jwt.claim.sub = :'DEP';
select 'P13c designated but off, role: ' || my_role();
select 'P13d ' || t.err('deputy postpones while off', format($q$select postpone_cycle(%L, current_date + 36, 'سبب')$q$, :'c2'));
select 'P13e ' || t.err('deputy activates self', format('select chief_set_deputy_active(%L, true)', :'DEP'));
select 'P13f ' || t.err('deputy edits own flag', format('update profiles set deputy_active = true where id = %L', :'DEP'));
set request.jwt.claim.sub = :'ADM';
select 'P13g ' || t.err('admin (not chief) activates', format('select chief_set_deputy_active(%L, true)', :'DEP'));
set request.jwt.claim.sub = :'CHIEF';
select chief_set_deputy_active(:'DEP', true);
set request.jwt.claim.sub = :'DEP';
select 'P13h active deputy role: ' || my_role();
select postpone_cycle(:'c2', current_date + 36, 'تأجيل من الرديف');
select 'P13i deputy postponed: ' || (planned_date = current_date + 36) from cycles where id = :'c2';
select create_treatment(:'pt2', (select id from protocols where name = 'R-CHOP-21'), 'DLBCL', null, null, current_date) as tid3 \gset
select 'P13j deputy (acting chief) creates plan, active since file 38: ' || status from treatments where id = :'tid3';
select 'P13k ' || t.err('active deputy activates other', format('select chief_set_deputy_active(%L, true)', :'DEP'));
set request.jwt.claim.sub = :'CP';
select submit_change_request(:'c2', jsonb_build_array(jsonb_build_object('kind', 'dose', 'target_dose_id',
  (select id from cycle_doses where cycle_id = :'c2' and drug_name = 'Dacarbazine'), 'new_value', '550', 'apply_onward', false)), 'أخرى', 'تقرير') as rcp3 \gset
reset role;
select 'P13l active deputy notified as chief: ' || count(*) from notifications where user_id = :'DEP' and link_id = :'rcp3';
set role authenticated;
set request.jwt.claim.sub = :'DEP';
select 'P13m deputy decides clinical request: ' || decide_change_request(:'rcp3', (select array_agg(id) from change_request_items where request_id = :'rcp3'), null);
set request.jwt.claim.sub = :'CHIEF';
select chief_set_deputy_active(:'DEP', false);
set request.jwt.claim.sub = :'DEP';
select 'P14a deputy off, role: ' || my_role();
select 'P14b ' || t.err('deputy postpones after stop', format($q$select postpone_cycle(%L, current_date + 37, 'سبب')$q$, :'c2'));
select 'P14c still clinical: can request: ' || (submit_change_request(:'c2', jsonb_build_array(jsonb_build_object('kind', 'dose', 'target_dose_id',
  (select id from cycle_doses where cycle_id = :'c2' and drug_name = 'Dacarbazine'), 'new_value', '540', 'apply_onward', false)), 'أخرى', 'تقرير') is not null);
reset role;
select 'P14d deputy told: ' || string_agg(title, ' | ' order by created_at) from notifications where user_id = :'DEP' and kind = 'info';

select 'APPROVAL CHAIN DONE';
