-- اختبار المسار الكامل بأدوار مختلفة (محلياً فقط)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

-- إنشاء المستخدمين (كما يفعل التسجيل في التطبيق)
insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001', 'admin@t',  '{"full_name":"حيدر","role":"chief_clinical_pharmacist"}'),
 ('00000000-0000-0000-0000-000000000002', 'sp@t',     '{"full_name":"د. سارة","role":"specialist"}'),
 ('00000000-0000-0000-0000-000000000003', 'sr@t',     '{"full_name":"د. مرتضى","role":"senior_resident"}'),
 ('00000000-0000-0000-0000-000000000004', 'in@t',     '{"full_name":"د. علي","role":"intern"}'),
 ('00000000-0000-0000-0000-000000000005', 'cp@t',     '{"full_name":"صيدلي سريري","role":"clinical_pharmacist"}'),
 ('00000000-0000-0000-0000-000000000006', 'mx@t',     '{"full_name":"زهراء","role":"mixing_pharmacist"}'),
 ('00000000-0000-0000-0000-000000000007', 'nu@t',     '{"full_name":"نور","role":"nurse"}'),
 ('00000000-0000-0000-0000-000000000008', 'bad@t',    '{"full_name":"خطأ","role":"hacker"}');

select 'T1 profiles created: ' || count(*) from profiles;
select 'T1b bad role -> ' || role from profiles where id = '00000000-0000-0000-0000-000000000008';

-- المدير (تشغيل 04_make_admin بنسخة الاختبار)
update profiles set is_admin = true, status = 'active', subscription_ends = null where id = '00000000-0000-0000-0000-000000000001';

-- ===== قبل التفعيل: مستخدم غير مفعّل لا يرى شيئاً
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'T2 pending sees protocols: ' || count(*) from protocols;
select 'T2b pending sees own profile: ' || count(*) from profiles;

-- ===== المدير يصدر كوداً خاصاً بكل مستخدم
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select admin_issue_code('00000000-0000-0000-0000-000000000002', 6)->>'code' as c_sp \gset
select admin_issue_code('00000000-0000-0000-0000-000000000003', 6)->>'code' as c_sr \gset
select admin_issue_code('00000000-0000-0000-0000-000000000004', 3)->>'code' as c_in \gset
select admin_issue_code('00000000-0000-0000-0000-000000000005', 6)->>'code' as c_cp \gset
select admin_issue_code('00000000-0000-0000-0000-000000000006', 6)->>'code' as c_mx \gset
select admin_issue_code('00000000-0000-0000-0000-000000000007', 12)->>'code' as c_nu \gset
select 'T3 code format: ' || (:'c_sp' ~ '^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$');

-- غير المدير لا يصدر كوداً
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin perform admin_issue_code('00000000-0000-0000-0000-000000000003', 6); raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'T4 non-admin code blocked OK'; end $$;

-- كود مستخدم آخر يُرفض
select 'T5 other user code: ' || (activate_account(:'c_nu')->>'error');

-- التفعيل الصحيح
select 'T6 specialist active until: ' || ((activate_account(:'c_sp')->>'active_until')::date = (current_date + interval '6 months')::date);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select 'T7 reused code: ' || (activate_account(:'c_sp')->>'error');
select (activate_account(:'c_sr')->>'ok')::boolean;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; select (activate_account(:'c_in')->>'ok')::boolean;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005'; select (activate_account(:'c_cp')->>'ok')::boolean;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006'; select (activate_account(lower(:'c_mx'))->>'ok')::boolean;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007'; select (activate_account(:'c_nu')->>'ok')::boolean;

-- لا كتابة مباشرة على الجداول
do $$ begin insert into patients(full_name) values ('x'); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'T8 direct insert blocked OK'; end $$;
do $$ begin update profiles set role = 'specialist' where id = auth.uid(); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'T8b self role change blocked OK'; end $$;

-- ===== البروتوكولات: غير معتمدة لا تُستخدم
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'T9 seeded protocols visible: ' || count(*) from protocols;
select id as p_rchop from protocols where name = 'R-CHOP-21' \gset

