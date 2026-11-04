-- اختبار جرعة AUC (Carboplatin) بمعادلتي Calvert وCockcroft-Gault (محلياً فقط)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';  -- طبيب اختصاص

select create_protocol('TEST-AUC', 'اختبار', 'iv', 21, 3, jsonb_build_array(
  jsonb_build_object('drug_name','Etoposide','dose_value',100,'dose_unit','mg/m2','route','IV','days','1-3'),
  jsonb_build_object('drug_name','Carboplatin','dose_value',5,'dose_unit','AUC','route','IV','days','1','max_dose',800)
)) as prot \gset

do $$ begin perform create_protocol('TEST-AUC-BAD', 'x', 'iv', 21, 1,
  jsonb_build_array(jsonb_build_object('drug_name','Carboplatin','dose_value',50,'dose_unit','AUC','route','IV','days','1')));
  raise exception 'FAIL'; exception when check_violation then raise notice 'A1 AUC 50 rejected OK'; end $$;

-- رجل 60 سنة، 70 كغ، كرياتينين 1.0 ← CrCl = 80×70/72 = 77.8 ≈ 78 ← 5 × 103 = 515
select register_patient('رجل AUC', (current_date - interval '60 years 2 months')::date, 'male', 170, 70, '07700000201', null, null) as m \gset
do $$ begin perform create_treatment((select id from patients where full_name = 'رجل AUC'), (select id from protocols where name = 'TEST-AUC'), 'x', null, null, current_date);
  raise exception 'FAIL'; exception when others then raise notice 'A2 no creatinine: %', sqlerrm; end $$;
select add_lab_results(:'m', current_date - 40, '[{"test_name":"Creatinine","value":1.0,"unit":"mg/dL"}]');
do $$ begin perform create_treatment((select id from patients where full_name = 'رجل AUC'), (select id from protocols where name = 'TEST-AUC'), 'x', null, null, current_date);
  raise exception 'FAIL'; exception when others then raise notice 'A3 creatinine 40 days old: %', sqlerrm; end $$;
select add_lab_results(:'m', current_date - 2, '[{"test_name":"Creatinine","value":1.0,"unit":"mg/dL"}]');
select create_treatment(:'m', :'prot', 'x', null, null, current_date) as tm \gset
select 'A4 male: ' || d.final_dose || ' mg | ' || d.calc_note from cycle_doses d join cycles c on c.id = d.cycle_id
 where c.treatment_id = :'tm' and c.cycle_no = 1 and d.drug_name = 'Carboplatin';

-- امرأة بالقيم نفسها: ×0.85 ← 66.1 ≈ 66 ← 5 × 91 = 455
select register_patient('امرأة AUC', (current_date - interval '60 years 2 months')::date, 'female', 160, 70, '07700000202', null, null) as f \gset
select add_lab_results(:'f', current_date, '[{"test_name":"Creatinine","value":88.4,"unit":"µmol/L"}]');
select create_treatment(:'f', :'prot', 'x', null, null, current_date) as tf \gset
select 'A5 female (µmol/L): ' || d.final_dose || ' mg | ' || d.calc_note from cycle_doses d join cycles c on c.id = d.cycle_id
 where c.treatment_id = :'tf' and c.cycle_no = 1 and d.drug_name = 'Carboplatin';

-- شاب 30 سنة، 80 كغ، كرياتينين 0.6 ← CrCl 204 يُقصّ إلى 125 ← 5 × 150 = 750 (السقف 800 لا يُبلغ)
select register_patient('شاب AUC', (current_date - interval '30 years 2 months')::date, 'male', 180, 80, '07700000203', null, null) as y \gset
select add_lab_results(:'y', current_date, '[{"test_name":"Creatinine","value":0.6,"unit":"mg/dL"}]');
select create_treatment(:'y', :'prot', 'x', null, null, current_date) as ty \gset
select 'A6 GFR cap: ' || d.final_dose || ' mg capped=' || d.capped || ' | ' || d.calc_note from cycle_doses d join cycles c on c.id = d.cycle_id
 where c.treatment_id = :'ty' and c.cycle_no = 1 and d.drug_name = 'Carboplatin';

-- بلا تاريخ ميلاد
select register_patient('بلا عمر AUC', null, 'male', 170, 70, '07700000204', null, null) as nb \gset
select add_lab_results(:'nb', current_date, '[{"test_name":"Creatinine","value":1.0,"unit":"mg/dL"}]');
do $$ begin perform create_treatment((select id from patients where full_name = 'بلا عمر AUC'), (select id from protocols where name = 'TEST-AUC'), 'x', null, null, current_date);
  raise exception 'FAIL'; exception when others then raise notice 'A7 no birth date: %', sqlerrm; end $$;

-- كرياتينين أحدث 1.5 ← CrCl = 80×70/108 = 51.9 ≈ 52 ← 5 × 77 = 385، يُطبَّق على الدورة 2 وحدها
select add_lab_results(:'m', current_date, '[{"test_name":"Creatinine","value":1.5,"unit":"mg/dL"}]');
select 'A8 recalc changed: ' || recalc_auc((select id from cycles where treatment_id = :'tm' and cycle_no = 2));
select 'A9 per cycle: ' || string_agg(c.cycle_no || '=' || d.final_dose || '/' || d.source, ' ' order by c.cycle_no)
  from cycles c join cycle_doses d on d.cycle_id = c.id where c.treatment_id = :'tm' and d.drug_name = 'Carboplatin';
select 'A10 etoposide untouched: ' || string_agg(distinct d.final_dose::text, ',')
  from cycles c join cycle_doses d on d.cycle_id = c.id where c.treatment_id = :'tm' and d.drug_name = 'Etoposide';
select 'A11 audit request: ' || count(*) from change_requests where cycle_id = (select id from cycles where treatment_id = :'tm' and cycle_no = 2)
   and report like 'إعادة حساب جرعة AUC%';
select 'A12 recalc again no change: ' || recalc_auc((select id from cycles where treatment_id = :'tm' and cycle_no = 2));

-- الصيدلي السريري لا يعيد الحساب مباشرة
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
do $$ begin perform recalc_auc((select c.id from cycles c join treatments t on t.id = c.treatment_id
                                  join patients p on p.id = t.patient_id where p.full_name = 'رجل AUC' and c.cycle_no = 3));
  raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'A13 pharmacist blocked OK'; end $$;
reset role;
select 'AUC DONE';
