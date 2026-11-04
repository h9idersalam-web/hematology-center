-- =====================================================================
--  بروتوكولات مركز الناصرية لأمراض الدم من ملفات المركز نفسها (ملف PDF لكل بروتوكول)
--  تُدخل «غير معتمدة»: لا تُستخدم لأي مريض قبل أن يراجعها طبيب الاختصاص ويعتمدها.
--  الجرعات للإعطاء الواحد؛ التكرار في اليوم في عمود instructions. لا محلول ولا مدة تسريب (لقسم المزج).
--  cycles: الدورات التي يُعطى فيها الدواء (null = كلها).
--  يُشغَّل بعد الملف 10. لا يكرر بروتوكولاً موجوداً بالاسم نفسه.
-- =====================================================================

-- المسودات الأولية القديمة بالأسماء نفسها (غير معتمدة ولم تُستخدم) تُؤرشف ويُغيَّر اسمها لتحل محلها نسخ المركز
update public.protocols set name = name || ' (مسودة قديمة)', archived_at = now()
 where name in ('R-CHOP-21', 'ABVD', 'VRd') and approved_at is null
   and coalesce(notes, '') not like '%الناصرية%'
   and not exists (select 1 from public.treatments t where t.protocol_id = protocols.id);

-- R-CHOP-21  (الملف: r_chop_with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$R-CHOP-21$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$R-CHOP-21$q$, $q$لمفوما الخلايا البائية الكبيرة المنتشرة (DLBCL) / لمفوما خلايا الوشاح$q$, $q$mixed$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (R-CHOP). عادة 6 دورات للمرحلة المتقدمة.
⚠ الملف يكتب Prednisolone «40 mg/m² (100 mg)». أُدخلت 40 ملغ/م² بسقف 100 ملغ؛ إن كان المقصود 100 ملغ ثابتة فعدّلها قبل الاعتماد.
قبل Rituximab بـ30 دقيقة على الأقل: Paracetamol 1000 mg وChlorphenamine 10–50 mg.
يُراقب المريض 30 دقيقة بعد بدء Rituximab قبل بقية الأدوية.
يمكن استعمال Dexamethasone بدل Prednisolone عند إصابة الجهاز العصبي المركزي المؤكدة أو المشتبهة، أو حسب الاستشاري.
إماهة كافية قبل كل دورة وبعدها؛ في المرض الكتلي إماهة مسبقة بلتر NaCl 0.9% خلال 4–6 ساعات.
الوقاية حسب الوصفة: مضادات الفطريات والفيروسات، وقاية PJP، وقاية متلازمة انحلال الورم، ملين.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Prednisolone$q$, 40, $q$mg/m2$q$, $q$PO$q$, $q$1-5$q$, 100, false, $q$صباحاً مع الطعام؛ في اليوم 1 قبل Rituximab بـ30 دقيقة على الأقل$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 50, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.2, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, 2, true, $q$فوق 70 سنة: يُنظر في سقف 1 ملغ$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 750, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 5);
end $do$;

-- VRd  (الملف: VRD)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$VRd$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$VRd$q$, $q$الورم النقوي المتعدد حديث التشخيص$q$, $q$mixed$q$, 21, 8, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (VRD). 8 دورات كل 21 يوماً.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Bortezomib$q$, 1.3, $q$mg/m2$q$, $q$SC$q$, $q$1,4,8,11$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Lenalidomide$q$, 25, $q$mg$q$, $q$PO$q$, $q$1-14$q$, null, false, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 20, $q$mg$q$, $q$PO$q$, $q$1,2,4,5,8,9,11,12$q$, null, false, $q$فموي أو وريدي$q$, null, 3);
end $do$;

-- R-DHAOx  (الملف: R_dhax_with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$R-DHAOx$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$R-DHAOx$q$, $q$لمفوما الخلايا البائية الكبيرة المنتشرة (DLBCL) المنتكسة أو المقاومة (لمفوما بائية)$q$, $q$mixed$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (R-DHAOX). كل 21 يوماً، من 4 إلى 6 دورات؛ أُدخلت 6 وتُوقَف الخطة عند الاكتفاء.
Oxaliplatin قد يسبب خلل الإحساس البلعومي الحنجري (صعوبة تنفس أو بلع) أثناء الإعطاء وحتى 48 ساعة بعده.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Oxaliplatin$q$, 130, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 2000, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, null, true, $q$مرتين في اليوم (بفارق 12 ساعة)$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 40, $q$mg$q$, $q$PO$q$, $q$1-4$q$, null, false, $q$مرة صباحاً مع الطعام أو بعده مباشرة؛ أو وريدياً$q$, null, 4);
end $do$;

-- R-ESHAP  (الملف: R-ESHAP_protocol)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$R-ESHAP$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$R-ESHAP$q$, $q$لمفوما هودجكن أو لاهودجكين المنتكسة أو المقاومة$q$, $q$iv$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (R-ESHAP). كل 21–28 يوماً حسب تعافي التعداد؛ أُدخل 21 يوماً ويُؤجَّل عند الحاجة. 6 دورات في جدول الملف.
إماهة قبل Cisplatin وبعده، ومضادات القيء.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methylprednisolone$q$, 500, $q$mg$q$, $q$IV$q$, $q$1-5$q$, null, false, $q$في اليوم 1 قبل Rituximab بـ30 دقيقة على الأقل$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 40, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cisplatin$q$, 25, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, $q$الجرعة الكلية 100 ملغ/م² على 4 أيام$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 2000, $q$mg/m2$q$, $q$IV$q$, $q$5$q$, null, true, null, null, 5);
end $do$;

-- R-Cladribine أسبوعي (HCL)  (الملف: rituximab-cladribine_weekly_for_HCL)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$R-Cladribine أسبوعي (HCL)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$R-Cladribine أسبوعي (HCL)$q$, $q$ابيضاض الخلايا المشعرة (HCL)$q$, $q$iv$q$, 56, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Cladribine + Rituximab لابيضاض الخلايا المشعرة).
قبل Rituximab بـ30 دقيقة على الأقل: Paracetamol 1000 mg، Hydrocortisone 100 mg، Chlorphenamine 10 mg.
الدورة الواحدة هنا 8 أسابيع تغطي العلاج كاملاً.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cladribine$q$, 0.15, $q$mg/kg$q$, $q$IV$q$, $q$1,8,15,22,29,36$q$, null, true, $q$أسبوعياً، 6 جرعات$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15,22,29,36,43,50$q$, null, true, $q$أسبوعياً، 8 جرعات$q$, null, 2);
end $do$;

-- Pembro-GDP  (الملف: pembro-gdp)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Pembro-GDP$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Pembro-GDP$q$, $q$لمفوما هودجكن المنتكسة أو المقاومة$q$, $q$mixed$q$, 21, 4, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (GDP مع Pembrolizumab). كل 21 يوماً.
⚠ الملف يكتب Pembrolizumab «200 mg/m²»، وملف Pembro-GVD للمركز يكتب 200 ملغ ثابتة، وهي الجرعة المعتمدة دولياً. أُدخلت 200 ملغ ثابتة. تأكد قبل الاعتماد: 200 ملغ/م² تعني نحو 360 ملغ لمريض متوسط.
⚠ عدد الدورات غير مذكور في الملف؛ أُدخل 4.
إماهة Cisplatin (≥ 80 ملغ/م²): لتر قبله ولتر بعده مع البوتاسيوم والمغنيسيوم (المجموع 3 لترات).$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Pembrolizumab$q$, 200, $q$mg$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cisplatin$q$, 100, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Gemcitabine$q$, 1000, $q$mg/m2$q$, $q$IV$q$, $q$1,8$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 20, $q$mg$q$, $q$PO$q$, $q$1-4$q$, null, false, $q$مرة صباحاً مع الطعام أو بعده مباشرة؛ أو وريدياً$q$, null, 4);
end $do$;

-- Pembro-GVD  (الملف: pebmro-gvd)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Pembro-GVD$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Pembro-GVD$q$, $q$لمفوما هودجكن المنتكسة أو المقاومة، خط ثانٍ، فوق 18 سنة$q$, $q$iv$q$, 21, 4, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Pembro-GVD). كل 21 يوماً.
⚠ عدد الدورات غير مذكور في الملف؛ أُدخل 4.
الملفان المرسلان لهذا البروتوكول متطابقان.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Pembrolizumab$q$, 200, $q$mg$q$, $q$IV$q$, $q$1$q$, null, true, $q$يُعطى أولاً$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Gemcitabine$q$, 1000, $q$mg/m2$q$, $q$IV$q$, $q$1,8$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vinorelbine$q$, 20, $q$mg/m2$q$, $q$IV$q$, $q$1,8$q$, null, true, $q$وريدي فقط؛ قاتل بأي طريق آخر$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Liposomal doxorubicin$q$, 15, $q$mg/m2$q$, $q$IV$q$, $q$1,8$q$, null, true, $q$لا يُستبدل بـDoxorubicin العادي؛ الجرعات غير متكافئة$q$, null, 4);
end $do$;

-- Pola-R-CHP  (الملف: pola_r_chip)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Pola-R-CHP$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Pola-R-CHP$q$, $q$DLBCL موجب CD20، خط أول، IPI من 2 إلى 5$q$, $q$mixed$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Pola-R-CHP). من 6 إلى 8 دورات.
⚠ أُدخلت 6 دورات؛ في دراسة POLARIX تُعطى الدورتان 7 و8 Rituximab وحده. أضفهما بخطة Rituximab إن وُصفتا.
Polatuzumab vedotin: إذا حدث تفاعل مع جرعة سابقة، تُعطى Paracetamol وChlorphenamine قبله، ويُراقب المريض 90 دقيقة بعده.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Polatuzumab vedotin$q$, 1.8, $q$mg/kg$q$, $q$IV$q$, $q$1$q$, 240, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 50, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 750, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Prednisolone$q$, 100, $q$mg$q$, $q$PO$q$, $q$1-5$q$, null, false, null, null, 5);
end $do$;

