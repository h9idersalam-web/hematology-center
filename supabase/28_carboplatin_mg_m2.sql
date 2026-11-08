-- =====================================================================
--  28: إعادة بروتوكولات Carboplatin المؤرشفة (TEC، Pola-R-ICE، Pembro-ICE المجزأ)
--  بقرار صاحب المشروع: Carboplatin في كل ملفات المركز 400 ملغ/م² (بحد أعلى 800 ملغ كما في الملفات).
--  يُنشأ كل بروتوكول من جديد باسمه الأصلي، غير معتمد، بأدوية النسخة المؤرشفة نفسها،
--  ولا يتغير إلا سطر Carboplatin وفقرة AUC في الملاحظات. النسخ المؤرشفة تبقى كما هي.
--  لا يكرر بروتوكولاً موجوداً بالاسم نفسه.
-- =====================================================================
do $do$
declare
  r record; v uuid;
  pairs text[][] := array[
    array['TEC (AUC ملغى 2026-11-07 02:04)', 'TEC'],
    array['Pola-R-ICE (AUC ملغى 2026-11-07 02:04)', 'Pola-R-ICE'],
    array['Pembro-ICE (مجزأ) (AUC ملغى 2026-11-07 02:04)', 'Pembro-ICE (مجزأ)']];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    select * into r from public.protocols where name = pairs[i][1];
    if r.id is null or exists (select 1 from public.protocols where name = pairs[i][2]) then continue; end if;
    insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
    values (pairs[i][2], r.disease, r.kind, r.cycle_length_days, r.total_cycles,
            regexp_replace(regexp_replace(r.notes,
              'Carboplatin بجرعة AUC:[^\n]*', 'Carboplatin 400 ملغ/م² بحد أعلى 800 ملغ، بقرار صاحب المشروع لكل ملفات المركز (بدل 5 AUC في الملف).'),
              '\nأُرشف:[^\n]*$', ''))
    returning id into v;
    insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
    select v, d.drug_name,
           case when d.drug_name = 'Carboplatin' then 400 else d.dose_value end,
           case when d.drug_name = 'Carboplatin' then 'mg/m2' else d.dose_unit end,
           d.route, d.days,
           case when d.drug_name = 'Carboplatin' then 800 else d.max_dose end,
           d.is_mixed, d.instructions, d.cycles, d.sort
      from public.protocol_drugs d where d.protocol_id = r.id order by d.sort;
  end loop;
end $do$;