-- ===== تسجيل مريض (الطبيب المختص)
select register_patient('علي حسين كاظم', '1974-03-18', 'male', 172, 78, '07700000000', null, null) as pt \gset
select 'T10 file_no: ' || file_no || ' specialist auto-set: ' || (specialist_id = auth.uid()) from patients where id = :'pt';

-- الطبيب الدوري لا يسجّل
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select set_config('my.pt', :'pt', false);
do $$ begin perform register_patient('x', null, 'male', 170, 70); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'T11 intern register blocked OK'; end $$;
select 'T11b intern can view patients: ' || count(*) from patients;

-- خطة علاج ببروتوكول غير معتمد تُرفض
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select set_config('my.prot', :'p_rchop', false);
do $$ begin perform create_treatment(current_setting('my.pt')::uuid, current_setting('my.prot')::uuid, 'DLBCL', 'C83.3', 'III', '2026-10-01');
raise exception 'FAIL'; exception when others then raise notice 'T12 unapproved protocol: %', sqlerrm; end $$;

select approve_protocol(:'p_rchop');
select create_treatment(:'pt', :'p_rchop', 'لمفوما الخلايا البائية الكبيرة المنتشرة', 'C83.3', 'III', '2026-10-01') as tid \gset
select 'T13 BSA: ' || bsa || ' cycles: ' || (select count(*) from cycles where treatment_id = :'tid') from treatments where id = :'tid';
select 'T13b cycle dates: ' || string_agg(cycle_no || '=' || planned_date, ' ' order by cycle_no) from cycles where treatment_id = :'tid';
select 'T14 cycle1 doses: ' || string_agg(drug_name || ' ' || final_dose || final_unit || case when capped then '(cap ' || calculated || ')' else '' end, ', ' order by sort)
  from cycle_doses cd join cycles c on c.id = cd.cycle_id where c.treatment_id = :'tid' and c.cycle_no = 1;
select 'T14b cycle3 copied from cycle1: ' || string_agg(drug_name || ' ' || final_dose || ' [' || source || ']', ', ' order by sort)
  from cycle_doses cd join cycles c on c.id = cd.cycle_id where c.treatment_id = :'tid' and c.cycle_no = 3;

select id as c3 from cycles where treatment_id = :'tid' and cycle_no = 3 \gset
select id as d3_dox from cycle_doses where cycle_id = :'c3' and drug_name = 'Doxorubicin' \gset
select id as d3_vcr from cycle_doses where cycle_id = :'c3' and drug_name = 'Vincristine' \gset

-- ===== الصيدلي السريري: لا يغيّر البروتوكول
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select set_config('my.c3', :'c3', false);
do $$ begin perform submit_change_request(current_setting('my.c3')::uuid,
  jsonb_build_array(jsonb_build_object('kind','protocol','payload',jsonb_build_object('protocol_id', current_setting('my.prot')))), 'x', 'تقرير');
raise exception 'FAIL'; exception when others then raise notice 'T15 clinical pharmacist protocol change: %', sqlerrm; end $$;
do $$ begin perform submit_change_request(current_setting('my.c3')::uuid,
  '[{"kind":"add_drug","payload":{"drug_name":"Cisplatin","route":"IV","final_dose":100}}]'::jsonb, 'x', 'تقرير');
raise exception 'FAIL'; exception when others then raise notice 'T15b non-supportive add: %', sqlerrm; end $$;

-- ===== مسؤول الصيادلة (المدير هنا): طلب تعديل كامل
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select submit_change_request(:'c3', jsonb_build_array(
   jsonb_build_object('kind','dose','target_dose_id', :'d3_dox','new_value','48','apply_onward', false),
   jsonb_build_object('kind','dose','target_dose_id', :'d3_vcr','new_value','1','apply_onward', true),
   jsonb_build_object('kind','add_drug','payload', jsonb_build_object('drug_name','Ondansetron','route','IV','final_dose',8,'supportive',true))
 ), 'وظائف الكبد', 'ارتفع البيليروبين إلى 1.8') as req \gset