-- Pola-R-GemOx  (الملف: pola_r-gemox)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Pola-R-GemOx$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Pola-R-GemOx$q$, $q$لمفوما الخلايا البائية الكبيرة المنتشرة (DLBCL) المنتكسة أو المقاومة$q$, $q$iv$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Pola-R-GEMOX). 6 دورات بحد أقصى.
قبل العلاج في اليوم 1: Paracetamol 1000 mg فموي، Hydrocortisone 100 mg وريدي، Chlorphenamine 10 mg وريدي.
Polatuzumab vedotin: إذا حدث تفاعل مع جرعة سابقة، تُعطى Paracetamol وChlorphenamine قبله، ويُراقب المريض 90 دقيقة بعده.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Polatuzumab vedotin$q$, 1.8, $q$mg/kg$q$, $q$IV$q$, $q$1$q$, 240, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Gemcitabine$q$, 1000, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Oxaliplatin$q$, 100, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 4);
end $do$;

-- Pola-BR  (الملف: pola-BR)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Pola-BR$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Pola-BR$q$, $q$لمفوما الخلايا البائية الكبيرة المنتشرة (DLBCL) المنتكسة أو المقاومة، غير مرشّح لزرع الخلايا الجذعية$q$, $q$iv$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Pola-BR). 6 دورات بحد أقصى، كل 21 يوماً.
قبل العلاج في اليوم 1: Paracetamol 1000 mg فموي، Hydrocortisone 100 mg وريدي، Chlorphenamine 10 mg وريدي.
Polatuzumab vedotin: إذا حدث تفاعل مع جرعة سابقة، تُعطى Paracetamol وChlorphenamine قبله، ويُراقب المريض 90 دقيقة بعده.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Polatuzumab vedotin$q$, 1.8, $q$mg/kg$q$, $q$IV$q$, $q$1$q$, 240, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Bendamustine$q$, 90, $q$mg/m2$q$, $q$IV$q$, $q$1,2$q$, null, true, null, null, 3);
end $do$;

-- R-CODOX-M / R-IVAC (خطورة عالية)  (الملف: R_CODOX_M-R_IVAC)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$R-CODOX-M / R-IVAC (خطورة عالية)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$R-CODOX-M / R-IVAC (خطورة عالية)$q$, $q$لمفوما بيركت أو الشبيهة بها$q$, $q$iv$q$, 42, 2, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (R-CODOX-M / R-IVAC). الخطورة العالية: R-CODOX-M ثم R-IVAC بالتناوب، 4 دورات.
الدورة هنا 42 يوماً = R-CODOX-M (الأيام 1–21) ثم R-IVAC (الأيام 22–42). دورتان = 4 دورات. الفاصل الفعلي 21–28 يوماً حسب التعداد؛ يُضبط بالتأجيل.
⚠ الملف لا يذكر سقفاً لـVincristine 1.2 ملغ/م²؛ أُضيف سقف 2 ملغ المعتاد. احذفه إن لم يكن مقصوداً.
جرعات R-IVAC في جدول الملف لمن عمره 65 سنة أو أقل.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1,22$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 40, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.2, $q$mg/m2$q$, $q$IV$q$, $q$1,8$q$, 2, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 800, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 200, $q$mg/m2$q$, $q$IV$q$, $q$2-5$q$, null, true, null, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 3000, $q$mg/m2$q$, $q$IV$q$, $q$10$q$, null, true, $q$إماهة قبله وبعده، ثم Folinic acid$q$, null, 6);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 70, $q$mg$q$, $q$IT$q$, $q$2,4$q$, null, true, null, null, 7);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$15$q$, null, true, null, null, 8);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 60, $q$mg/m2$q$, $q$IV$q$, $q$22-26$q$, null, true, null, null, 9);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Ifosfamide$q$, 1500, $q$mg/m2$q$, $q$IV$q$, $q$22-26$q$, null, true, null, null, 10);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mesna$q$, 1500, $q$mg/m2$q$, $q$IV$q$, $q$22-26$q$, null, false, $q$مع Ifosfamide؛ ومعه 300 ملغ/م² قبله و450 ملغ/م² مرتين بعده (جدول الملف)$q$, null, 11);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 2000, $q$mg/m2$q$, $q$IV$q$, $q$22,23$q$, null, true, $q$مرتين يومياً$q$, null, 12);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$26$q$, null, true, null, null, 13);
end $do$;

-- R-CODOX-M ×3 (خطورة منخفضة)  (الملف: R_CODOX_M-R_IVAC)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$R-CODOX-M ×3 (خطورة منخفضة)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$R-CODOX-M ×3 (خطورة منخفضة)$q$, $q$لمفوما بيركت أو الشبيهة بها$q$, $q$iv$q$, 21, 3, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (R-CODOX-M). الخطورة المنخفضة: R-CODOX-M وحده 3 دورات. الفاصل 21–28 يوماً حسب التعداد.
⚠ الملف لا يذكر سقفاً لـVincristine 1.2 ملغ/م²؛ أُضيف سقف 2 ملغ المعتاد. احذفه إن لم يكن مقصوداً.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 40, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.2, $q$mg/m2$q$, $q$IV$q$, $q$1,8$q$, 2, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 800, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 200, $q$mg/m2$q$, $q$IV$q$, $q$2-5$q$, null, true, null, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 3000, $q$mg/m2$q$, $q$IV$q$, $q$10$q$, null, true, $q$إماهة قبله وبعده، ثم Folinic acid$q$, null, 6);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 70, $q$mg$q$, $q$IT$q$, $q$2,4$q$, null, true, null, null, 7);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$15$q$, null, true, null, null, 8);
end $do$;

-- UKALL60+ تحريض وتدعيم (المسار D)  (الملف: ukall_60)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL60+ تحريض وتدعيم (المسار D)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL60+ تحريض وتدعيم (المسار D)$q$, $q$ابيضاض لمفاوي حاد (ALL) سالب Ph: عمر ≥ 60، أو ≥ 55 غير مناسب لتجربة UKALL14 أو HOVON 100$q$, $q$mixed$q$, 28, 3, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL60+، المسار غير المكثف D). الدورات الثلاث هنا: التحريض 1، ثم التحريض 2، ثم التدعيم 1، وجداولها متطابقة في الملف.
لا تبدأ المرحلة التالية إلا عند عدلات > 0.75 وصفيحات > 75 (×10⁹/لتر)؛ أجّل الدورة حتى ذلك.
بزل نقي العظم بعد اليوم 28 عند تعافي التعداد، أو في اليوم 35 إن لم يتعافَ.
⚠ جدول الملف لا يضع علامة لـ6-MP في اليوم 5 في المراحل الثلاث، فأُدخلت الأيام 1–4 و6–28 كما هي. إن كان سهواً فاجعلها 1–28 قبل الاعتماد.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, 2, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Idarubicin$q$, 10, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 3, $q$mg/m2$q$, $q$PO$q$, $q$1-3$q$, null, false, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 5, $q$mg/m2$q$, $q$PO$q$, $q$1,8,15,22$q$, null, false, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 25, $q$mg/m2$q$, $q$PO$q$, $q$1-4,6-28$q$, null, false, $q$يومياً$q$, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1$q$, null, true, $q$مرة واحدة خلال المرحلة؛ توقيتها حسب الطبيب المعالج$q$, null, 6);
end $do$;

-- UKALL60+ صيانة (المسار D)  (الملف: ukall_60)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL60+ صيانة (المسار D)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL60+ صيانة (المسار D)$q$, $q$ابيضاض لمفاوي حاد (ALL) سالب Ph: عمر ≥ 60، أو ≥ 55 غير مناسب لتجربة UKALL14 أو HOVON 100$q$, $q$mixed$q$, 91, 8, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL60+، الصيانة 24 شهراً). تبدأ بعد التدعيم 1 عند عدلات > 0.75 وصفيحات > 75.
الدورة هنا 3 أشهر (91 يوماً)؛ 8 دورات = 24 شهراً.
الهدف: عدلات 0.75–1.5 وصفيحات 75–150. عدلات > 1.5: ارفع 6-MP 25%، وإن بقيت بعد 4 أسابيع ارفع MTX 25%. عدلات < 0.75: خفّض الاثنين 50%. عدلات < 0.5: أوقف الصيانة وأعدها بـ100% عند تجاوز 0.75. لا حد أعلى لجرعتي 6-MP وMTX، والجرعات الفائتة لا تُعوَّض.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 25, $q$mg/m2$q$, $q$PO$q$, $q$1-91$q$, null, false, $q$يومياً؛ يبدأ 25 ملغ/م² ويُرفع 25% حسب التحمل والتعداد$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 5, $q$mg/m2$q$, $q$PO$q$, $q$1,8,15,22,29,36,43,50,57,64,71,78,85$q$, null, false, $q$أسبوعياً$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Prednisolone$q$, 60, $q$mg/m2$q$, $q$PO$q$, $q$1-5$q$, null, false, $q$5 أيام كل 3 أشهر$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1$q$, null, true, $q$كل 3 أشهر؛ يمكن حذفه حسب الطبيب$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.4, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, 2, true, $q$كل 3 أشهر$q$, null, 5);
end $do$;

