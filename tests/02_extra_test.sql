\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
set role authenticated;
-- مسؤول الصيادلة ينشئ خطة لمريض جديد: تنتظر موافقة المختص
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select approve_protocol(id) from protocols where name in ('ABVD','VRd');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select register_patient('زينب عبد الأمير', '1999-01-01', 'female', 160, 59, null, null, '00000000-0000-0000-0000-000000000002') as pt \gset
select create_treatment(:'pt', (select id from protocols where name='ABVD'), 'لمفوما هودجكن', 'C81.9', 'II', current_date) as tid \gset
select 'E1 status: ' || status || ' bsa ' || bsa from treatments where id = :'tid';
-- منذ الملف 38 تبدأ خطة مسؤول الصيادلة مباشرة؛ تُعاد معلّقة هنا لاختبار موافقة المختص على الخطط المعلّقة القديمة
reset role; update treatments set status = 'pending_approval', approved_by = null where id = :'tid'; set role authenticated;
select 'E1b ABVD doses: ' || string_agg(drug_name||' '||final_dose||final_unit, ', ' order by sort) from cycle_doses cd join cycles c on c.id=cd.cycle_id where c.treatment_id=:'tid' and c.cycle_no=1;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select approve_treatment(:'tid');
-- مسؤول الصيادلة يطلب تغيير البروتوكول والتشخيص، والمختص يوافق
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select id as c2 from cycles where treatment_id=:'tid' and cycle_no=2 \gset
select submit_change_request(:'c2', jsonb_build_array(
  jsonb_build_object('kind','diagnosis','payload',jsonb_build_object('stage','III')),
  jsonb_build_object('kind','protocol','payload',jsonb_build_object('protocol_id',(select id from protocols where name='VRd')))
 ), 'أخرى', 'تقرير تجريبي') as req \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'E2 ' || decide_change_request(:'req', (select array_agg(id) from change_request_items where request_id=:'req'), 'موافق');
reset role;
select 'E3 treatments: ' || string_agg(protocol_name||':'||status||':'||coalesce(stage,''), ' | ' order by created_at) from treatments where patient_id=:'pt';
select 'E4 new plan cycles: ' || count(*) from cycles c join treatments t on t.id=c.treatment_id where t.patient_id=:'pt' and t.status='active';
-- مختص آخر لا يقرّر طلباً لمريض ليس مريضه
insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-000000000009','sp2@t','{"full_name":"مختص2","role":"specialist"}');
update profiles set status='active', subscription_ends=current_date+30 where id='00000000-0000-0000-0000-000000000009';
set role authenticated;
-- (الملف 14: صيدلي المزج يطلب الجرعات فقط، فيُرسل طلب الحذف مسؤول الصيادلة)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select c.id as c1n from cycles c join treatments t on t.id=c.treatment_id where t.patient_id=:'pt' and t.status='active' and c.cycle_no=1 \gset
select set_config('my.c1n', :'c1n', false);
do $$ begin perform submit_change_request(current_setting('my.c1n')::uuid, jsonb_build_array(jsonb_build_object('kind','remove_drug','target_dose_id',(select id from cycle_doses where cycle_id=current_setting('my.c1n')::uuid and drug_name='Dexamethasone'))), 'سمية','تقرير'); raise exception 'FAIL';
exception when others then if sqlerrm = 'FAIL' then raise; end if; raise notice 'E4b mixing remove_drug: %', sqlerrm; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select c.id as c1n from cycles c join treatments t on t.id=c.treatment_id where t.patient_id=:'pt' and t.status='active' and c.cycle_no=1 \gset
select submit_change_request(:'c1n', jsonb_build_array(jsonb_build_object('kind','remove_drug','target_dose_id',(select id from cycle_doses where cycle_id=:'c1n' and drug_name='Dexamethasone'))), 'سمية','تقرير') as req2 \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000009';
select set_config('my.r', :'req2', false);
do $$ begin perform decide_change_request(current_setting('my.r')::uuid, null, null); raise exception 'FAIL';
exception when others then raise notice 'E5 other specialist: %', sqlerrm; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'E6 reject w/o reason: ' || decide_change_request(:'req2', null, '');
select 'E6b dexa still active: ' || count(*) from cycle_doses where cycle_id=:'c1n' and drug_name='Dexamethasone' and archived_at is null;
reset role;
select 'EXTRA DONE';
select 'E7 days: ' || days_list('1,15')::text || ' ' || days_list('1-5')::text || ' ' || days_list('1,2,4,5,8,9,11,12')::text || ' ' || days_list('1-3,8')::text;
