-- اختبار الملف 15: طريقة إدخال التحليل، ومنع حذف دواء أُرسل من المزج ولم يُعطَ (بعد 08)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

set role authenticated;
-- مستخدمو الاختبار 08: المختص أ، المقيم الأقدم، الصيدلي، المزج
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000035';
select register_patient('مريض القراءة الآلية', null, 'male', 170, 70, null, null, '00000000-0000-0000-0000-000000000032') as pt \gset
select add_attachment(:'pt', 'lab', 'patients/' || :'pt' || '/cbc.jpg', 'تعداد دم') as att \gset
select 'L1 saved: ' || add_lab_results(:'pt', current_date,
  '[{"test_name":"WBC","value":7.85,"unit":"×10⁹/L","ref_low":4,"ref_high":11,"entry_method":"ocr"},
    {"test_name":"Hb","value":12.4,"unit":"g/dL","ref_low":13.5,"ref_high":17.5,"entry_method":"ocr"},
    {"test_name":"ANC","value":5.1,"unit":"×10⁹/L","ref_low":1.5,"ref_high":8}]'::jsonb, :'att');
select 'L2 methods: ' || string_agg(test_name || '=' || entry_method, ',' order by test_name) from lab_results where patient_id = :'pt';
select 'L3 ' || t.err('ocr without image', format($q$select add_lab_results(%L, current_date, '[{"test_name":"PLT","value":245,"entry_method":"ocr"}]'::jsonb)$q$, :'pt'));
select add_lab_results(:'pt', current_date, '[{"test_name":"PLT","value":245,"entry_method":"magic"}]'::jsonb, :'att') as n4 \gset
select 'L4 unknown method stored as manual: ' || entry_method from lab_results where patient_id = :'pt' and test_name = 'PLT';
reset role;
select 'L5 ' || t.err('bad method directly', format($q$insert into lab_results(patient_id, test_date, test_name, value, entry_method) values (%L, current_date, 'x', 1, 'guess')$q$, :'pt'));

-- حذف دواء أُرسل من المزج ولم يُعطَ: مرفوض، وبعد الإعطاء أو قبل الإرسال مسموح
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000034';
select create_treatment(:'pt', (select id from protocols where name = 'ABVD'), 'لمفوما هودجكن', null, null, current_date) as tid \gset
select id as c1 from cycles where treatment_id = :'tid' and cycle_no = 1 \gset
select approve_cycle(:'c1');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000037';
select mi.id as mi_b, mi.cycle_dose_id as d_b from mixing_items mi join cycle_doses cd on cd.id = mi.cycle_dose_id join mixing_orders o on o.id = mi.order_id
 where o.cycle_id = :'c1' and o.day = 1 and cd.drug_name = 'Bleomycin' \gset
select mark_prepared(:'mi_b', true);
select send_prepared(o.id) from mixing_orders o where o.cycle_id = :'c1' and o.day = 1;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000034';
select 'L6 ' || t.err('remove sent-not-given drug', format($q$select doctor_edit(%L, jsonb_build_array(jsonb_build_object('kind','remove_drug','target_dose_id',%L,'payload','{"reason":"x"}'::jsonb)))$q$, :'c1', :'d_b'));
select 'L6b still active: ' || (archived_at is null) from cycle_doses where id = :'d_b';
select id as d_d from cycle_doses where cycle_id = :'c1' and drug_name = 'Dacarbazine' \gset
select doctor_edit(:'c1', jsonb_build_array(jsonb_build_object('kind', 'remove_drug', 'target_dose_id', :'d_d', 'payload', '{"reason":"سمية"}'::jsonb)));
select 'L7 unsent drug removed: ' || (archived_at is not null) from cycle_doses where id = :'d_d';
reset role;
select 'LAB OCR DONE';
