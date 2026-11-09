-- =====================================================================
-- 45: حذف مريض أُدخل بالخطأ حذفاً نهائياً: لمدير البرنامج حصراً (بطلب صاحب المشروع 2026/11/9)
--   - يُحذف المريض وكل ما يتعلق به: الخطط والـCycles والجرعات الدوائية والإعطاء وتأكيدات الأيام،
--     والمزج، وطلبات التعديل، والتحاليل، والمرفقات، وإشعاراته.
--   - سبب إلزامي، ويُحفظ ملخص الحذف في سجل التعديلات (ويحفظ مشغّل التدقيق نسخة كل صف محذوف).
--   - استثناء محصور من منع الحذف: forbid_delete يسمح فقط داخل هذه الدالة (إعداد مؤقت للمعاملة نفسها).
--   - ملفات المريض في التخزين (patients/<id>/) تحذفها الواجهة بعد نجاح الحذف، والسياسة تسمح بذلك
--     للمدير فقط وبعد أن يختفي المريض من القاعدة.
--   لا أوامر drop.
-- =====================================================================
create or replace function public.forbid_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name in ('protocols', 'protocol_drugs') and current_setting('hc.allow_protocol_delete', true) = 'on' then
    return old;
  end if;
  if current_setting('hc.allow_patient_delete', true) = 'on' and tg_table_name in
     ('patients', 'treatments', 'cycles', 'cycle_doses', 'attachments', 'lab_results', 'change_requests',
      'change_request_items', 'mixing_orders', 'mixing_items', 'administrations', 'cycle_day_completions') then
    return old;
  end if;
  raise exception 'الحذف غير مسموح، استخدم الأرشفة مع ذكر السبب';
end $$;

create or replace function public.admin_delete_patient(p_patient uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p patients; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
        v_tids uuid[]; v_cids uuid[]; v_dids uuid[]; v_oids uuid[]; v_rids uuid[]; v_aids uuid[]; v_lids uuid[];
        v_links uuid[]; v_files text[]; v_counts jsonb;
begin
  perform _require_admin();
  if v_reason is null then raise exception 'اكتب سبب الحذف'; end if;
  select * into v_p from patients where id = p_patient for update;
  if v_p.id is null then raise exception 'المريض غير موجود'; end if;

  select array_agg(id) into v_tids from treatments where patient_id = p_patient;
  select array_agg(id) into v_cids from cycles where treatment_id = any(coalesce(v_tids, '{}'));
  select array_agg(id) into v_dids from cycle_doses where cycle_id = any(coalesce(v_cids, '{}'));
  select array_agg(id) into v_oids from mixing_orders where patient_id = p_patient or cycle_id = any(coalesce(v_cids, '{}'));
  select array_agg(id) into v_rids from change_requests where patient_id = p_patient or treatment_id = any(coalesce(v_tids, '{}'));
  select array_agg(id), array_agg(file_path) into v_aids, v_files from attachments where patient_id = p_patient;
  select array_agg(id) into v_lids from lab_results where patient_id = p_patient;

  v_counts := jsonb_build_object(
    'treatments', coalesce(cardinality(v_tids), 0), 'cycles', coalesce(cardinality(v_cids), 0),
    'doses', coalesce(cardinality(v_dids), 0), 'mixing_orders', coalesce(cardinality(v_oids), 0),
    'change_requests', coalesce(cardinality(v_rids), 0), 'attachments', coalesce(cardinality(v_aids), 0),
    'lab_results', coalesce(cardinality(v_lids), 0),
    'administrations', (select count(*) from administrations where patient_id = p_patient));

  insert into audit_log(actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), my_role(), 'PATIENT_DELETED', 'patients', p_patient::text, to_jsonb(v_p),
          jsonb_build_object('reason', v_reason, 'counts', v_counts));

  perform set_config('hc.allow_patient_delete', 'on', true);
  delete from change_request_items where request_id = any(coalesce(v_rids, '{}')) or target_dose_id = any(coalesce(v_dids, '{}'));
  delete from mixing_items where order_id = any(coalesce(v_oids, '{}')) or cycle_dose_id = any(coalesce(v_dids, '{}'));
  delete from administrations where patient_id = p_patient or cycle_dose_id = any(coalesce(v_dids, '{}'));
  delete from cycle_day_completions where cycle_id = any(coalesce(v_cids, '{}'));
  delete from lab_results where id = any(coalesce(v_lids, '{}'));
  delete from change_requests where id = any(coalesce(v_rids, '{}'));
  delete from mixing_orders where id = any(coalesce(v_oids, '{}'));
  delete from cycle_doses where id = any(coalesce(v_dids, '{}'));
  delete from cycles where id = any(coalesce(v_cids, '{}'));
  delete from treatments where id = any(coalesce(v_tids, '{}'));
  delete from attachments where id = any(coalesce(v_aids, '{}'));
  delete from patients where id = p_patient;
  perform set_config('hc.allow_patient_delete', 'off', true);

  -- إشعاراته (روابط إلى المريض أو خططه أو الـCycles أو المزج أو الطلبات أو التحاليل)
  v_links := array[p_patient] || coalesce(v_tids, '{}') || coalesce(v_cids, '{}') || coalesce(v_oids, '{}')
             || coalesce(v_rids, '{}') || coalesce(v_lids, '{}');
  delete from notifications where link_id = any(v_links);

  return jsonb_build_object('counts', v_counts, 'files', coalesce(to_jsonb(v_files), '[]'::jsonb));
end $$;
revoke all on function public.admin_delete_patient(uuid, text) from public, anon;
grant execute on function public.admin_delete_patient(uuid, text) to authenticated;

-- ملفات المريض المحذوف في التخزين: للمدير فقط، وبعد أن يختفي المريض من القاعدة
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'admin removes deleted patient files') then
    create policy "admin removes deleted patient files" on storage.objects for delete to authenticated
      using (bucket_id = 'patient-files' and public.is_admin() and name like 'patients/%'
             and not exists (select 1 from public.patients p where p.id::text = split_part(name, '/', 2)));
  end if;
end $$;