select 'T16 not applied before approval: ' || final_dose from cycle_doses where id = :'d3_dox';
reset role; select 'T16b specialist notified: ' || count(*) from notifications where user_id = '00000000-0000-0000-0000-000000000002' and kind = 'approval'; set role authenticated;

-- الطبيب المقيم لا يقرّر
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select set_config('my.req', :'req', false);
do $$ begin perform decide_change_request(current_setting('my.req')::uuid, null, null); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'T17 resident decide blocked OK'; end $$;

-- الطبيب المختص يوافق على بندين ويرفض الثالث، دون سبب (اختياري)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select array_agg(id) filter (where kind = 'dose') as ok_items from change_request_items where request_id = :'req' \gset
select 'T18 decision: ' || decide_change_request(:'req', :'ok_items'::uuid[], null);
select 'T18b dox c3: ' || final_dose || ' edited_from ' || edited_from from cycle_doses where id = :'d3_dox';
select 'T18c vincristine cycles 2..6: ' || string_agg(c.cycle_no || '=' || cd.final_dose, ' ' order by c.cycle_no)
  from cycle_doses cd join cycles c on c.id = cd.cycle_id where c.treatment_id = :'tid' and cd.drug_name = 'Vincristine';
select 'T18d ondansetron not added: ' || count(*) from cycle_doses where drug_name = 'Ondansetron';
select 'T18e pharmacist told: ' || title from notifications where user_id = '00000000-0000-0000-0000-000000000001' and kind = 'decision';

-- ===== الاعتماد ثم التحقق ثم التحويل للمزج
select id as c1 from cycles where treatment_id = :'tid' and cycle_no = 1 \gset
select approve_cycle(:'c1');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select verify_cycle(:'c1');
-- التحويل يتطلب الصورتين
select set_config('my.c1', :'c1', false);
do $$ begin perform transfer_to_mixing(current_setting('my.c1')::uuid, null, null); raise exception 'FAIL';
exception when others then raise notice 'T19 transfer without images: %', sqlerrm; end $$;
select add_attachment(:'pt', 'id_card', 'patients/' || :'pt' || '/id.jpg') as a_id \gset
select add_attachment(:'pt', 'prescription', 'patients/' || :'pt' || '/rx.jpg') as a_rx \gset
select set_config('my.pt2', :'pt', false);
do $$ begin perform add_attachment(current_setting('my.pt2')::uuid, 'lab', 'patients/other/x.jpg'); raise exception 'FAIL';
exception when others then raise notice 'T19b wrong path: %', sqlerrm; end $$;
select transfer_to_mixing(:'c1', :'a_id', :'a_rx') as ord \gset
select 'T20 mixing items (IV only): ' || count(*) from mixing_items where order_id = :'ord';

-- ===== قسم المزج: علامة صح على دواء واحد ثم إرسال
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select set_config('my.ord', :'ord', false);
do $$ begin perform send_prepared(current_setting('my.ord')::uuid); raise exception 'FAIL';
exception when others then raise notice 'T21 send with none ticked: %', sqlerrm; end $$;
select mi.id as mi1 from mixing_items mi join cycle_doses cd on cd.id = mi.cycle_dose_id where mi.order_id = :'ord' and cd.drug_name = 'Rituximab' \gset
select mark_prepared(:'mi1', true);
select 'T22 sent count: ' || send_prepared(:'ord');
select 'T22b order status: ' || status from mixing_orders where id = :'ord';
reset role; select 'T22c notified roles: ' || string_agg(distinct p.role::text, ',') from notifications n join profiles p on p.id=n.user_id where kind = 'mixing_sent'; set role authenticated;

