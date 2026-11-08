-- =====================================================================
-- 34: صفة «صيدلاني ممارس» لمدير البرنامج (بطلب صاحب المشروع 2026/11/8)
--   - قيمة جديدة في user_role: practicing_pharmacist. صفة فقط: لا تُعطى صلاحيات بذاتها ولا تظهر
--     في اختيار الأدوار للمستخدمين الآخرين.
--   - مدير البرنامج يصبح دوره المسجّل «صيدلاني ممارس»، فيخرج من قائمة أطباء الاختصاص
--     (اختيار الطبيب المختص للمريض، واعتماد الخطط والبروتوكولات كطبيب اختصاص مسجّل).
--   - تبقى صلاحياته كلها: هو مدير (is_admin)، ويتنقل بين الأدوار بـ acting_role كما كان،
--     وإن لم يختر دوراً يعمل بصلاحيات طبيب الاختصاص كما كان قبل التغيير.
--   يُشغَّل على مرحلتين (القيمة الجديدة في enum لا تُستعمل في المعاملة نفسها التي أُضيفت فيها).
-- =====================================================================

-- المرحلة 1
alter type public.user_role add value if not exists 'practicing_pharmacist';

-- المرحلة 2 (تُشغَّل بعد المرحلة 1 في معاملة منفصلة)
create or replace function public._effective_role(p profiles) returns user_role
language sql stable set search_path = public as $$
  select case
    when p.is_admin and p.acting_role is not null then p.acting_role
    when p.is_admin and p.role = 'practicing_pharmacist' then 'specialist'::user_role
    when p.role = 'clinical_pharmacist' and p.is_deputy and p.deputy_active then 'chief_clinical_pharmacist'::user_role
    else p.role end
$$;

-- «صيدلاني ممارس» صفة المدير فقط: لا يُسنَد لمستخدم آخر من لوحة الإدارة أو أكواد التفعيل
create or replace function public._forbid_title_role() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role = 'practicing_pharmacist' and not new.is_admin then
    raise exception 'صفة «صيدلاني ممارس» خاصة بمدير البرنامج';
  end if;
  return new;
end $$;
drop trigger if exists forbid_title_role on public.profiles;
create trigger forbid_title_role before insert or update of role, is_admin on public.profiles
  for each row execute function public._forbid_title_role();

update public.profiles set role = 'practicing_pharmacist'
 where is_admin and role = 'specialist'
   and not exists (select 1 from patients x where x.specialist_id = profiles.id);
