-- اختبار الملف 32: حالة المرض في خطة العلاج
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
\set SPA '00000000-0000-0000-0000-000000000032'
set role authenticated;
set request.jwt.claim.sub = :'SPA';
select set_config('t.pid', register_patient('مريض حالة المرض', '1980-01-01', 'male', 170, 70, null, null, :'SPA')::text, false) is not null as ok \gset
select set_config('t.tid', create_treatment(current_setting('t.pid')::uuid, (select id from protocols where approved_at is not null and archived_at is null limit 1),
  'Diffuse large B-cell lymphoma', 'C83.3', 'Grade 2', current_date, 'relapse')::text, false) is not null as ok \gset
select 'S1 status saved: ' || disease_status || ' · grade ' || stage from treatments where id = current_setting('t.tid')::uuid;
do $$ begin perform create_treatment(current_setting('t.pid')::uuid, (select id from protocols where approved_at is not null limit 1), 'x', null, null, current_date, 'bogus'); raise exception 'X';
exception when others then raise notice 'S2 bad status rejected: %', sqlerrm; end $$;
select 'S3 old 6-arg call still works: ' || (to_regprocedure('public.create_treatment(uuid,uuid,text,text,text,date,text)') is not null);
reset role;
select 'DISEASE STATUS DONE';
