-- =====================================================================
--  31: بروتوكول BR من ملف مركز الناصرية (br_protocol.pdf)
--  غير معتمد، بلا معلومات تسريب. لا يكرر بروتوكولاً موجوداً بالاسم نفسه.
-- =====================================================================
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$BR$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$BR$q$, $q$لمفوما لاهودجكن منخفضة الدرجة CD20+ (علاج أولي أو منتكسة)$q$, $q$iv$q$, 28, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (BR protocol). كل 28 يوماً، 6 دورات.
قبل Rituximab بـ30 دقيقة: Paracetamol 1000 mg فموياً، وChlorphenamine 10 mg وريدياً، وHydrocortisone 100 mg وريدياً.
ترتيب الإعطاء في اليوم 1: Rituximab أولاً ثم Bendamustine، بقرار صاحب المشروع.
إذا كانت العدلات أقل من 1×10⁹/L أو الصفيحات أقل من 75×10⁹/L فكّر بتأجيل العلاج أسبوعاً.
في اللمفوما منخفضة الدرجة الكتلية: Allopurinol 300 mg مرة يومياً 3 أيام قبل Bendamustine و5–7 أيام بعده. سُجّلت حالات Stevens-Johnson وTEN مع Allopurinol وBendamustine معاً؛ عند الاشتباه يُوقف Bendamustine.
Acyclovir 200 mg ثلاث مرات يومياً طوال العلاج و3 أشهر بعده. Co-trimoxazole 480 mg ثلاث مرات أسبوعياً طوال العلاج و3 أشهر بعده.
Rituximab: خطر متلازمة تحرر السيتوكينات الشديدة.
Bendamustine: دم مُشعّع لكل عمليات نقل الدم مستقبلاً.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Bendamustine$q$, 90, $q$mg/m2$q$, $q$IV$q$, $q$1,2$q$, null, true, $q$ترتيب الإعطاء: 2 (بعد Rituximab)$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, $q$ترتيب الإعطاء: 1 (أولاً)؛ الأدوية المسبقة قبله بـ30 دقيقة$q$, null, 1);
end $do$;
