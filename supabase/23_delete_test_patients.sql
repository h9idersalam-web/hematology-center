-- =====================================================================
--  23: حذف المرضى التجريبيين الخمسة نهائياً (لمرة واحدة، بموافقة صاحب المشروع)
--
--  استثناء صريح من قاعدة «لا حذف»: كل المرضى الحاليين بيانات تجريبية.
--  الحماية:
--   - لا يُحذف شيء إلا إذا كان في القاعدة هؤلاء الخمسة بالضبط (بأرقام ملفاتهم) ولا مريض غيرهم؛
--     وإلا يتوقف الملف كاملاً دون أي تغيير.
--   - يُرفع منع الحذف عن الجداول الطبية داخل هذه المعاملة فقط، ويُعاد في نهايتها.
--   - قوادح سجل التعديلات تبقى تعمل: كل صف محذوف يُسجَّل، مع سطر ملخص للعملية.
--  لا يمسّ البروتوكولات ولا المستخدمين ولا أكواد التفعيل.
--  ملفات الصور في التخزين (patients/...) لا تُحذف بـ SQL؛ تُحذف من Supabase › Storage.
-- =====================================================================

begin;

do $$
declare
  v_expected text[] := array['HEM-2026-0001', 'HEM-2026-0002', 'HEM-2026-0003', 'HEM-2026-0004', 'HEM-2026-0005'];
  v_found text[];
  v_counts jsonb;
  t text;
begin
  select coalesce(array_agg(file_no order by file_no), '{}') into v_found from public.patients;
  if v_found <> v_expected then
    raise exception 'توقّف: المرضى في القاعدة ليسوا الخمسة التجريبيين المتوقعين. الموجود: %', v_found;
  end if;

  -- ما سيُحذف (يُحفظ في سجل التعديلات)
  select jsonb_build_object(
    'patients', (select count(*) from public.patients), 'treatments', (select count(*) from public.treatments),
    'cycles', (select count(*) from public.cycles), 'cycle_doses', (select count(*) from public.cycle_doses),
    'change_requests', (select count(*) from public.change_requests), 'change_request_items', (select count(*) from public.change_request_items),
    'mixing_orders', (select count(*) from public.mixing_orders), 'mixing_items', (select count(*) from public.mixing_items),
    'administrations', (select count(*) from public.administrations), 'lab_results', (select count(*) from public.lab_results),
    'attachments', (select count(*) from public.attachments)) into v_counts;
  insert into public.audit_log(actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (null, null, 'DELETE_TEST_DATA', 'patients', null, jsonb_build_object('file_nos', v_found),
          jsonb_build_object('reason', 'حذف المرضى التجريبيين بموافقة صاحب المشروع', 'counts', v_counts));

  -- رفع منع الحذف مؤقتاً (داخل هذه المعاملة)
  foreach t in array array['administrations', 'mixing_items', 'mixing_orders', 'change_request_items', 'change_requests',
                           'lab_results', 'cycle_doses', 'cycles', 'treatments', 'attachments', 'patients'] loop
    execute format('alter table public.%I disable trigger no_delete_%s', t, t);
  end loop;

  -- الحذف بترتيب الارتباطات
  delete from public.administrations;
  delete from public.mixing_items;
  delete from public.mixing_orders;
  delete from public.change_request_items;
  delete from public.change_requests;
  delete from public.lab_results;
  delete from public.cycle_doses;
  delete from public.cycles;
  delete from public.treatments;
  delete from public.attachments;
  delete from public.patients;
  -- إشعارات كانت تشير إلى ما حُذف
  delete from public.notifications
   where link_type in ('patient', 'treatment', 'cycle', 'change_request', 'mixing_order', 'lab_result');

  -- إعادة منع الحذف
  foreach t in array array['administrations', 'mixing_items', 'mixing_orders', 'change_request_items', 'change_requests',
                           'lab_results', 'cycle_doses', 'cycles', 'treatments', 'attachments', 'patients'] loop
    execute format('alter table public.%I enable trigger no_delete_%s', t, t);
  end loop;

  -- ترقيم الملفات يبدأ من جديد: أول مريض حقيقي HEM-2026-0001
  perform setval('public.patient_file_seq', 1, false);
end $$;

commit;
