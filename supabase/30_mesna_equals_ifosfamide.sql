-- =====================================================================
--  30: قاعدة صاحب المشروع: جرعة Mesna مساوية لجرعة Ifosfamide (1:1)
--  على البروتوكولات غير المعتمدة وغير المؤرشفة فقط (ICE وICE (مجزأ) معتمدان وهما 1:1 أصلاً).
--   - Pembro-ICE (مجزأ) وPola-R-ICE: فيهما جرعات Mesna زائدة (قبل Ifosfamide وبعده). أسطر البروتوكول
--     لا تُحذف، فتُؤرشف النسخة الحالية باسم معدّل وتُنشأ نسخة مصححة بالاسم الأصلي: Mesna واحدة = Ifosfamide.
--   - R-CODOX-M / R-IVAC: Mesna أصلاً = Ifosfamide؛ تُحذف من تعليمتها الجرعات الإضافية.
--   - IBER: لم تكن فيه Mesna؛ يُضاف سطرها = Ifosfamide.
-- =====================================================================
do $do$
declare old record; v uuid; nm text;
begin
  foreach nm in array array['Pembro-ICE (مجزأ)', 'Pola-R-ICE'] loop
    select * into old from public.protocols where name = nm and approved_at is null and archived_at is null;
    if old.id is null then continue; end if;
    if not exists (select 1 from public.protocol_drugs where protocol_id = old.id and drug_name = 'Mesna'
                     and dose_value <> (select dose_value from public.protocol_drugs where protocol_id = old.id and drug_name = 'Ifosfamide' limit 1)) then continue; end if;
    update public.protocols set name = name || ' (Mesna قديم 2026-11-08)', archived_at = now() where id = old.id;
    insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
    values (nm, old.disease, old.kind, old.cycle_length_days, old.total_cycles,
            case when old.notes ~ 'Mesna في الأيام[^\n]*'
                 then regexp_replace(old.notes, 'Mesna في الأيام[^\n]*', 'Mesna مساوية لجرعة Ifosfamide (1:1)، بقرار صاحب المشروع.')
                 else old.notes || E'\nMesna مساوية لجرعة Ifosfamide (1:1)، بقرار صاحب المشروع.' end)
    returning id into v;
    insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
    select v, d.drug_name,
           case when d.drug_name = 'Mesna' then i.dose_value else d.dose_value end,
           case when d.drug_name = 'Mesna' then i.dose_unit else d.dose_unit end,
           case when d.drug_name = 'Mesna' then 'IV' else d.route end,
           case when d.drug_name = 'Mesna' then i.days else d.days end,
           d.max_dose, d.is_mixed,
           case when d.drug_name = 'Mesna' then (case when d.instructions like 'مرتين%' then 'مرتين، مع Ifosfamide (1:1)' else 'مع Ifosfamide (1:1)' end) else d.instructions end,
           d.cycles, d.sort
      from public.protocol_drugs d
      cross join lateral (select dose_value, dose_unit, days from public.protocol_drugs where protocol_id = old.id and drug_name = 'Ifosfamide' limit 1) i
     where d.protocol_id = old.id and (d.drug_name <> 'Mesna' or d.instructions like '%مع Ifosfamide%')
     order by d.sort;
  end loop;
end $do$;

-- R-CODOX-M / R-IVAC: Mesna = Ifosfamide أصلاً؛ تُزال الجرعات الإضافية من التعليمة
update public.protocol_drugs d set instructions = 'مع Ifosfamide (1:1)'
  from public.protocols p
 where p.id = d.protocol_id and p.name = 'R-CODOX-M / R-IVAC (خطورة عالية)' and p.approved_at is null
   and d.drug_name = 'Mesna' and d.instructions like 'مع Ifosfamide؛%';

-- IBER: إضافة Mesna = Ifosfamide (3500 ملغ/م² اليوم 2)
do $do$
declare p uuid;
begin
  select id into p from public.protocols where name = 'IBER' and approved_at is null and archived_at is null;
  if p is null or exists (select 1 from public.protocol_drugs where protocol_id = p and drug_name = 'Mesna') then return; end if;
  update public.protocol_drugs set sort = sort + 1 where protocol_id = p and sort > 4;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  select p, 'Mesna', dose_value, dose_unit, 'IV', days, null, false, 'مع Ifosfamide (1:1)', cycles, 5
    from public.protocol_drugs where protocol_id = p and drug_name = 'Ifosfamide' limit 1;
  update public.protocols set notes = regexp_replace(notes, '⚠ الملف لا يذكر Mesna[^\n]*', 'Mesna مساوية لجرعة Ifosfamide (1:1)، بقرار صاحب المشروع.') where id = p;
end $do$;
