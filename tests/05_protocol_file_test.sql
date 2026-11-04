-- اختبار ملف البروتوكول (محلياً فقط، بعد الاختبارات السابقة)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select id as abvd from protocols where name = 'ABVD' \gset
select id as imat from protocols where name = 'Imatinib' \gset
-- ملفات مرفوعة (محاكاة التخزين)
insert into storage.objects(bucket_id, name) values
  ('patient-files', 'protocols/' || :'imat' || '/v1.pdf'),
  ('patient-files', 'protocols/' || :'imat' || '/v2.pdf'),
  ('patient-files', 'protocols/' || :'abvd' || '/a.pdf'),
  ('patient-files', 'protocols/' || :'abvd' || '/b.pdf');

set role authenticated;
-- الصيدلي السريري يرفق لبروتوكول غير معتمد، فيُبلَّغ أطباء الاختصاص
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select set_protocol_file(:'imat', 'protocols/' || :'imat' || '/v1.pdf');
select 'F1 attached: ' || (file_path like '%v1.pdf') from protocols where id = :'imat';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'F1b specialist notified: ' || (count(*) > 0) from notifications where title = 'أُرفق ملف مرجعي لبروتوكول Imatinib';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
-- مسار لبروتوكول آخر أو ملف غير مرفوع
do $$ begin perform set_protocol_file((select id from protocols where name = 'Imatinib'), 'protocols/' || (select id from protocols where name = 'ABVD') || '/a.pdf');
  raise exception 'FAIL'; exception when others then raise notice 'F2 wrong folder: %', sqlerrm; end $$;
do $$ begin perform set_protocol_file((select id from protocols where name = 'Imatinib'), 'protocols/' || (select id from protocols where name = 'Imatinib') || '/missing.pdf');
  raise exception 'FAIL'; exception when others then raise notice 'F3 not uploaded: %', sqlerrm; end $$;

-- ABVD معتمد: الصيدلي يرفق أول ملف، ولا يستبدله
select set_protocol_file(:'abvd', 'protocols/' || :'abvd' || '/a.pdf');
do $$ begin perform set_protocol_file((select id from protocols where name = 'ABVD'), 'protocols/' || (select id from protocols where name = 'ABVD') || '/b.pdf');
  raise exception 'FAIL'; exception when others then raise notice 'F4 pharmacist replace approved: %', sqlerrm; end $$;
-- طبيب الاختصاص يستبدل
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select set_protocol_file(:'abvd', 'protocols/' || :'abvd' || '/b.pdf');
select 'F5 specialist replaced: ' || (file_path like '%b.pdf') from protocols where id = :'abvd';
-- الطبيب الدوري لا يرفق
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
do $$ begin perform set_protocol_file((select id from protocols where name = 'Imatinib'), 'protocols/' || (select id from protocols where name = 'Imatinib') || '/v2.pdf');
  raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'F6 intern blocked OK'; end $$;
reset role;
select 'F7 audit rows for file changes: ' || count(*) from audit_log where table_name = 'protocols' and action = 'UPDATE'
  and new_data->>'file_path' is distinct from old_data->>'file_path';
select 'PROTOCOL FILE DONE';