-- Ven + CLAD/LDAC تحريض  (الملف: venetoclax_with_cladribine_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Ven + CLAD/LDAC تحريض$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Ven + CLAD/LDAC تحريض$q$, $q$ابيضاض نقوي حاد (AML) حديث التشخيص لكبار السن أو غير المؤهلين للعلاج المكثف$q$, $q$mixed$q$, 28, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Venetoclax/Cladribine + LDAC بالتناوب مع Azacitidine). التحريض: دورة أو دورتان من 28 يوماً.
تحريض ثانٍ عند الحاجة: أنشئ الخطة مرة أخرى بعد انتهاء الأولى، وVenetoclax من الدورة الثانية 7–14 يوماً حسب MRD والتحمل.
بعد التحريض: تدعيم CLAD/LDAC/Ven دورتين، ثم Azacitidine/Ven دورتين، بالتناوب حتى 18 دورة.
Venetoclax مع مثبطات CYP3A4: القوي ← الجرعة المستهدفة 100 ملغ (تصعيد 50، 50، 100)؛ المتوسط ← 200 ملغ (50، 100، 200).$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cladribine$q$, 5, $q$mg/m2$q$, $q$IV$q$, $q$1-5$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 20, $q$mg$q$, $q$SC$q$, $q$1-10$q$, null, true, $q$مرتين يومياً؛ بعد 3 ساعات من Cladribine$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Venetoclax$q$, 100, $q$mg$q$, $q$PO$q$, $q$1$q$, null, false, $q$تصعيد الجرعة: اليوم 1$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Venetoclax$q$, 200, $q$mg$q$, $q$PO$q$, $q$2$q$, null, false, $q$تصعيد الجرعة: اليوم 2$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Venetoclax$q$, 400, $q$mg$q$, $q$PO$q$, $q$3-21$q$, null, false, $q$الجرعة المستهدفة$q$, null, 5);
end $do$;

-- Ven + CLAD/LDAC تدعيم  (الملف: venetoclax_with_cladribine_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Ven + CLAD/LDAC تدعيم$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Ven + CLAD/LDAC تدعيم$q$, $q$ابيضاض نقوي حاد (AML) حديث التشخيص لكبار السن أو غير المؤهلين للعلاج المكثف$q$, $q$mixed$q$, 28, 2, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم. دورتان، ثم Azacitidine/Ven دورتين، بالتناوب حتى 18 دورة.
⚠ أُدخل Venetoclax الأيام 1–14؛ قصّرها إلى 7 أيام من شاشة الدورة إن قرر الطبيب.
Venetoclax مع مثبطات CYP3A4: القوي ← الجرعة المستهدفة 100 ملغ (تصعيد 50، 50، 100)؛ المتوسط ← 200 ملغ (50، 100، 200).$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cladribine$q$, 5, $q$mg/m2$q$, $q$IV$q$, $q$1,2,3$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 20, $q$mg$q$, $q$SC$q$, $q$1-10$q$, null, true, $q$مرتين يومياً؛ بعد 3 ساعات من Cladribine$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Venetoclax$q$, 400, $q$mg$q$, $q$PO$q$, $q$1-14$q$, null, false, $q$7 إلى 14 يوماً حسب MRD والتحمل$q$, null, 3);
end $do$;

-- Ven + Azacitidine تدعيم  (الملف: venetoclax_with_cladribine_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Ven + Azacitidine تدعيم$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Ven + Azacitidine تدعيم$q$, $q$ابيضاض نقوي حاد (AML) حديث التشخيص لكبار السن أو غير المؤهلين للعلاج المكثف$q$, $q$mixed$q$, 28, 2, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم. الدورتان 3 و4، ثم بالتناوب مع CLAD/LDAC/Ven حتى 18 دورة.
⚠ أُدخل Venetoclax الأيام 1–14؛ قصّرها إلى 7 أيام من شاشة الدورة إن قرر الطبيب.
Venetoclax مع مثبطات CYP3A4: القوي ← الجرعة المستهدفة 100 ملغ (تصعيد 50، 50، 100)؛ المتوسط ← 200 ملغ (50، 100، 200).$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Azacitidine$q$, 75, $q$mg/m2$q$, $q$SC$q$, $q$1-7$q$, null, true, $q$تحت الجلد أو وريدياً$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Venetoclax$q$, 400, $q$mg$q$, $q$PO$q$, $q$1-14$q$, null, false, $q$7 إلى 14 يوماً حسب MRD والتحمل$q$, null, 2);
end $do$;

-- ABVD  (الملف: ABVD_protocol_with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$ABVD$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$ABVD$q$, $q$لمفوما هودجكن$q$, $q$iv$q$, 28, 8, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (ABVD). كل 28 يوماً.
المرض الموضعي: 3–4 دورات مع العلاج الإشعاعي. المتقدم: 6 دورات معياراً، وتُرفع إلى 8 حسب الاستجابة. أُدخلت 8 لأن الخطة تُوقف ولا تُمدَّد؛ أوقفها بعد الدورة المقررة.
Bleomycin هنا بالوحدة الدولية كما في ملف المركز (1000 IU = 1 وحدة USP). السمية الرئوية تزداد بوضوح فوق جرعة كلية 400,000 IU.
Dacarbazine قد يسبب ألماً شديداً في موضع الحقن؛ يُحمى من الضوء.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 25, $q$mg/m2$q$, $q$IV$q$, $q$1,15$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Bleomycin$q$, 10000, $q$units/m2$q$, $q$IV$q$, $q$1,15$q$, null, true, $q$بالوحدة الدولية (IU): 10,000 IU/م²$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vinblastine$q$, 6, $q$mg/m2$q$, $q$IV$q$, $q$1,15$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dacarbazine$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1,15$q$, null, true, null, null, 4);
end $do$;

-- BrECADD  (الملف: BRECADD__with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$BrECADD$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$BrECADD$q$, $q$لمفوما هودجكن الكلاسيكية: المرحلة I–II غير الملائمة (18–60 سنة) أو III–IV (18–61 سنة)$q$, $q$mixed$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (BrECADD). كل 21 يوماً، من 2 إلى 6 دورات؛ أُدخلت 6 وتُوقَف الخطة عند الاكتفاء.
⚠ جدول الملف يضع Etoposide في اليومين 2 و4 فقط (جرعتان). في BrECADD الأصلي (HD21) ثلاث جرعات متتالية، فالأرجح أن اليوم 3 سقط سهواً. أُدخل كما في الملف؛ صحّحه إلى 2-4 قبل الاعتماد إن كان كذلك.
⚠ أُضيف سقف Brentuximab vedotin 180 ملغ (الجرعة على وزن أقصاه 100 كغ حسب النشرة)، وليس في ملف المركز.
Mesna من ملاحظات الملف. إماهة مع Cyclophosphamide يوم العلاج.
Doxorubicin حارق، وDacarbazine وCyclophosphamide مهيّجان. Doxorubicin وDacarbazine يُحميان من الضوء.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Brentuximab vedotin$q$, 1.8, $q$mg/kg$q$, $q$IV$q$, $q$1$q$, 180, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 150, $q$mg/m2$q$, $q$IV$q$, $q$2,4$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 1250, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mesna$q$, 250, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, null, false, $q$3 مرات: جرعة قبل Cyclophosphamide ثم بعد 4 و8 ساعات من بدئه$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 40, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, null, true, null, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dacarbazine$q$, 250, $q$mg/m2$q$, $q$IV$q$, $q$3,4$q$, null, true, null, null, 6);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 40, $q$mg$q$, $q$PO$q$, $q$2-5$q$, null, false, null, null, 7);
end $do$;

-- Nivo-BeGEV  (الملف: nivo-begev)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Nivo-BeGEV$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Nivo-BeGEV$q$, $q$لمفوما هودجكن المنتكسة أو المقاومة$q$, $q$iv$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Niv-BeGEV). كل 21 يوماً، 6 دورات عادة.
⚠ جدول الملف لا يحدد يوماً لـVinorelbine؛ أُدخل اليوم 1 كما في BeGEV الأصلي. تأكد قبل الاعتماد.
Dexamethasone في الملف 20 ملغ/م² (نحو 36 ملغ لمريض 1.8 م²).
Ondansetron فموياً قبل العلاج بـ30 دقيقة. Nivolumab يُحمى من الضوء.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Nivolumab$q$, 40, $q$mg$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Gemcitabine$q$, 800, $q$mg/m2$q$, $q$IV$q$, $q$1,4$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vinorelbine$q$, 20, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, $q$وريدي فقط؛ قاتل بأي طريق آخر$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Bendamustine$q$, 90, $q$mg/m2$q$, $q$IV$q$, $q$2,3$q$, null, true, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 20, $q$mg/m2$q$, $q$IV$q$, $q$1-5$q$, null, false, null, null, 5);
end $do$;

-- Pembro-R-DHAOx  (الملف: keytruda_r_dhaox)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Pembro-R-DHAOx$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Pembro-R-DHAOx$q$, $q$لمفوما منتكسة أو مقاومة$q$, $q$mixed$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Keytruda R-DHAOX). كل 21 يوماً، من 4 إلى 6 دورات؛ أُدخلت 6.
Oxaliplatin قد يسبب خلل الإحساس البلعومي الحنجري (صعوبة تنفس أو بلع) أثناء الإعطاء وحتى 48 ساعة بعده.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Pembrolizumab$q$, 200, $q$mg$q$, $q$IV$q$, $q$1$q$, null, true, $q$يُعطى أولاً$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Oxaliplatin$q$, 130, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 2000, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, null, true, $q$مرتين يومياً (بفارق 12 ساعة)$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 40, $q$mg$q$, $q$PO$q$, $q$1-4$q$, null, false, $q$مرة صباحاً مع الطعام أو بعده مباشرة؛ أو وريدياً$q$, null, 5);
end $do$;

-- DHAOx  (الملف: dhaox_with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$DHAOx$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$DHAOx$q$, $q$لمفوما لاهودجكينية بائية منتكسة أو مقاومة$q$, $q$mixed$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (dhaox_with_logo). كل 21 يوماً، من 4 إلى 6 دورات؛ أُدخلت 6.
عنوان الملف R-DHAOX لكن جدوله بلا Rituximab، فأُدخل بلا Rituximab باسم DHAOx. للنسخة مع Rituximab استعمل R-DHAOx.
Oxaliplatin قد يسبب خلل الإحساس البلعومي الحنجري (صعوبة تنفس أو بلع) أثناء الإعطاء وحتى 48 ساعة بعده.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Oxaliplatin$q$, 130, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 2000, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, null, true, $q$مرتين يومياً (بفارق 12 ساعة)$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 40, $q$mg$q$, $q$PO$q$, $q$1-4$q$, null, false, $q$مرة صباحاً مع الطعام أو بعده مباشرة؛ أو وريدياً$q$, null, 3);
end $do$;

