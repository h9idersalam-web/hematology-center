-- =====================================================================
--  الخطوة 1 (ج): بروتوكولات أولية للمكتبة
--  تُضاف «غير معتمدة». لا تُستخدم لأي مريض قبل أن يراجعها طبيب اختصاص
--  ويطابقها مع بروتوكولات المركز ثم يضغط «اعتماد».
--  مرجع المراجعة المجاني: eviQ (eviq.org.au) و BC Cancer (bccancer.bc.ca)
-- =====================================================================

do $$
declare v uuid;
begin
  -- R-CHOP-21 · لمفوما الخلايا البائية الكبيرة المنتشرة
  insert into protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ('R-CHOP-21', 'لمفوما لاهودجكينية (الخلايا البائية الكبيرة المنتشرة)', 'mixed', 21, 6,
          'فحص التهاب الكبد B قبل ريتوكسيماب. تخطيط صدى القلب قبل دوكسوروبيسين. سقف فينكريستين 2 ملغ.')
  on conflict (name) do nothing returning id into v;
  if v is not null then
    insert into protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, sort) values
      (v, 'Rituximab',        375, 'mg/m2', 'IV', '1',   null, true, 1),
      (v, 'Cyclophosphamide', 750, 'mg/m2', 'IV', '1',   null, true, 2),
      (v, 'Doxorubicin',       50, 'mg/m2', 'IV', '1',   null, true, 3),
      (v, 'Vincristine',      1.4, 'mg/m2', 'IV', '1',   2,    true, 4),
      (v, 'Prednisone',       100, 'mg',    'PO', '1-5', null, false, 5);
  end if;

  -- ABVD · لمفوما هودجكن
  v := null;
  insert into protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ('ABVD', 'لمفوما هودجكن', 'iv', 28, 6,
          'تُعطى في اليومين 1 و15 من كل 28 يوماً. فحص وظائف الرئة قبل بليومايسين.')
  on conflict (name) do nothing returning id into v;
  if v is not null then
    insert into protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, sort) values
      (v, 'Doxorubicin',  25,  'mg/m2',    'IV', '1,15', null, true, 1),
      (v, 'Bleomycin',    10,  'units/m2', 'IV', '1,15', null, true, 2),
      (v, 'Vinblastine',   6,  'mg/m2',    'IV', '1,15', null, true, 3),
      (v, 'Dacarbazine', 375,  'mg/m2',    'IV', '1,15', null, true, 4);
  end if;

  -- VRd · الورم النقوي المتعدد
  v := null;
  insert into protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ('VRd', 'الورم النقوي المتعدد', 'mixed', 21, 8,
          'بورتيزوميب تحت الجلد في الأيام 1 و4 و8 و11. يُعدَّل ليناليدومايد حسب تصفية الكرياتينين. وقاية من الخثار.')
  on conflict (name) do nothing returning id into v;
  if v is not null then
    insert into protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, sort) values
      (v, 'Bortezomib',    1.3, 'mg/m2', 'SC', '1,4,8,11',             null, true,  1),
      (v, 'Lenalidomide',   25, 'mg',    'PO', '1-14',                 null, false, 2),
      (v, 'Dexamethasone',  20, 'mg',    'PO', '1,2,4,5,8,9,11,12',    null, false, 3);
  end if;

  -- Imatinib · ابيضاض نقوي مزمن (مراجعة شهرية)
  v := null;
  insert into protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ('Imatinib', 'ابيضاض نقوي مزمن (الطور المزمن)', 'oral', 28, 12,
          'علاج يومي مستمر. الدورة هنا موعد مراجعة وصرف شهري.')
  on conflict (name) do nothing returning id into v;
  if v is not null then
    insert into protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, sort) values
      (v, 'Imatinib', 400, 'mg', 'PO', '1-28', null, false, 1);
  end if;

  -- Hydroxyurea · فقر الدم المنجلي (مراجعة شهرية)
  v := null;
  insert into protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ('Hydroxyurea', 'فقر الدم المنجلي', 'oral', 28, 12,
          'جرعة البدء 15 ملغ/كغ يومياً، وتُعدَّل حسب تعداد الدم حتى 35 ملغ/كغ يومياً كحد أعلى.')
  on conflict (name) do nothing returning id into v;
  if v is not null then
    insert into protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, sort) values
      (v, 'Hydroxyurea', 15, 'mg/kg', 'PO', '1-28', null, false, 1);
  end if;
end $$;
