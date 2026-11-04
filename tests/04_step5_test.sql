-- اختبار الخطوة 5: لا إعطاء قبل الاعتماد والتحقق (محلياً فقط، بعد 01 و02 و03)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000020', 'nu2@t', '{"full_name":"ممرضة","role":"nurse"}');
update profiles set status = 'active', subscription_ends = current_date + 30 where id = '00000000-0000-0000-0000-000000000020';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select register_patient('مريض الخطوة الخامسة', null, 'male', 170, 70) as pid \gset
select create_treatment(:'pid', (select id from protocols where name = 'R-CHOP-21'), 'DLBCL', null, null, current_date) as tid \gset
select id as cid from cycles where treatment_id = :'tid' and cycle_no = 1 \gset
select id as pred from cycle_doses where cycle_id = :'cid' and drug_name = 'Prednisone' \gset

-- قبل الاعتماد: الممرضة لا تسجّل حتى الدواء الفموي
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000020';
do $$ begin perform record_administration((select id from cycle_doses where drug_name = 'Prednisone'
   and cycle_id = (select c.id from cycles c join treatments t on t.id = c.treatment_id join patients p on p.id = t.patient_id
                   where p.full_name = 'مريض الخطوة الخامسة' and c.cycle_no = 1)), 1);
  raise exception 'FAIL'; exception when others then raise notice 'S1 oral before approval: %', sqlerrm; end $$;

-- بعد اعتماد الطبيب فقط: ما زال ممنوعاً
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select approve_cycle(:'cid');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000020';
do $$ begin perform record_administration((select cd.id from cycle_doses cd join cycles c on c.id = cd.cycle_id join treatments t on t.id = c.treatment_id
   join patients p on p.id = t.patient_id where p.full_name = 'مريض الخطوة الخامسة' and c.cycle_no = 1 and cd.drug_name = 'Prednisone'), 1);
  raise exception 'FAIL'; exception when others then raise notice 'S2 before pharmacist: %', sqlerrm; end $$;

-- بعد تحقق الصيدلاني: يُسجَّل الفموي، والممزوج ينتظر المزج
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select verify_cycle(:'cid');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000020';
select 'S3 oral after verification: ' || (record_administration(:'pred', 1, '{"bp":"120/80"}') is not null);
do $$ begin perform record_administration((select cd.id from cycle_doses cd join cycles c on c.id = cd.cycle_id join treatments t on t.id = c.treatment_id
   join patients p on p.id = t.patient_id where p.full_name = 'مريض الخطوة الخامسة' and c.cycle_no = 1 and cd.drug_name = 'Prednisone'), 3);
  raise exception 'FAIL'; exception when others then raise notice 'S3b future day: %', sqlerrm; end $$;
do $$ begin perform record_administration((select cd.id from cycle_doses cd join cycles c on c.id = cd.cycle_id join treatments t on t.id = c.treatment_id
   join patients p on p.id = t.patient_id where p.full_name = 'مريض الخطوة الخامسة' and c.cycle_no = 1 and cd.drug_name = 'Rituximab'), 1);
  raise exception 'FAIL'; exception when others then raise notice 'S4 mixed not sent: %', sqlerrm; end $$;

-- خطة موقوفة: لا إعطاء
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select stop_treatment(:'tid', 'اختبار');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000020';
do $$ begin perform record_administration((select cd.id from cycle_doses cd join cycles c on c.id = cd.cycle_id join treatments t on t.id = c.treatment_id
   join patients p on p.id = t.patient_id where p.full_name = 'مريض الخطوة الخامسة' and c.cycle_no = 1 and cd.drug_name = 'Prednisone'), 2);
  raise exception 'FAIL'; exception when others then raise notice 'S5 stopped plan: %', sqlerrm; end $$;
reset role;
select 'STEP5 DONE';
