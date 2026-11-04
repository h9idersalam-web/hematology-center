-- =====================================================================
--  ملف مرجعي (PDF أو صورة) لكل بروتوكول
--  يُشغَّل بعد الملف 07. آمن للتشغيل أكثر من مرة.
--  - يرفع الملف من يضيف البروتوكولات، إلى protocols/<معرّف البروتوكول>/
--  - استبدال ملف بروتوكول معتمد لطبيب الاختصاص فقط، لأن الاعتماد بُني عليه
--  - كل تغيير يُسجَّل تلقائياً في سجل التعديلات، والملف القديم يبقى في التخزين
-- =====================================================================

create or replace function public.set_protocol_file(p_id uuid, p_file_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_p protocols; v_role user_role;
begin
  perform require_role('specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist');
  v_role := my_role();
  select * into v_p from protocols where id = p_id;
  if v_p.id is null or v_p.archived_at is not null then raise exception 'البروتوكول غير موجود أو مؤرشف'; end if;
  if p_file_path is null or p_file_path not like 'protocols/' || p_id::text || '/%' then
    raise exception 'مسار الملف غير صحيح';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'patient-files' and name = p_file_path) then
    raise exception 'لم يُرفع الملف بعد';
  end if;
  if v_role <> 'specialist' and v_p.approved_by is not null and v_p.file_path is not null then
    raise exception 'استبدال ملف بروتوكول معتمد لطبيب الاختصاص فقط';
  end if;

  update protocols set file_path = p_file_path where id = p_id;

  if v_role <> 'specialist' then
    perform _notify_roles(array['specialist']::user_role[], 'protocol',
                          'أُرفق ملف مرجعي لبروتوكول ' || v_p.name,
                          case when v_p.approved_by is null then 'راجعه قبل الاعتماد' else 'راجعه مقابل الأدوية المعتمدة' end,
                          'protocol', p_id);
  end if;
end $$;

revoke all on function public.set_protocol_file(uuid, text) from public, anon;
grant execute on function public.set_protocol_file(uuid, text) to authenticated;
