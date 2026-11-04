-- اختبار الخطوة 3: تسجيل المرضى والبحث والملخص والتأجيل (محلياً فقط، بعد 01 و02)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

set role authenticated;

-- المدير (مسؤول الصيادلة) يسجّل مريضاً لطبيبة الاختصاص
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select register_patient('  أحمد عليّ الحسيني ', '1980-05-01', 'male', 172, 81, '٠٧٧٠١٢٣٤٥٦٧', 'لا توجد حساسية معروفة',
                        '00000000-0000-0000-0000-000000000002') as pid \gset
select 'P1 trimmed name: [' || full_name || '] file ' || (file_no ~ '^HEM-\d{4}-\d{4}$') from patients where id = :'pid';
select 'P2 search key: ' || search_key from patients where id = :'pid';
select 'P3 find by احمد علي: ' || count(*) from patient_overview where search_key like '%احمد علي%';
select 'P3b find by phone digits: ' || count(*) from patient_overview where search_key like '%07701234567%';

-- الطبيب الدوري لا يسجّل
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
do $$ begin perform register_patient('x', null, 'male', null, null); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'P4 intern register blocked OK'; end $$;
select 'P4b intern sees overview: ' || (count(*) > 0) from patient_overview;

-- الملخص قبل الخطة
select 'P5 no plan: ' || coalesce(treatment_status, 'none') || ' specialist=' || specialist_name
  from patient_overview where id = :'pid';

-- طبيبة الاختصاص تعتمد البروتوكول وتنشئ الخطة
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select id as rchop from protocols where name = 'R-CHOP-21' \gset
select approve_protocol(:'rchop');
select create_treatment(:'pid', :'rchop', 'DLBCL', 'C83.3', 'II', current_date + 3) as tid \gset
select 'P6 overview: ' || protocol_name || ' ' || treatment_status || ' next=' || next_cycle_no || '@' || (next_date - current_date)
       || ' last=' || coalesce(last_cycle_no::text, '-')
  from patient_overview where id = :'pid';

-- إغلاق الدورة الأولى ثم تأجيل الثانية
select id as c1 from cycles where treatment_id = :'tid' and cycle_no = 1 \gset
select complete_cycle(:'c1');
select id as c2, planned_date as d2 from cycles where treatment_id = :'tid' and cycle_no = 2 \gset
select postpone_cycle(:'c2', (:'d2'::date + 7), 'نقص العدلات');
select 'P7 after give+postpone: last=' || last_cycle_no || ' next=' || next_cycle_no || ' shift=' || (next_date - :'d2'::date)
  from patient_overview where id = :'pid';

-- الصيدلي السريري لا يؤجّل
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
do $$ begin perform postpone_cycle((select id from cycles where cycle_no = 3 and status = 'planned' limit 1), current_date + 30, 'x');
  raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'P8 pharmacist postpone blocked OK'; end $$;

-- تعديل البيانات وأثره في البحث
select update_patient(:'pid', 'أحمد علي الحسيني', '1980-05-01', 'male', 172, 78, '07701234567', 'Penicillin',
                      '00000000-0000-0000-0000-000000000002');
select 'P9 updated: ' || weight_kg || ' ' || allergies from patients where id = :'pid';

-- الأرشفة: طبيب الاختصاص فقط، ومع سبب
do $$ begin perform archive_patient((select id from patients where full_name = 'أحمد علي الحسيني'), 'x');
  raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'P10 pharmacist archive blocked OK'; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select archive_patient(:'pid', 'انتقل إلى مركز آخر');
select 'P11 archived visible with reason: ' || archive_reason from patient_overview where id = :'pid';
do $$ begin perform update_patient((select id from patients where full_name = 'أحمد علي الحسيني'), 'y', null, 'male', null, null, null, null, null);
  raise exception 'FAIL'; exception when others then raise notice 'P12 edit archived: %', sqlerrm; end $$;

-- مستخدم غير مفعّل لا يرى الملخص
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000008';
select 'P13 pending sees overview: ' || count(*) from patient_overview;
reset role;
set role anon;
do $$ begin perform 1 from patient_overview; raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'P14 anon blocked OK'; end $$;
reset role;
select 'PATIENTS DONE';
