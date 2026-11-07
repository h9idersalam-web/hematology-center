-- اختبار الملفين 25 و26: قسم التقارير (الصيدلية الداخلية وتسليم الشفتات)
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
\set ADM '00000000-0000-0000-0000-000000000039'
\set IP  '00000000-0000-0000-0000-000000000081'
\set CP  '00000000-0000-0000-0000-000000000082'
\set CH  '00000000-0000-0000-0000-000000000083'
\set NU  '00000000-0000-0000-0000-000000000084'
insert into auth.users(id, email, raw_user_meta_data) values
 (:'IP', 'rep-ip@t', '{"full_name":"مسؤول الصيدلية الداخلية","role":"internal_pharmacist"}'),
 (:'CP', 'rep-cp@t', '{"full_name":"صيدلي سريري","role":"clinical_pharmacist"}'),
 (:'CH', 'rep-ch@t', '{"full_name":"مسؤول الصيادلة","role":"chief_clinical_pharmacist"}'),
 (:'NU', 'rep-nu@t', '{"full_name":"ممرض","role":"nurse"}');
update profiles set status = 'active', subscription_ends = current_date + 30, activated_at = now()
 where id in (:'IP', :'CP', :'CH', :'NU');
select 'R0 new role registers: ' || role from profiles where id = :'IP';

