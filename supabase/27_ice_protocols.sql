-- =====================================================================
--  27: بروتوكولا ICE من ملفات مركز الناصرية (ice_protocol.pdf و fractionated_ICE_.pdf)
--  بقيم صاحب المشروع: Carboplatin 400 ملغ/م² بحد أعلى 800 ملغ (لا AUC)،
--  Ifosfamide 1666 ملغ/م² الأيام 1–3، Mesna 1666 ملغ/م² مع Ifosfamide.
--  يُدخلان غير معتمدين، بلا معلومات تسريب. لا يكرر بروتوكولاً موجوداً بالاسم نفسه.
-- =====================================================================

-- ICE (مجزأ)  (الملف: ice_protocol)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$ICE (مجزأ)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$ICE (مجزأ)$q$, $q$لمفوما لاهودجكن ولمفوما هودجكن (NHL / HL)$q$, $q$iv$q$, 21, 3, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (CARBOPLATIN-ETOPOSIDE-IFOSFAMIDE (ICE); fractionated protocol). كل 21 يوماً، 2 إلى 3 دورات.
Carboplatin بالملغ/م² (400 ملغ/م² بحد أعلى 800 ملغ) بقرار صاحب المشروع بدل «5 AUC» في الملف.
الملف يكتب Ifosfamide «1.666 mg/m²»؛ أُدخلت 1666 ملغ/م² يومياً بتأكيد صاحب المشروع. جرعة Mesna في الملف «***»؛ أُدخلت 1666 ملغ/م² مع Ifosfamide.
ترتيب الإعطاء: Etoposide ثم Carboplatin ثم Ifosfamide مع Mesna.
Filgrastim 5 ميكروغرام/كغ تحت الجلد من اليوم 4 يومياً حتى تعافي العدلات. لم يُدخل سطراً لأن التطبيق لا يدعم وحدة الميكروغرام.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 100, $q$mg/m2$q$, $q$IV$q$, $q$1-3$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Carboplatin$q$, 400, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, 800, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Ifosfamide$q$, 1666, $q$mg/m2$q$, $q$IV$q$, $q$1-3$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mesna$q$, 1666, $q$mg/m2$q$, $q$IV$q$, $q$1-3$q$, null, false, $q$مع Ifosfamide$q$, null, 4);
end $do$;

-- ICE  (الملف: fractionated_ICE_ ، عنوانه «ICE 21 DAYS CYCLE» بست دورات)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$ICE$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$ICE$q$, $q$لمفوما هودجكن ولمفوما لاهودجكن (HL / NHL)$q$, $q$iv$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (CARBOPLATIN-ETOPOSIDE-IFOSFAMIDE (ICE) 21 DAYS CYCLE). كل 21 يوماً، 6 دورات.
Carboplatin بالملغ/م² (400 ملغ/م² بحد أعلى 800 ملغ) بقرار صاحب المشروع بدل «5 AUC» في الملف؛ في اليوم 2 كما في الملف.
الملف يكتب Ifosfamide «1.666 mg/m²»؛ أُدخلت 1666 ملغ/م² يومياً بتأكيد صاحب المشروع. جرعة Mesna في الملف «***»؛ أُدخلت 1666 ملغ/م² مع Ifosfamide.
الصف الأول في جدول الملف بلا اسم دواء (IV في اليوم 1)؛ لم يُدخل بقرار صاحب المشروع.
ترتيب الإعطاء: Etoposide ثم Carboplatin ثم Ifosfamide مع Mesna.
Filgrastim 5 ميكروغرام/كغ تحت الجلد من اليوم 4 يومياً حتى تعافي العدلات. لم يُدخل سطراً لأن التطبيق لا يدعم وحدة الميكروغرام.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 100, $q$mg/m2$q$, $q$IV$q$, $q$1-3$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Carboplatin$q$, 400, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, 800, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Ifosfamide$q$, 1666, $q$mg/m2$q$, $q$IV$q$, $q$1-3$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mesna$q$, 1666, $q$mg/m2$q$, $q$IV$q$, $q$1-3$q$, null, false, $q$مع Ifosfamide$q$, null, 4);
end $do$;