-- Niv-ESHAP  (الملف: niv-ESHAP_protocol)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Niv-ESHAP$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Niv-ESHAP$q$, $q$لمفوما هودجكن المنتكسة أو المقاومة$q$, $q$iv$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Niv-ESHAP). كل 21–28 يوماً حسب تعافي التعداد؛ أُدخل 21 يوماً ويُؤجَّل عند الحاجة.
⚠ عدد الدورات غير مذكور نصاً؛ أُدخل 6 حسب جدول الدورات في الملف.
إماهة قبل Cisplatin وبعده، ومضادات القيء.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methylprednisolone$q$, 500, $q$mg$q$, $q$IV$q$, $q$1-5$q$, null, false, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Nivolumab$q$, 240, $q$mg$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 40, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cisplatin$q$, 25, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, $q$الجرعة الكلية 100 ملغ/م² على 4 أيام$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 2000, $q$mg/m2$q$, $q$IV$q$, $q$5$q$, null, true, null, null, 5);
end $do$;

-- DA-EPOCH-R  (الملف: doe_adjusted_R_EPOCH)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$DA-EPOCH-R$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$DA-EPOCH-R$q$, $q$لمفوما بائية عالية الدرجة (إعادة ترتيب MYC مع BCL2 و/أو BCL6)، بيركت، لمفوما المنصف البائية الكبيرة$q$, $q$mixed$q$, 21, 8, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (DA-EPOCH-R). كل 21 يوماً، من 6 إلى 8 دورات؛ أُدخلت 8 وتُوقَف الخطة عند الاكتفاء.
تعديل الجرعة لكل دورة من الدورة 2 حسب أدنى عدلات في الدورة السابقة: ≥ 0.5 ← رفع مستوى واحد؛ < 0.5 في قياس أو قياسين ← المستوى نفسه؛ < 0.5 في 3 قياسات أو أكثر ← خفض مستوى؛ صفيحات < 25 ← خفض مستوى أياً كانت العدلات.
المستويات (Doxorubicin / Etoposide / Cyclophosphamide بالملغ/م²): −2: 10 / 50 / 480؛ −1: 10 / 50 / 600؛ 1: 10 / 50 / 750؛ 2: 12 / 60 / 900؛ 3: 14.4 / 72 / 1080. Prednisolone وRituximab وVincristine ثابتة. عدّل الجرعة من شاشة الدورة مع «تطبيق على اللاحقة».
⚠ الملف يكتب Prednisolone 60 ملغ/م² دون تكرار. في DA-EPOCH-R المعياري 60 ملغ/م² مرتين يومياً (120 ملغ/م² يومياً). تأكد قبل الاعتماد.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, $q$يُحذف إن كان الورم سالب CD20$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 50, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, $q$جرعة يومية (المستوى 1)$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 10, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, $q$جرعة يومية (المستوى 1)$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 0.4, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, $q$جرعة يومية؛ لا سقف في DA-EPOCH$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 750, $q$mg/m2$q$, $q$IV$q$, $q$5$q$, null, true, $q$المستوى 1$q$, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Prednisolone$q$, 60, $q$mg/m2$q$, $q$PO$q$, $q$1-5$q$, null, false, null, null, 6);
end $do$;

-- MATRIX  (الملف: matrix_with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$MATRIX$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$MATRIX$q$, $q$لمفوما الجهاز العصبي المركزي (PCNSL)$q$, $q$iv$q$, 21, 4, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (MATRIX). كل 21 يوماً، 4 دورات.
إماهة وقلونة البول قبل Methotrexate وبعده، ثم بروتوكول Folinic acid.
Filgrastim 0.5 MU/كغ يومياً (5 ميكروغرام/كغ) من اليوم 9 لمدة 7 أيام. لم يُدخل سطراً لأن التطبيق لا يدعم وحدة الميكروغرام.
محلول Thiotepa المخفف يُعطى فوراً قدر الإمكان.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 500, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, null, true, $q$الجزء الأول؛ يليه الجزء الثاني 3000 ملغ/م² مباشرة (المجموع 3.5 غ/م²)$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 3000, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, null, true, $q$الجزء الثاني، بعد الأول مباشرة$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 2000, $q$mg/m2$q$, $q$IV$q$, $q$3,4$q$, null, true, $q$مرتين يومياً (بفارق 12 ساعة)؛ 4 جرعات$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Thiotepa$q$, 30, $q$mg/m2$q$, $q$IV$q$, $q$5$q$, null, true, null, null, 5);
end $do$;

-- IBER  (الملف: IBER_PROTOCOL)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$IBER$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$IBER$q$, $q$لمفوما الجهاز العصبي المركزي (PCNSL) المنتكسة أو المقاومة$q$, $q$mixed$q$, 21, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (IBER). كل 21 يوماً حتى 6 دورات، ثم صيانة Ibrutinib 6 أشهر (بروتوكول مستقل).
⚠ الملف لا يذكر Mesna مع Ifosfamide 3.5 غ/م²؛ أضفها حسب سياسة المركز.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Ibrutinib$q$, 560, $q$mg$q$, $q$PO$q$, $q$1-21$q$, null, false, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$8,15$q$, null, true, $q$الدورة 1 فقط$q$, $q$1$q$, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Ifosfamide$q$, 3500, $q$mg/m2$q$, $q$IV$q$, $q$2$q$, null, true, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 100, $q$mg/m2$q$, $q$IV$q$, $q$2-4$q$, null, true, null, null, 5);
end $do$;

-- Ibrutinib صيانة بعد IBER  (الملف: IBER_PROTOCOL)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Ibrutinib صيانة بعد IBER$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Ibrutinib صيانة بعد IBER$q$, $q$لمفوما الجهاز العصبي المركزي (PCNSL) بعد IBER$q$, $q$oral$q$, 28, 6, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (IBER): صيانة Ibrutinib 6 أشهر بعد دورات IBER.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Ibrutinib$q$, 560, $q$mg$q$, $q$PO$q$, $q$1-28$q$, null, false, null, null, 1);
end $do$;

-- R-Cladribine (HCL)  (الملف: cladribinerituximab_for_HCL)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$R-Cladribine (HCL)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$R-Cladribine (HCL)$q$, $q$ابيضاض الخلايا المشعرة (HCL)$q$, $q$iv$q$, 56, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Cladribine + Rituximab لابيضاض الخلايا المشعرة، Cladribine خمسة أيام متتالية).
قبل Rituximab بـ30 دقيقة على الأقل: Paracetamol 1000 mg، Hydrocortisone 100 mg، Chlorphenamine 10 mg.
الدورة الواحدة هنا 8 أسابيع تغطي العلاج كاملاً. للنسخة الأسبوعية من Cladribine استعمل «R-Cladribine أسبوعي (HCL)».$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cladribine$q$, 0.15, $q$mg/kg$q$, $q$IV$q$, $q$1-5$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Rituximab$q$, 375, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15,22,29,36,43,50$q$, null, true, $q$أسبوعياً، 8 جرعات$q$, null, 2);
end $do$;

-- Hyper-CVAD (A/B)  (الملف: hyper_cvad_with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Hyper-CVAD (A/B)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Hyper-CVAD (A/B)$q$, $q$ابيضاض لمفاوي حاد (ALL)$q$, $q$mixed$q$, 42, 4, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Hyper-CVAD). الجزء A كل 21 يوماً 4 مرات، والجزء B كل 21 يوماً 4 مرات، بالتناوب.
الدورة هنا 42 يوماً = الجزء A (الأيام 1–21) ثم الجزء B (الأيام 22–42). 4 دورات = 8 أجزاء. يُضبط الفاصل الفعلي بالتأجيل حسب التعداد.
إماهة فموية 2–3 لترات يومياً مع Cyclophosphamide.
MTX في الجزء B: إماهة مسبقة 12 ساعة (Glucose 2.5% مع NaCl 0.45% وKCl 20 mmol وبيكربونات 100 mmol)، ومراقبة الإدرار كل 4 ساعات (الهدف 400 مل/م²/4 ساعات، Furosemide 20–40 ملغ عند الحاجة)، وإماهة لاحقة مع قياس pH البول كل ساعتين (≥ 7؛ وإلا بيكربونات فموية 1500 ملغ).
⚠ جدول الملف يكتب Folinic acid 15 ملغ/م²، والملاحظة تكتب 15 ملغ ثابتة كل 6 ساعات بعد جرعة 50 ملغ. أُدخل كما في الجدول؛ وحّد الوحدة قبل الاعتماد.
⚠ الملف يضع MTX وCytarabine داخل القراب كليهما في اليوم 2 من الجزء A.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 300, $q$mg/m2$q$, $q$IV$q$, $q$1-3$q$, null, true, $q$الجزء A: كل 12 ساعة، 6 جرعات$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 40, $q$mg$q$, $q$PO$q$, $q$1-4,11-14$q$, null, false, $q$الجزء A؛ فموي أو وريدي$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 50, $q$mg/m2$q$, $q$IV$q$, $q$4$q$, null, true, $q$الجزء A$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 2, $q$mg$q$, $q$IV$q$, $q$4,11$q$, null, true, $q$الجزء A$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12, $q$mg$q$, $q$IT$q$, $q$2$q$, null, true, $q$الجزء A؛ مستحضر خالٍ من المواد الحافظة$q$, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 70, $q$mg$q$, $q$IT$q$, $q$2$q$, null, true, $q$الجزء A؛ مستحضر خالٍ من المواد الحافظة$q$, null, 6);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 1000, $q$mg/m2$q$, $q$IV$q$, $q$22$q$, null, true, $q$الجزء B؛ إماهة وقلونة قبله وبعده$q$, null, 7);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Folinic acid$q$, 15, $q$mg/m2$q$, $q$IV$q$, $q$23-25$q$, null, false, $q$الجزء B؛ تبدأ بعد 12 ساعة من MTX بجرعة 50 ملغ ثم كل 6 ساعات$q$, null, 8);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 3000, $q$mg/m2$q$, $q$IV$q$, $q$23,24$q$, null, true, $q$الجزء B؛ كل 12 ساعة، 4 جرعات؛ فوق 60 سنة 2 غ/م² حسب الملف$q$, null, 9);
end $do$;