set role authenticated;
-- ===== تقرير الصيدلية الداخلية
set request.jwt.claim.sub = :'IP';
select set_config('t.rep', inventory_create_report(current_date, 'week1.xlsx',
  '[{"drug_name":"Vincristine 1mg","quantity":"12","unit":"vial","expiry_date":"2027-03-31","status":"available"},
    {"drug_name":"Rituximab 500mg","quantity":2,"status":"low","notes":"طلب شراء"},
    {"drug_name":"Cytarabine","quantity":0}]')::text, false) is not null as created \gset
select 'R1 report created with ' || count(*) || ' drugs; qty 0 => ' || max(status) filter (where drug_name = 'Cytarabine')
  from inventory_items where report_id = current_setting('t.rep')::uuid;
select 'R2 add item: ' || (inventory_save_item(current_setting('t.rep')::uuid, null, '{"drug_name":"Imatinib","quantity":30}') is not null);
select 'R3 edit item: ' || (inventory_save_item(null, (select id from inventory_items where drug_name = 'Rituximab 500mg'),
  '{"drug_name":"Rituximab 500mg","quantity":0,"status":"out"}') is not null);
select 'R4 status after edit: ' || status || ' qty ' || quantity from inventory_items where drug_name = 'Rituximab 500mg';
select inventory_remove_item((select id from inventory_items where drug_name = 'Imatinib'));
select 'R5 removed = archived, row kept: ' || (archived_at is not null) from inventory_items where drug_name = 'Imatinib';
do $$ begin perform inventory_save_item(current_setting('t.rep')::uuid, null, '{"drug_name":" "}'); raise exception 'X';
exception when others then raise notice 'R6 empty name rejected: %', sqlerrm; end $$;
do $$ begin perform inventory_save_item(current_setting('t.rep')::uuid, null, '{"drug_name":"A","quantity":"abc"}'); raise exception 'X';
exception when others then raise notice 'R7 bad qty rejected: %', sqlerrm; end $$;
do $$ begin delete from inventory_items; raise exception 'X';
exception when others then raise notice 'R8 direct delete blocked: %', sqlerrm; end $$;

-- غير المسؤول لا يعدّل، والكل يقرأ
set request.jwt.claim.sub = :'NU';
select 'R9 nurse reads report: ' || count(*) from inventory_items where report_id = current_setting('t.rep')::uuid;
select 'R10 nurse notified: ' || count(*) from notifications where link_type = 'inventory_report';
do $$ begin perform inventory_save_item(current_setting('t.rep')::uuid, null, '{"drug_name":"X"}'); raise exception 'X';
exception when insufficient_privilege then raise notice 'R11 nurse cannot edit inventory OK'; end $$;
set request.jwt.claim.sub = :'CP';
do $$ begin perform inventory_create_report(current_date, 'x', '[]'); raise exception 'X';
exception when insufficient_privilege then raise notice 'R12 clinical pharmacist cannot upload OK'; end $$;
set request.jwt.claim.sub = :'ADM';
select 'R13 admin can edit: ' || (inventory_save_item(current_setting('t.rep')::uuid, null, '{"drug_name":"Admin drug"}') is not null);
set request.jwt.claim.sub = :'IP';
do $$ begin perform inventory_archive_report(current_setting('t.rep')::uuid, ''); raise exception 'X';
exception when others then raise notice 'R14 archive needs reason: %', sqlerrm; end $$;

-- ===== تسليم الشفتات
set request.jwt.claim.sub = :'CP';
select 'H1 add: ' || (handover_save_item(null, 'morning_middle', null, 'مريض أ', 'Vincristine اليوم', 'متابعة الغثيان') is not null);
select 'H2 add 2nd shift: ' || (handover_save_item(null, 'middle_night', null, 'مريض ب', null, 'نقل دم مساءً') is not null);
select 'H3 one report per shift: ' || count(*) from shift_handovers;
do $$ begin perform handover_save_item(null, 'morning_middle', null, 'مريض ج', '', ' '); raise exception 'X';
exception when others then raise notice 'H4 empty meds+notes rejected: %', sqlerrm; end $$;
do $$ begin perform handover_save_item(null, 'night_morning', null, 'مريض ج', 'x', null); raise exception 'X';
exception when others then raise notice 'H5 bad shift rejected: %', sqlerrm; end $$;
select 'H6 edit current: ' || (handover_save_item((select id from shift_handover_items where patient_name = 'مريض أ'),
  null, null, 'مريض أ', 'Vincristine 2mg', 'متابعة') is not null);
set request.jwt.claim.sub = :'NU';
select 'H7 nurse reads handover: ' || count(*) from shift_handover_items;
do $$ begin perform handover_save_item(null, 'morning_middle', null, 'x', 'x', null); raise exception 'X';
exception when insufficient_privilege then raise notice 'H8 nurse cannot write handover OK'; end $$;
set request.jwt.claim.sub = :'IP';
do $$ begin perform handover_save_item(null, 'morning_middle', null, 'x', 'x', null); raise exception 'X';
exception when insufficient_privilege then raise notice 'H9 internal pharmacist cannot write handover OK'; end $$;

-- يوم جديد: تقرير الأمس يختفي ويبقى محفوظاً
reset role;
update shift_handovers set report_date = report_date - 1;
set role authenticated;
set request.jwt.claim.sub = :'CP';
select 'H10 before new day report, yesterday still visible: ' || count(*) from shift_handover_items;
select handover_save_item(null, 'morning_middle', null, 'مريض جديد', 'x', null) is not null as ok \gset
select 'H11 after new day report, CP sees only today: ' || count(*) from shift_handover_items;
do $$ begin perform handover_save_item((select id from shift_handover_items where patient_name = 'مريض جديد'), null, null, 'مريض جديد', 'y', null);
  raise notice 'H12 edit today OK'; end $$;
set request.jwt.claim.sub = :'CH';
select 'H13 chief sees old ones too: ' || count(*) from shift_handover_items;
do $$ begin perform handover_save_item((select id from shift_handover_items where patient_name = 'مريض أ'), null, null, 'مريض أ', 'z', null); raise exception 'X';
exception when others then raise notice 'H14 old report locked: %', sqlerrm; end $$;
reset role;
select 'H15 old rows kept in DB: ' || count(*) from shift_handover_items;
select 'R15 audit logged: ' || (count(*) > 0) from audit_log where table_name in ('inventory_items', 'shift_handover_items');
select 'REPORTS DONE';
