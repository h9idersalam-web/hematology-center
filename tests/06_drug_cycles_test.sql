-- اختبار دورات الدواء وإصلاح «تطبيق على اللاحقة» (محلياً فقط، بعد الاختبارات السابقة)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';  -- طبيب اختصاص

-- بروتوكول بثلاث دورات: Carfilzomib 20 في الدورة 1 فقط ثم 56، وMTX وريدي وداخل القراب
select create_protocol('TEST-CYC', 'اختبار', 'mixed', 28, 3, jsonb_build_array(
  jsonb_build_object('drug_name','Carfilzomib','dose_value',20,'dose_unit','mg/m2','route','IV','days','1','cycles','1'),
  jsonb_build_object('drug_name','Carfilzomib','dose_value',56,'dose_unit','mg/m2','route','IV','days','8,15','cycles','1'),
  jsonb_build_object('drug_name','Carfilzomib','dose_value',56,'dose_unit','mg/m2','route','IV','days','1,8,15','cycles','2-3'),
  jsonb_build_object('drug_name','Methotrexate','dose_value',3000,'dose_unit','mg/m2','route','IV','days','2'),
  jsonb_build_object('drug_name','Methotrexate','dose_value',12.5,'dose_unit','mg','route','IT','days','2'),
  jsonb_build_object('drug_name','Lenalidomide','dose_value',25,'dose_unit','mg','route','PO','days','1-21','cycles',' ')
)) as prot \gset
select 'C1 cycles stored: ' || string_agg(drug_name || '=' || coalesce(cycles, 'all'), ' ' order by sort)
  from protocol_drugs where protocol_id = :'prot';

-- دورات خارج عدد الدورات أو بصيغة خاطئة
do $$ begin perform create_protocol('TEST-BAD1', 'x', 'iv', 21, 3,
  jsonb_build_array(jsonb_build_object('drug_name','X','dose_value',1,'dose_unit','mg','route','IV','days','1','cycles','4')));
  raise exception 'FAIL'; exception when others then raise notice 'C2 cycle beyond total: %', sqlerrm; end $$;
do $$ begin perform create_protocol('TEST-BAD2', 'x', 'iv', 21, 3,
  jsonb_build_array(jsonb_build_object('drug_name','X','dose_value',1,'dose_unit','mg','route','IV','days','1','cycles','1;2')));
  raise exception 'FAIL'; exception when others then raise notice 'C3 bad format: %', sqlerrm; end $$;

-- خطة: كل دورة تأخذ أدويتها فقط
select register_patient('مريض اختبار الدورات', '1960-01-01', 'male', 170, 70, '07700000009', null, null) as pt \gset
select create_treatment(:'pt', :'prot', 'اختبار', null, null, '2026-11-10') as tid \gset
select 'C4 cycle ' || c.cycle_no || ': ' || string_agg(d.drug_name || ' ' || d.final_dose || ' d' || d.days || ' ' || d.route, ' | ' order by d.sort)
  from cycles c join cycle_doses d on d.cycle_id = c.id where c.treatment_id = :'tid' group by c.cycle_no order by c.cycle_no;

-- تعديل MTX داخل القراب في الدورة 1 مع «اللاحقة»: لا يمس MTX الوريدي
select id as it1 from cycle_doses where cycle_id = (select id from cycles where treatment_id = :'tid' and cycle_no = 1)
   and drug_name = 'Methotrexate' and route = 'IT' \gset
select doctor_edit((select id from cycles where treatment_id = :'tid' and cycle_no = 1),
  jsonb_build_array(jsonb_build_object('kind','dose','target_dose_id', :'it1','new_value','15','apply_onward', true)), 'اختبار');
select 'C5 MTX after onward edit: ' || string_agg(c.cycle_no || ':' || d.route || '=' || d.final_dose, ' ' order by c.cycle_no, d.route)
  from cycles c join cycle_doses d on d.cycle_id = c.id
 where c.treatment_id = :'tid' and d.drug_name = 'Methotrexate';

-- حذف Carfilzomib 56 (الأيام 1,8,15) من الدورة 2 فما بعد: يبقى سطر الدورة 1
select id as k2 from cycle_doses where cycle_id = (select id from cycles where treatment_id = :'tid' and cycle_no = 2)
   and drug_name = 'Carfilzomib' \gset
select doctor_edit((select id from cycles where treatment_id = :'tid' and cycle_no = 2),
  jsonb_build_array(jsonb_build_object('kind','remove_drug','target_dose_id', :'k2','apply_onward', true,
                                       'payload', jsonb_build_object('reason','اختبار'))), 'اختبار');
select 'C6 carfilzomib live rows per cycle: ' || string_agg(c.cycle_no || '=' || (select count(*) from cycle_doses d
         where d.cycle_id = c.id and d.drug_name = 'Carfilzomib' and d.archived_at is null), ' ' order by c.cycle_no)
  from cycles c where c.treatment_id = :'tid';
reset role;
select 'DRUG CYCLES DONE';