-- UKALL14 تحريض المرحلة 1  (الملف: 2_5206212184861874602)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL14 تحريض المرحلة 1$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL14 تحريض المرحلة 1$q$, $q$ابيضاض لمفاوي حاد (ALL) بائي السلائف أو تائي، للبالغين 26–55/65 سنة (UKALL14)$q$, $q$mixed$q$, 28, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL14، الأسابيع 1–4).
قبلها مرحلة تمهيدية 5–7 أيام: Dexamethasone 6 ملغ/م²/يوم وريدياً أو فموياً.
L-asparaginase: أول 5 جرعات (IM إن كانت الصفيحات > 20، أو وريدياً على ساعتين)، وتُحذف في موجب Ph وفوق 40 سنة. ⚠ الملف لا يحدد جرعتها، فلم تُدخل سطراً.
موجب Ph: Imatinib 400 ملغ يومياً يُرفع إلى 600 ملغ خلال أسبوعين، مع مراقبة وظائف الكبد أسبوعياً.
إن وُجدت أرومات في السائل الدماغي الشوكي يُعطى MTX داخل القراب مرتين أسبوعياً حتى يصفو، ثم تشعيع القحف قبل التدعيم لمن لن يُزرع له.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.4, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15,22$q$, 2, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 30, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15,22$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 10, $q$mg/m2$q$, $q$PO$q$, $q$1-4,8-11,15-18$q$, 20, false, $q$جرعة واحدة فموية$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$15$q$, null, true, $q$يمكن إعطاؤها يوماً قبل أو بعد مع فحص السائل الدماغي الشوكي$q$, null, 4);
end $do$;

-- UKALL14 تحريض المرحلة 2  (الملف: 2_5206212184861874602)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL14 تحريض المرحلة 2$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL14 تحريض المرحلة 2$q$, $q$ابيضاض لمفاوي حاد (ALL) بائي السلائف أو تائي، للبالغين 26–55/65 سنة (UKALL14)$q$, $q$mixed$q$, 28, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL14، الأسابيع 5–8). تبدأ في أقرب وقت. لا تبدأ المرحلة إلا عند عدلات > 0.75 وصفيحات > 75 (×10⁹/لتر).
نهاية التحريض: بزل نقي العظم بين اليوم 28 و35 حسب التعافي (لا يتأخر بعد 35). في الهدأة ← المرحلة التالية. نقي ناقص الخلايا مع دم غير متعافٍ ← انتظار أسبوع وإعادة البزل. لا هدأة ← يخرج المريض من هذا البروتوكول.
MRD بالتدفق الخلوي والجزيئي (IgH/TCR، BCR-ABL).
موجب Ph: Imatinib 400 ملغ يومياً يُرفع إلى 600 ملغ خلال أسبوعين، مع مراقبة وظائف الكبد أسبوعياً.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 1000, $q$mg/m2$q$, $q$IV$q$, $q$1,15$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 75, $q$mg/m2$q$, $q$IV$q$, $q$1-4,8-11,15-18,22-25$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 60, $q$mg/m2$q$, $q$PO$q$, $q$1-28$q$, null, false, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1,8,15,22$q$, null, true, null, null, 4);
end $do$;

-- UKALL14 تدعيم 1 و2  (الملف: 2_5206212184861874602)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL14 تدعيم 1 و2$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL14 تدعيم 1 و2$q$, $q$ابيضاض لمفاوي حاد (ALL) بائي السلائف أو تائي، للبالغين 26–55/65 سنة (UKALL14)$q$, $q$iv$q$, 35, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL14، الأسابيع 9–13): التدعيم 1 في الأيام 1–5، والتدعيم 2 في الأيام 21–25.
لا تبدأ المرحلة إلا عند عدلات > 0.75 وصفيحات > 75 (×10⁹/لتر). عند البدء وقبل التدعيم 2 (اليوم 21)؛ تأكد من تعافي النقي قبل اليوم 21.
أسبوعا راحة بعد التدعيم 2 قبل التدعيم 3. L-asparaginase تُحذف في موجب Ph (الملف لا يحدد جرعتها).
موجب Ph: Imatinib 400 ملغ يومياً يُرفع إلى 600 ملغ خلال أسبوعين، مع مراقبة وظائف الكبد أسبوعياً.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 100, $q$mg/m2$q$, $q$IV$q$, $q$1-5,21-25$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 75, $q$mg/m2$q$, $q$IV$q$, $q$1-5,21-25$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1,21$q$, null, true, null, null, 3);
end $do$;

-- UKALL14 تدعيم 3  (الملف: 2_5206212184861874602)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL14 تدعيم 3$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL14 تدعيم 3$q$, $q$ابيضاض لمفاوي حاد (ALL) بائي السلائف أو تائي، للبالغين 26–55/65 سنة (UKALL14)$q$, $q$mixed$q$, 42, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL14، الأسابيع 14–19). لا تبدأ المرحلة إلا عند عدلات > 0.75 وصفيحات > 75 (×10⁹/لتر).
L-asparaginase تُحذف في موجب Ph.
موجب Ph: Imatinib 400 ملغ يومياً يُرفع إلى 600 ملغ خلال أسبوعين، مع مراقبة وظائف الكبد أسبوعياً.
⚠ جدول الجزء الثاني ينتهي عند اليوم 40، فأُدخل 6-MP من اليوم 29 إلى 40 كما هو.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.4, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15,22$q$, 2, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 25, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15,22$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 10, $q$mg/m2$q$, $q$PO$q$, $q$1-4,8-11,15-18,22-25$q$, null, false, $q$جرعة واحدة فموية$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1,15$q$, null, true, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 1000, $q$mg/m2$q$, $q$IV$q$, $q$29$q$, null, true, $q$الجزء الثاني بعد التأكد من تعافي النقي$q$, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 75, $q$mg/m2$q$, $q$IV$q$, $q$29-32,36-39$q$, null, true, null, null, 6);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 60, $q$mg/m2$q$, $q$PO$q$, $q$29-40$q$, null, false, null, null, 7);
end $do$;

-- UKALL14 تدعيم 4  (الملف: 2_5206212184861874602)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL14 تدعيم 4$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL14 تدعيم 4$q$, $q$ابيضاض لمفاوي حاد (ALL) بائي السلائف أو تائي، للبالغين 26–55/65 سنة (UKALL14)$q$, $q$iv$q$, 28, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL14، التدعيم 4). تأكد من تعافي النقي قبل البدء.
⚠ الملف يكتب Etoposide «1000 mg/m²»، وهو على الأغلب خطأ مطبعي: الملف نفسه يكتب 100 ملغ/م² في التدعيم 1 و2، وUKALL14 الأصلي 100 ملغ/م². أُدخلت 100. تأكد قبل الاعتماد.
بعد التدعيم 4: الصيانة عند عدلات > 0.75 وصفيحات > 75.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 100, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 75, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12, $q$mg$q$, $q$IT$q$, $q$1$q$, null, true, null, null, 3);
end $do$;

-- UKALL صيانة (UKALL14)  (الملف: 2_5206212184861874602)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL صيانة (UKALL14)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL صيانة (UKALL14)$q$, $q$ابيضاض لمفاوي حاد (ALL) بائي السلائف أو تائي، للبالغين 26–55/65 سنة (UKALL14)؛ ويُحيل إليه ملف UKALL2011$q$, $q$mixed$q$, 91, 8, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (صيانة UKALL14؛ لغير مرضى الزرع فقط). تبدأ بعد التدعيم 4 عند عدلات > 0.75 وصفيحات > 75 وتستمر سنتين كاملتين.
الدورة هنا 3 أشهر (91 يوماً)؛ 8 دورات = 24 شهراً. موجب Ph: يستمر Imatinib يومياً طوال الصيانة.
الهدف: عدلات 0.75–1.5 وصفيحات 75–150. عدلات > 1.5: ارفع 6-MP 25%، وإن بقيت بعد 4 أسابيع ارفع MTX 25%. عدلات < 0.75: خفّض الاثنين 50%. عدلات < 0.5: أوقف الصيانة وأعدها بـ100% عند تجاوز 0.75. لا حد أعلى لجرعتي 6-MP وMTX، والجرعات الفائتة لا تُعوَّض (عدا MTX داخل القراب).
Co-trimoxazole 960 ملغ مرتين يومياً يومين في الأسبوع (ليس يوم MTX الفموي) وAciclovir 200 ملغ مرتين يومياً طوال الصيانة. إن توقفت الصيانة لنقص الخلايا ولم يتعافَ التعداد خلال 2–3 أسابيع يُنظر في إيقاف Co-trimoxazole وبديله Pentamidine رذاذاً شهرياً أو Dapsone.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 75, $q$mg/m2$q$, $q$PO$q$, $q$1-91$q$, null, false, $q$يومياً$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 20, $q$mg/m2$q$, $q$PO$q$, $q$1,8,15,22,29,36,43,50,57,64,71,78,85$q$, null, false, $q$أسبوعياً؛ ليس يوم Co-trimoxazole$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.4, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, 2, true, $q$كل 3 أشهر$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Prednisolone$q$, 60, $q$mg/m2$q$, $q$PO$q$, $q$1-5$q$, null, false, $q$5 أيام كل 3 أشهر$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1$q$, null, true, $q$كل 3 أشهر$q$, null, 5);
end $do$;