-- ===== التمريض
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007';
select cycle_dose_id as dose_rit from mixing_items where id = :'mi1' \gset
select id as dose_cyc from cycle_doses where cycle_id = :'c1' and drug_name = 'Cyclophosphamide' \gset
select set_config('my.dose_cyc', :'dose_cyc', false);
do $$ begin perform record_administration(current_setting('my.dose_cyc')::uuid); raise exception 'FAIL';
exception when others then raise notice 'T23 give unsent drug: %', sqlerrm; end $$;
select record_administration(:'dose_rit', 1, '{"bp":"120/80"}') is not null;
select set_config('my.dr', :'dose_rit', false);
do $$ begin perform record_administration(current_setting('my.dr')::uuid, 1); raise exception 'FAIL'; exception when others then raise notice 'T23b double give: %', sqlerrm; end $$;
do $$ begin perform record_administration(current_setting('my.dr')::uuid, 8); raise exception 'FAIL'; exception when others then raise notice 'T23c wrong day: %', sqlerrm; end $$;

-- ===== التأجيل يزيح المواعيد التالية
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select postpone_cycle(:'c3', '2026-11-19', 'العدلات منخفضة');
select 'T24 dates after postpone: ' || string_agg(cycle_no || '=' || planned_date, ' ' order by cycle_no) from cycles where treatment_id = :'tid';

-- ===== تعديل مباشر من المقيم: يُطبَّق ويُبلَّغ المختص
select cd.id as d4_cyc from cycle_doses cd join cycles c on c.id = cd.cycle_id where c.treatment_id = :'tid' and c.cycle_no = 4 and drug_name = 'Cyclophosphamide' \gset
select id as c4 from cycles where treatment_id = :'tid' and cycle_no = 4 \gset
select doctor_edit(:'c4', jsonb_build_array(jsonb_build_object('kind','dose','target_dose_id', :'d4_cyc','new_value','1200','apply_onward', true)), 'تخفيض لهبوط العدلات');
select 'T25 cyclo 3..6: ' || string_agg(c.cycle_no || '=' || cd.final_dose, ' ' order by c.cycle_no)
  from cycle_doses cd join cycles c on c.id = cd.cycle_id where c.treatment_id = :'tid' and cd.drug_name = 'Cyclophosphamide' and c.cycle_no >= 3;
reset role; select 'T25b specialist info notice: ' || count(*) from notifications where user_id = '00000000-0000-0000-0000-000000000002' and kind = 'info';

-- ===== الحذف والسجل
reset role;
do $$ begin delete from patients; raise exception 'FAIL'; exception when others then raise notice 'T26 delete blocked: %', sqlerrm; end $$;
do $$ begin delete from audit_log; raise exception 'FAIL'; exception when others then raise notice 'T26b audit delete blocked: %', sqlerrm; end $$;
select 'T27 audit rows: ' || count(*) || ', with actor: ' || count(actor_id) from audit_log;

-- ===== التحاليل والتنبيه الذكي
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select 'T28 labs added: ' || add_lab_results(:'pt', current_date,
  '[{"test_name":"Platelets","value":26,"unit":"x10^9/L","ref_low":150,"ref_high":400},{"test_name":"WBC","value":5,"ref_low":4,"ref_high":11}]');
reset role; select 'T28b alert: ' || body from notifications where kind = 'alert' and user_id = '00000000-0000-0000-0000-000000000002' and title = 'تحليل خارج المرجع';

-- ===== انتهاء الاشتراك يقفل الوصول
reset role;
update profiles set subscription_ends = current_date - 1 where id = '00000000-0000-0000-0000-000000000007';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007';
select 'T29 expired nurse sees patients: ' || count(*) from patients;
-- المستخدم يرى إشعاراته فقط
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select 'T30 notif rows visible to cp all own: ' || bool_and(user_id = auth.uid()) from notifications;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select 'T31 intern audit visible: ' || count(*) from audit_log;
do $$ begin perform count(*) from user_activation_codes; raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'T31b intern codes table blocked OK'; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin perform count(*) from user_activation_codes; raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'T32 admin codes table blocked too (hashes only via functions) OK'; end $$;
-- التخزين
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
do $$ begin insert into storage.objects(bucket_id, name) values ('patient-files', 'patients/x/a.jpg'); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'T33 intern upload blocked OK'; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
insert into storage.objects(bucket_id, name) values ('patient-files', 'patients/x/a.jpg');
select 'T33b pharmacist upload ok, visible: ' || count(*) from storage.objects;
reset role;
select 'DONE';
