-- =====================================================================
--  29: تصحيحات صاحب المشروع على TEC وPembro-ICE (مجزأ) قبل الاعتماد
--   - TEC: Bendamustine يحدده الطبيب بين 60 و120 ملغ/م²؛ الافتراضي الأشيع 70 ملغ/م².
--   - TEC: دورتان، بينهما 21 يوماً.
--   - Pembro-ICE (مجزأ): 6 دورات.
--  على البروتوكولات غير المعتمدة فقط.
-- =====================================================================
update public.protocol_drugs d
   set dose_value = 70,
       instructions = 'يحدد الطبيب الجرعة بين 60 و120 ملغ/م²؛ الأشيع 70 ملغ/م²'
  from public.protocols p
 where p.id = d.protocol_id and p.name = 'TEC' and p.approved_at is null and d.drug_name = 'Bendamustine';

update public.protocols
   set total_cycles = 2, cycle_length_days = 21,
       notes = regexp_replace(regexp_replace(notes,
         '⚠ الملف يكتب Bendamustine[^\n]*', 'Bendamustine يحدده الطبيب بين 60 و120 ملغ/م² (المدى في الملف)؛ أُدخل الأشيع 70 ملغ/م² بقرار صاحب المشروع.'),
         '⚠ الملف لا يذكر طول الدورة ولا عددها[^\n]*', 'دورتان بينهما 21 يوماً، بقرار صاحب المشروع.')
 where name = 'TEC' and approved_at is null;

update public.protocols
   set total_cycles = 6,
       notes = regexp_replace(notes, '⚠ عدد الدورات غير مذكور نصاً[^\n]*', '6 دورات، بقرار صاحب المشروع.')
 where name = 'Pembro-ICE (مجزأ)' and approved_at is null;