-- UKALL2011 تحريض المرحلة 1  (الملف: 2_5206195451669290104)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL2011 تحريض المرحلة 1$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL2011 تحريض المرحلة 1$q$, $q$ابيضاض لمفاوي حاد (ALL) أو لمفوما أرومية لمفاوية، لليافعين 14–25 سنة، سالب Ph (UKALL2011)$q$, $q$mixed$q$, 35, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL2011، المرحلة الأولى). المجموعة B: خطورة وراثية منخفضة، استجابة مبكرة سريعة، M0/M1، وسائل دماغي شوكي نظيف في اليوم 29.
قبلها مرحلة تمهيدية 5–7 أيام: ستيرويد 6 ملغ/م²/يوم.
بزل نقي العظم في اليوم 8 واليوم 29 (أو تقييم اللمفوما في اليوم 29). المرحلة الثانية يومها الأول = اليوم 35 من العلاج.
⚠ الملف يضع 6-MP في اليوم 29 وحده؛ يتكرر يومياً في المرحلة الثانية. احذفه من هنا إن لم يكن مقصوداً.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.5, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15,22,29$q$, 2, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 25, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15,22$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 10, $q$mg/m2$q$, $q$PO$q$, $q$1-7,15-21$q$, null, false, $q$الجرعة اليومية الكلية، تُقسم جرعتين$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1,8,29$q$, null, true, $q$مع فحص السائل الدماغي الشوكي$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$L-asparaginase (E. coli)$q$, 6000, $q$units/m2$q$, $q$IM$q$, $q$4,6,9,11,13,16,18,20,23$q$, null, true, $q$عضلي أو تسريب وريدي$q$, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 60, $q$mg/m2$q$, $q$PO$q$, $q$29$q$, null, false, null, null, 6);
end $do$;

-- UKALL2011 تحريض المرحلة 2  (الملف: 2_5206195451669290104)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL2011 تحريض المرحلة 2$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL2011 تحريض المرحلة 2$q$, $q$ابيضاض لمفاوي حاد (ALL) أو لمفوما أرومية لمفاوية، لليافعين 14–25 سنة، سالب Ph (UKALL2011)$q$, $q$mixed$q$, 28, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL2011، المرحلة الثانية: تدعيم BFM المعياري). المجموعة B: خطورة وراثية منخفضة، استجابة مبكرة سريعة، M0/M1، وسائل دماغي شوكي نظيف في اليوم 29.
يومها الأول = اليوم 35 من العلاج. بعدها MTX عالي الجرعة (أو الصيانة المرحلية بديلاً).$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 1000, $q$mg/m2$q$, $q$IV$q$, $q$1,15$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 75, $q$mg/m2$q$, $q$IV$q$, $q$1-4,8-11,15-18,22-25$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 60, $q$mg/m2$q$, $q$PO$q$, $q$1-28$q$, null, false, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1,8,15$q$, null, true, null, null, 4);
end $do$;

-- UKALL2011 MTX عالي الجرعة  (الملف: 2_5206195451669290104)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL2011 MTX عالي الجرعة$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL2011 MTX عالي الجرعة$q$, $q$ابيضاض لمفاوي حاد (ALL) أو لمفوما أرومية لمفاوية، لليافعين 14–25 سنة، سالب Ph (UKALL2011)$q$, $q$mixed$q$, 63, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL2011، MTX عالي الجرعة M1 وM2). المجموعة B: خطورة وراثية منخفضة، استجابة مبكرة سريعة، M0/M1، وسائل دماغي شوكي نظيف في اليوم 29.
الأيام 57–63 بلا 6-MP، ثم التكثيف المتأخر.
إماهة نحو 3 لترات يومياً لمدة 48 ساعة على الأقل من بدء MTX: لتر Dextrose saline مع 50 mmol بيكربونات و20 mmol KCl (أو تناوب NaCl 0.9% وGlucose 5%). إن استمر القيء يبقى Folinic acid وريدياً.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 3000, $q$mg/m2$q$, $q$IV$q$, $q$8,22,36,50$q$, null, true, $q$يتوقف التسريب عند 24 ساعة حتى لو لم يكتمل$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Folinic acid$q$, 15, $q$mg/m2$q$, $q$IV$q$, $q$9-11,23-25,37-39,51-53$q$, null, false, $q$تبدأ بعد 12 ساعة من نهاية MTX، كل 6 ساعات: 4 جرعات وريدية ثم 8 فموية بالجرعة نفسها$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 25, $q$mg/m2$q$, $q$PO$q$, $q$1-56$q$, null, false, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1,22,36,50$q$, null, true, null, null, 4);
end $do$;

-- UKALL2011 صيانة مرحلية (بديل MTX عالي الجرعة)  (الملف: 2_5206195451669290104)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL2011 صيانة مرحلية (بديل MTX عالي الجرعة)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL2011 صيانة مرحلية (بديل MTX عالي الجرعة)$q$, $q$ابيضاض لمفاوي حاد (ALL) أو لمفوما أرومية لمفاوية، لليافعين 14–25 سنة، سالب Ph (UKALL2011)$q$, $q$mixed$q$, 63, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL2011، الصيانة المرحلية). بديل لـMTX عالي الجرعة عند: مانع لـMTX عالي الجرعة، أو مريض هش، أو رفض العلاج.
⚠ الصفحة الثانية من الملف تكتب Vincristine 2 ملغ ثابتة في اليوم 29، والأولى 1.5 ملغ/م² بسقف 2. أُدخلت 1.5 ملغ/م² بسقف 2 في اليومين.
بعدها التكثيف المتأخر.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.5, $q$mg/m2$q$, $q$IV$q$, $q$1,29$q$, 2, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 6, $q$mg/m2$q$, $q$PO$q$, $q$1-5,29-33$q$, null, false, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 75, $q$mg/m2$q$, $q$PO$q$, $q$1-56$q$, null, false, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 20, $q$mg/m2$q$, $q$PO$q$, $q$1,8,22,29,36,50,57$q$, null, false, $q$أسبوعياً، وتُترك أسبوع MTX داخل القراب$q$, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$15,43$q$, null, true, null, null, 5);
end $do$;

-- UKALL2011 التكثيف المتأخر  (الملف: 2_5206195451669290104)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$UKALL2011 التكثيف المتأخر$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$UKALL2011 التكثيف المتأخر$q$, $q$ابيضاض لمفاوي حاد (ALL) أو لمفوما أرومية لمفاوية، لليافعين 14–25 سنة، سالب Ph (UKALL2011)$q$, $q$mixed$q$, 42, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (UKALL2011، التكثيف المتأخر 1 و2). المجموعة B: خطورة وراثية منخفضة، استجابة مبكرة سريعة، M0/M1، وسائل دماغي شوكي نظيف في اليوم 29.
الدورة هنا 42 يوماً: الجزء الأول الأيام 1–28، والثاني من اليوم 29. يُضبط بدء الجزء الثاني بالتأجيل حسب التعداد.
بعدها الصيانة: ملف المركز يحيل إلى جدول صيانة UKALL14 (البروتوكول «UKALL صيانة (UKALL14)»).$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Vincristine$q$, 1.5, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15$q$, 2, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Doxorubicin$q$, 25, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15$q$, null, true, null, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 10, $q$mg/m2$q$, $q$PO$q$, $q$1-7,15-21$q$, null, false, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 12.5, $q$mg$q$, $q$IT$q$, $q$1$q$, null, true, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$L-asparaginase (E. coli)$q$, 6000, $q$units/m2$q$, $q$IM$q$, $q$4,6,9,11,13$q$, null, true, $q$عضلي أو تسريب وريدي$q$, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cyclophosphamide$q$, 1000, $q$mg/m2$q$, $q$IV$q$, $q$29$q$, null, true, $q$الجزء الثاني$q$, null, 6);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 75, $q$mg/m2$q$, $q$IV$q$, $q$29-32,36-39$q$, null, true, null, null, 7);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 60, $q$mg/m2$q$, $q$PO$q$, $q$29-42$q$, null, false, null, null, 8);
end $do$;

-- FLAG  (الملف: flag_protocol_2)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$FLAG$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$FLAG$q$, $q$ابيضاض نقوي حاد (AML) منتكس أو مقاوم: تحريض أو إنقاذ$q$, $q$iv$q$, 28, 2, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (FLAG). كل 28 يوماً، دورة أو دورتان؛ أُدخلت 2.
G-CSF 5 ميكروغرام/كغ تحت الجلد الأيام 1–6، ويمكن تمديده أو إعادته لاحقاً بقرار الاستشاري. لم يُدخل سطراً لأن التطبيق لا يدعم وحدة الميكروغرام.
قطرة Prednisolone للعين 1–2 قطرة كل 4 ساعات أثناء الصحو قبل Cytarabine وحتى 5 أيام بعده.
بعد Fludarabine: مشتقات دم مشععة مدى الحياة، ووقاية PJP حتى تتجاوز CD4 200.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Fludarabine$q$, 30, $q$mg/m2$q$, $q$IV$q$, $q$1-5$q$, null, true, null, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 2000, $q$mg/m2$q$, $q$IV$q$, $q$1-5$q$, null, true, $q$تبدأ بعد 4 ساعات من بدء Fludarabine؛ فوق 60 سنة يُنظر في 1000 ملغ/م²$q$, null, 2);
end $do$;

-- Decitabine + Venetoclax أسبوعي  (الملف: dec-ven_weekly)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Decitabine + Venetoclax أسبوعي$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Decitabine + Venetoclax أسبوعي$q$, $q$ابيضاض نقوي حاد (AML) حديث التشخيص: 75 سنة فأكثر أو أمراض مرافقة تمنع العلاج المكثف$q$, $q$mixed$q$, 28, 3, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Decitabine + Venetoclax). 3 دورات تحريض، ثم صيانة أسبوعية.
⚠ الملف لا يحدد جرعات الصيانة الأسبوعية؛ أنشئ خطة جديدة بعد التحريض حسب قرار الطبيب.
⚠ الملف لا يذكر تصعيد جرعة Venetoclax أو الوقاية من متلازمة انحلال الورم في البداية؛ قرار الطبيب.
Venetoclax مع مثبطات CYP3A4: القوي ← الجرعة المستهدفة 100 ملغ؛ المتوسط ← 200 ملغ.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Decitabine$q$, 20, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15,22$q$, null, true, $q$أو 0.2 ملغ/كغ تحت الجلد بدلاً منها$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Venetoclax$q$, 400, $q$mg$q$, $q$PO$q$, $q$1,8,15,22$q$, null, false, null, null, 2);
end $do$;

