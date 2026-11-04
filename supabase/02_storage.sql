-- =====================================================================
--  الخطوة 1 (ب): حاوية الملفات الخاصة بالمرضى
--  صور التحاليل، ملف التعريف، الوصفة الطبية، ملفات البروتوكولات
--  الحاوية خاصة: لا رابط عام، ولا يفتح الملف إلا مستخدم مفعّل.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-files', 'patient-files', false, 10485760,   -- 10 ميغابايت للملف
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- القراءة: كل مستخدم مفعّل
drop policy if exists "patient files read" on storage.objects;
create policy "patient files read" on storage.objects for select to authenticated
  using (bucket_id = 'patient-files' and public.is_active_user());

-- الرفع: كل الأدوار عدا الطبيب الدوري، وفي مجلد المريض أو البروتوكولات فقط
drop policy if exists "patient files upload" on storage.objects;
create policy "patient files upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'patient-files'
    and public.has_role('specialist', 'senior_resident', 'clinical_pharmacist',
                        'chief_clinical_pharmacist', 'mixing_pharmacist', 'nurse')
    and (storage.foldername(name))[1] in ('patients', 'protocols')
  );

-- لا سياسة للتعديل أو الحذف: الملف المرفوع يبقى كما هو.