-- APL: ATRA + ATO تحريض  (الملف: APL_TWICE_WEEKLY_with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$APL: ATRA + ATO تحريض$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$APL: ATRA + ATO تحريض$q$, $q$ابيضاض النقويات الحاد (APL) حديث التشخيص، خطورة منخفضة إلى متوسطة (كريات بيض ≤ 10)$q$, $q$mixed$q$, 60, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (APL مرتين أسبوعياً، التحريض).
⚠ جدول الملف يكتب ATO مرتين أسبوعياً «29–60» دون تحديد الأيام؛ أُدخل مرتين أسبوعياً حتى اليوم 60. في AML17 ينتهي ATO بنهاية الأسبوع 8. راجع قبل الاعتماد.
إن ارتفعت الكريات البيض عند التشخيص أو أثناء العلاج يُضاف Hydroxycarbamide أو Idarubicin لخفضها.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Tretinoin (ATRA)$q$, 45, $q$mg/m2$q$, $q$PO$q$, $q$1-60$q$, null, false, $q$الجرعة اليومية الكلية، تُقسم جرعتين متساويتين وتُقرّب لأقرب 10 ملغ$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Arsenic trioxide$q$, 0.3, $q$mg/kg$q$, $q$IV$q$, $q$1-5$q$, null, true, $q$الأسبوع الأول$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Arsenic trioxide$q$, 0.25, $q$mg/kg$q$, $q$IV$q$, $q$8,11,15,18,22,25,29,32,36,39,43,46,50,53,57,60$q$, null, true, $q$مرتين أسبوعياً$q$, null, 3);
end $do$;

-- APL: ATRA + ATO تدعيم  (الملف: APL_TWICE_WEEKLY_with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$APL: ATRA + ATO تدعيم$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$APL: ATRA + ATO تدعيم$q$, $q$ابيضاض النقويات الحاد (APL)، خطورة منخفضة إلى متوسطة$q$, $q$mixed$q$, 56, 4, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (APL مرتين أسبوعياً، التدعيم): حتى 4 دورات كل 8 أسابيع. تبدأ بعد 4 أسابيع من انتهاء التحريض (الأسبوع 12 من بدء العلاج)، وكل دورة عند عدلات > 1.5 وصفيحات > 100.
⚠ جدول الأسابيع في الملف يضع ATRA في الأسبوعين 1–2 و5–6 في كل الدورات الأربع (8 دورات ATRA)، ونص الملف يقول المجموع 7 كما في APL0406. أُدخلت 7: لا ATRA في الأسبوعين 5–6 من الدورة 4. غيّرها إن كان المقصود 8.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Tretinoin (ATRA)$q$, 45, $q$mg/m2$q$, $q$PO$q$, $q$1-14$q$, null, false, $q$الجرعة اليومية الكلية، تُقسم جرعتين متساويتين$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Tretinoin (ATRA)$q$, 45, $q$mg/m2$q$, $q$PO$q$, $q$29-42$q$, null, false, $q$الجرعة اليومية الكلية، تُقسم جرعتين متساويتين$q$, $q$1-3$q$, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Arsenic trioxide$q$, 0.3, $q$mg/kg$q$, $q$IV$q$, $q$1-5$q$, null, true, $q$الأسبوع الأول$q$, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Arsenic trioxide$q$, 0.25, $q$mg/kg$q$, $q$IV$q$, $q$8,12,15,19,22,26$q$, null, true, $q$مرتين أسبوعياً$q$, null, 4);
end $do$;

-- APL أطفال AIDA2000: تحريض  (الملف: apl_chidren_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$APL أطفال AIDA2000: تحريض$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$APL أطفال AIDA2000: تحريض$q$, $q$ابيضاض النقويات الحاد (APL) عالي الخطورة حديث التشخيص لدى الأطفال (GIMEMA/AIEOP AIDA2000)$q$, $q$mixed$q$, 30, 1, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (AIDA2000 للأطفال، التحريض).$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Tretinoin (ATRA)$q$, 25, $q$mg/m2$q$, $q$PO$q$, $q$1-30$q$, null, false, $q$الجرعة اليومية الكلية، تُقسم جرعتين؛ حتى 30 يوماً$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Idarubicin$q$, 12, $q$mg/m2$q$, $q$IV$q$, $q$2,4,6,8$q$, null, true, null, null, 2);
end $do$;

-- APL أطفال AIDA2000: تدعيم  (الملف: apl_chidren_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$APL أطفال AIDA2000: تدعيم$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$APL أطفال AIDA2000: تدعيم$q$, $q$ابيضاض النقويات الحاد (APL) عالي الخطورة لدى الأطفال (AIDA2000)$q$, $q$mixed$q$, 30, 3, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (AIDA2000 للأطفال، التدعيم): 3 دورات شهرية، لكل دورة أدويتها. تبدأ كل دورة عند تعافي التعداد.
الدورة 1: ATRA + Cytarabine + Idarubicin. الدورة 2: ATRA + Mitoxantrone + Etoposide. الدورة 3: ATRA + Idarubicin + Cytarabine + Thioguanine.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Tretinoin (ATRA)$q$, 25, $q$mg/m2$q$, $q$PO$q$, $q$1-15$q$, null, false, $q$الجرعة اليومية الكلية، تُقسم جرعتين$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 1000, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, null, $q$1$q$, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Idarubicin$q$, 5, $q$mg/m2$q$, $q$IV$q$, $q$1-4$q$, null, true, $q$بعد 3 ساعات من نهاية Cytarabine$q$, $q$1$q$, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mitoxantrone$q$, 10, $q$mg/m2$q$, $q$IV$q$, $q$1-5$q$, null, true, null, $q$2$q$, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Etoposide$q$, 100, $q$mg/m2$q$, $q$IV$q$, $q$1-5$q$, null, true, $q$بعد 12 ساعة من بدء Mitoxantrone$q$, $q$2$q$, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Idarubicin$q$, 10, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, null, true, null, $q$3$q$, 6);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Cytarabine$q$, 150, $q$mg/m2$q$, $q$SC$q$, $q$1-5$q$, null, true, $q$كل 8 ساعات$q$, $q$3$q$, 7);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Thioguanine$q$, 70, $q$mg/m2$q$, $q$PO$q$, $q$1-5$q$, null, false, $q$كل 8 ساعات$q$, $q$3$q$, 8);
end $do$;

-- APL أطفال AIDA2000: صيانة  (الملف: apl_chidren_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$APL أطفال AIDA2000: صيانة$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$APL أطفال AIDA2000: صيانة$q$, $q$ابيضاض النقويات الحاد (APL) لدى الأطفال (AIDA2000)$q$, $q$oral$q$, 91, 8, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (AIDA2000 للأطفال، الصيانة سنتين). الدورة هنا 3 أشهر (91 يوماً)؛ 8 دورات = 24 شهراً.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Tretinoin (ATRA)$q$, 45, $q$mg/m2$q$, $q$PO$q$, $q$1-14$q$, null, false, $q$الجرعة اليومية الكلية؛ 14 يوماً كل 3 أشهر$q$, null, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Methotrexate$q$, 20, $q$mg/m2$q$, $q$PO$q$, $q$1,8,15,22,29,36,43,50,57,64,71,78,85$q$, null, false, $q$أسبوعياً$q$, null, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Mercaptopurine$q$, 60, $q$mg/m2$q$, $q$PO$q$, $q$1-91$q$, null, false, $q$يومياً$q$, null, 3);
end $do$;

-- hATG + Ciclosporin  (الملف: ATG)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$hATG + Ciclosporin$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$hATG + Ciclosporin$q$, $q$فقر الدم اللاتنسجي غير المؤهل لزرع خلايا جذعية من أخ متطابق$q$, $q$mixed$q$, 28, 13, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (hATG + CSA).
الدورة هنا 28 يوماً: hATG في الدورة 1 فقط، وCiclosporin في كل الدورات. 13 دورة ≈ 12 شهراً (الحد الأدنى). عند الاستجابة يستمر 12 شهراً أخرى ثم يُسحب ببطء نحو 25 ملغ كل 2–3 أشهر؛ أنشئ خطة جديدة لذلك.
اختبار جلدي قبل أول جرعة hATG: كمية صغيرة غير مخففة على سطح الجلد، ثم إن لم يظهر شيء بعد 10 دقائق اختبار داخل الأدمة بتخفيف 1:1000 مع حقنة ضابطة من المحلول الملحي. انتبار ≥ 3 ملم بعد 10 دقائق يعني حساسية محتملة؛ وازن الفائدة والخطر مع المريض.
الصفيحات > 20–30 ×10⁹/لتر في الأيام 1–4، وتجنب نقل الصفيحات أثناء تسريب hATG.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Anti-thymocyte globulin (equine, ATGAM)$q$, 40, $q$mg/kg$q$, $q$IV$q$, $q$1-4$q$, null, true, $q$يومياً 4 أيام$q$, $q$1$q$, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Ciclosporin$q$, 2.5, $q$mg/kg$q$, $q$PO$q$, $q$1-28$q$, null, false, $q$مرتين يومياً؛ فوق 60 سنة 1.25 ملغ/كغ مرتين يومياً$q$, null, 2);
end $do$;

-- KRd  (الملف: KRD_protocol_with_logo)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$KRd$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$KRd$q$, $q$الورم النقوي المتعدد بعد علاج سابق واحد على الأقل$q$, $q$mixed$q$, 28, 20, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (KRD). كل 28 يوماً: الدورة 1، ثم 2–12، ثم 13 فما بعد (Carfilzomib كل أسبوعين).
⚠ عدد الدورات بعد 13 غير محدد («13 and onward»)؛ أُدخلت حتى 20 حسب جدول الملف.
أُضيف سقف Carfilzomib على مساحة سطح جسم 2.2 م² حسب النشرة (ليس في ملف المركز). احذفه إن لم يكن معتمداً لديكم.
إماهة 500 مل NaCl 0.9% قبل كل جرعة Carfilzomib وبعدها في الدورة 1.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Carfilzomib$q$, 20, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, 44, true, $q$جرعة البدء في الدورة 1 فقط$q$, $q$1$q$, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Carfilzomib$q$, 56, $q$mg/m2$q$, $q$IV$q$, $q$8,15$q$, 123, true, null, $q$1$q$, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Carfilzomib$q$, 56, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15$q$, 123, true, null, $q$2-12$q$, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Carfilzomib$q$, 56, $q$mg/m2$q$, $q$IV$q$, $q$1,15$q$, 123, true, $q$كل أسبوعين$q$, $q$13-20$q$, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Lenalidomide$q$, 25, $q$mg$q$, $q$PO$q$, $q$1-21$q$, null, false, null, null, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 40, $q$mg$q$, $q$PO$q$, $q$1,8,15,22$q$, null, false, $q$قبل Carfilzomib بـ30 دقيقة$q$, $q$1-9$q$, 6);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 40, $q$mg$q$, $q$PO$q$, $q$1,8,15$q$, null, false, $q$قبل Carfilzomib بـ30 دقيقة$q$, $q$10-20$q$, 7);
end $do$;

-- Dara-Kd  (الملف: dara-kd)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Dara-Kd$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Dara-Kd$q$, $q$الورم النقوي المتعدد منتكس أو مقاوم$q$, $q$mixed$q$, 28, 12, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Dara-KD). كل 28 يوماً: التحريض الدورتان 1–2، التدعيم 3–6، والصيانة من 7.
⚠ جدول الصيانة في الملف لا يكتب جرعة Carfilzomib؛ أُدخلت 70 ملغ/م² كما في المرحلتين السابقتين.
⚠ الصيانة «7 فما بعد»؛ أُدخلت حتى الدورة 12 حسب جدول الملف.
أُضيف سقف Carfilzomib على مساحة سطح جسم 2.2 م² حسب النشرة (ليس في ملف المركز). احذفه إن لم يكن معتمداً لديكم.
قبل Daratumumab: Paracetamol ومضاد هيستامين والستيرويد حسب سياسة المركز، وتسجيل زمرة الدم وفحص التوافق قبل أول جرعة (يتداخل مع اختبار كومبس).
إماهة 250–500 مل NaCl 0.9% قبل Carfilzomib وبعده.
وقاية من PJP ومن الهربس النطاقي (Aciclovir) طوال العلاج مع Daratumumab والستيرويد.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Daratumumab$q$, 16, $q$mg/kg$q$, $q$IV$q$, $q$1,8,15,22$q$, null, true, null, $q$1-2$q$, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Daratumumab$q$, 16, $q$mg/kg$q$, $q$IV$q$, $q$1,15$q$, null, true, null, $q$3-6$q$, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Daratumumab$q$, 16, $q$mg/kg$q$, $q$IV$q$, $q$1$q$, null, true, null, $q$7-12$q$, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Carfilzomib$q$, 20, $q$mg/m2$q$, $q$IV$q$, $q$1$q$, 44, true, $q$جرعة البدء في الدورة 1 فقط$q$, $q$1$q$, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Carfilzomib$q$, 70, $q$mg/m2$q$, $q$IV$q$, $q$8,15$q$, 154, true, null, $q$1$q$, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Carfilzomib$q$, 70, $q$mg/m2$q$, $q$IV$q$, $q$1,8,15$q$, 154, true, null, $q$2-12$q$, 6);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 40, $q$mg$q$, $q$PO$q$, $q$1,8,15,22$q$, null, false, $q$فموي أو وريدي$q$, null, 7);
end $do$;

-- Dara-Rd  (الملف: dara-rd)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Dara-Rd$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Dara-Rd$q$, $q$الورم النقوي المتعدد منتكس أو مقاوم$q$, $q$mixed$q$, 28, 12, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Dara-RD). كل 28 يوماً: التحريض الدورتان 1–2، التدعيم 3–6، والصيانة من 7.
⚠ جدول الصيانة يضع Dexamethasone في الأيام 8 و15 و22 دون اليوم 1 (يوم Daratumumab). أُدخل كما هو؛ أضف اليوم 1 إن كان سهواً.
⚠ Dexamethasone في الملف 20 ملغ أسبوعياً؛ في POLLUX 40 ملغ (20 ملغ لمن تجاوز 75 سنة).
⚠ الصيانة «7 فما بعد»؛ أُدخلت حتى الدورة 12 حسب جدول الملف.
قبل Daratumumab: Paracetamol ومضاد هيستامين والستيرويد حسب سياسة المركز، وتسجيل زمرة الدم وفحص التوافق قبل أول جرعة (يتداخل مع اختبار كومبس).
وقاية من PJP ومن الهربس النطاقي (Aciclovir) طوال العلاج مع Daratumumab والستيرويد.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Daratumumab$q$, 16, $q$mg/kg$q$, $q$IV$q$, $q$1,8,15,22$q$, null, true, null, $q$1-2$q$, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Daratumumab$q$, 16, $q$mg/kg$q$, $q$IV$q$, $q$1,15$q$, null, true, null, $q$3-6$q$, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Daratumumab$q$, 16, $q$mg/kg$q$, $q$IV$q$, $q$1$q$, null, true, null, $q$7-12$q$, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Lenalidomide$q$, 25, $q$mg$q$, $q$PO$q$, $q$1-21$q$, null, false, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 20, $q$mg$q$, $q$PO$q$, $q$1,8,15,22$q$, null, false, $q$فموي أو وريدي$q$, $q$1-6$q$, 5);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 20, $q$mg$q$, $q$PO$q$, $q$8,15,22$q$, null, false, $q$فموي أو وريدي$q$, $q$7-12$q$, 6);
end $do$;

-- Dara-VRd (غير مرشح للزرع)  (الملف: dara-vrd_for_non_transplant)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Dara-VRd (غير مرشح للزرع)$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Dara-VRd (غير مرشح للزرع)$q$, $q$الورم النقوي المتعدد حديث التشخيص غير مرشح لزرع الخلايا الجذعية$q$, $q$mixed$q$, 21, 8, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Dara-VRD). كل 21 يوماً: التحريض الدورتان 1–2، والتدعيم 3–8.
قبل Daratumumab: Paracetamol ومضاد هيستامين والستيرويد حسب سياسة المركز، وتسجيل زمرة الدم وفحص التوافق قبل أول جرعة (يتداخل مع اختبار كومبس).
وقاية من PJP ومن الهربس النطاقي (Aciclovir) طوال العلاج مع Daratumumab والستيرويد.$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Daratumumab$q$, 16, $q$mg/kg$q$, $q$IV$q$, $q$1,8,15$q$, null, true, null, $q$1-2$q$, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Daratumumab$q$, 16, $q$mg/kg$q$, $q$IV$q$, $q$1$q$, null, true, null, $q$3-8$q$, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Bortezomib$q$, 1.3, $q$mg/m2$q$, $q$SC$q$, $q$1,4,8,11$q$, null, true, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Lenalidomide$q$, 25, $q$mg$q$, $q$PO$q$, $q$1-14$q$, null, false, null, null, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 20, $q$mg$q$, $q$PO$q$, $q$1,2,4,5,8,9,11,12$q$, null, false, $q$فموي أو وريدي$q$, null, 5);
end $do$;

-- Isa-Pd  (الملف: isa_pd)
do $do$ declare v uuid; begin
  if exists (select 1 from public.protocols where name = $q$Isa-Pd$q$) then return; end if;
  insert into public.protocols(name, disease, kind, cycle_length_days, total_cycles, notes)
  values ($q$Isa-Pd$q$, $q$الورم النقوي المتعدد$q$, $q$mixed$q$, 28, 12, $q$المصدر: ملف بروتوكول مركز الناصرية لأمراض الدم (Isatuximab + Pomalidomide + Dexamethasone). كل 28 يوماً حتى تقدم المرض أو السمية؛ أُدخلت 12 دورة.
قبل Isatuximab: Paracetamol 1 غ فموي، Montelukast 10 ملغ فموي، Chlorphenamine 10 ملغ وريدي، Famotidine 40 ملغ فموي، وDexamethasone حسب الجدول.
⚠ Dexamethasone في الملف 20 ملغ، ومن الدورة 2 في اليومين 1 و15 فقط. في ICARIA 40 ملغ أسبوعياً (20 ملغ لمن بلغ 75 سنة).$q$) returning id into v;
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Isatuximab$q$, 10, $q$mg/kg$q$, $q$IV$q$, $q$1,8,15,22$q$, null, true, null, $q$1$q$, 1);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Isatuximab$q$, 10, $q$mg/kg$q$, $q$IV$q$, $q$1,15$q$, null, true, null, $q$2-12$q$, 2);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Pomalidomide$q$, 4, $q$mg$q$, $q$PO$q$, $q$1-21$q$, null, false, null, null, 3);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 20, $q$mg$q$, $q$PO$q$, $q$1,8,15,22$q$, null, false, $q$فموي أو وريدي$q$, $q$1$q$, 4);
  insert into public.protocol_drugs(protocol_id, drug_name, dose_value, dose_unit, route, days, max_dose, is_mixed, instructions, cycles, sort)
  values (v, $q$Dexamethasone$q$, 20, $q$mg$q$, $q$PO$q$, $q$1,15$q$, null, false, $q$فموي أو وريدي$q$, $q$2-12$q$, 5);
end $do$;
