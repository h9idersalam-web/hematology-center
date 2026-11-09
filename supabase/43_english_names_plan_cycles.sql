-- =====================================================================
-- 43: (بطلب صاحب المشروع 2026/11/9)
--   1. أسماء البروتوكولات بالإنكليزية (تحريض ← Induction، تدعيم ← Consolidation، صيانة ← Maintenance...)،
--      وتُحدَّث الأسماء المنسوخة في الخطط (treatments.protocol_name) بالمثل.
--   2. create_plan_at: إنشاء الخطة من الـCycle الحالي للمريض؛ الـCycles السابقة تُسجَّل «مُعطاة» (قبل التسجيل)،
--      ويُحسب جدول القادمة من تاريخ الـCycle الحالي بالمدة المعتمدة.
--   3. update_plan: تعديل كل شيء في الخطة: ما في edit_plan (الملف 42)، والمدة بين الـCycles، وعدد الـCycles.
--   لا أوامر drop ولا حذف بيانات.
-- =====================================================================

-- 1. الأسماء
with m(old_name, new_name) as (values
  ('ABVD (مسودة قديمة)', 'ABVD (old draft)'),
  ('APL أطفال AIDA2000: تحريض', 'APL Pediatric AIDA2000: Induction'),
  ('APL أطفال AIDA2000: تدعيم', 'APL Pediatric AIDA2000: Consolidation'),
  ('APL أطفال AIDA2000: صيانة', 'APL Pediatric AIDA2000: Maintenance'),
  ('APL: ATRA + ATO تحريض', 'APL: ATRA + ATO Induction'),
  ('APL: ATRA + ATO تدعيم', 'APL: ATRA + ATO Consolidation'),
  ('Dara-VRd (غير مرشح للزرع)', 'Dara-VRd (transplant-ineligible)'),
  ('Decitabine + Venetoclax أسبوعي', 'Decitabine + Venetoclax (weekly)'),
  ('Ibrutinib صيانة بعد IBER', 'Ibrutinib Maintenance after IBER'),
  ('ICE (مجزأ)', 'ICE (fractionated)'),
  ('ICE (مجزأ) (AUC ملغى 2026-11-07 02:04)', 'ICE (fractionated) (AUC removed 2026-11-07 02:04)'),
  ('Pembro-ICE (مجزأ)', 'Pembro-ICE (fractionated)'),
  ('Pembro-ICE (مجزأ) (AUC ملغى 2026-11-07 02:04)', 'Pembro-ICE (fractionated) (AUC removed 2026-11-07 02:04)'),
  ('Pembro-ICE (مجزأ) (Mesna قديم 2026-11-08)', 'Pembro-ICE (fractionated) (old Mesna 2026-11-08)'),
  ('Pola-R-ICE (AUC ملغى 2026-11-07 02:04)', 'Pola-R-ICE (AUC removed 2026-11-07 02:04)'),
  ('Pola-R-ICE (Mesna قديم 2026-11-08)', 'Pola-R-ICE (old Mesna 2026-11-08)'),
  ('R-CHOP-21 (مسودة قديمة)', 'R-CHOP-21 (old draft)'),
  ('R-Cladribine أسبوعي (HCL)', 'R-Cladribine weekly (HCL)'),
  ('R-CODOX-M / R-IVAC (خطورة عالية)', 'R-CODOX-M / R-IVAC (high risk)'),
  ('R-CODOX-M ×3 (خطورة منخفضة)', 'R-CODOX-M ×3 (low risk)'),
  ('TEC (AUC ملغى 2026-11-07 02:04)', 'TEC (AUC removed 2026-11-07 02:04)'),
  ('UKALL صيانة (UKALL14)', 'UKALL14 Maintenance'),
  ('UKALL14 تحريض المرحلة 1', 'UKALL14 Induction Phase 1'),
  ('UKALL14 تحريض المرحلة 2', 'UKALL14 Induction Phase 2'),
  ('UKALL14 تدعيم 1 و2', 'UKALL14 Consolidation 1 & 2'),
  ('UKALL14 تدعيم 3', 'UKALL14 Consolidation 3'),
  ('UKALL14 تدعيم 4', 'UKALL14 Consolidation 4'),
  ('UKALL2011 MTX عالي الجرعة', 'UKALL2011 High-dose MTX'),
  ('UKALL2011 التكثيف المتأخر', 'UKALL2011 Delayed Intensification'),
  ('UKALL2011 تحريض المرحلة 1', 'UKALL2011 Induction Phase 1'),
  ('UKALL2011 تحريض المرحلة 2', 'UKALL2011 Induction Phase 2'),
  ('UKALL2011 صيانة مرحلية (بديل MTX عالي الجرعة)', 'UKALL2011 Interim Maintenance (alternative to HD-MTX)'),
  ('UKALL60+ تحريض وتدعيم (المسار D)', 'UKALL60+ Induction & Consolidation (Arm D)'),
  ('UKALL60+ صيانة (المسار D)', 'UKALL60+ Maintenance (Arm D)'),
  ('Ven + Azacitidine تدعيم', 'Ven + Azacitidine Consolidation'),
  ('Ven + CLAD/LDAC تحريض', 'Ven + CLAD/LDAC Induction'),
  ('Ven + CLAD/LDAC تدعيم', 'Ven + CLAD/LDAC Consolidation'),
  ('VRd (مسودة قديمة)', 'VRd (old draft)'))
update public.treatments t set protocol_name = m.new_name from m where t.protocol_name = m.old_name;
with m(old_name, new_name) as (values
  ('ABVD (مسودة قديمة)', 'ABVD (old draft)'),
  ('APL أطفال AIDA2000: تحريض', 'APL Pediatric AIDA2000: Induction'),
  ('APL أطفال AIDA2000: تدعيم', 'APL Pediatric AIDA2000: Consolidation'),
  ('APL أطفال AIDA2000: صيانة', 'APL Pediatric AIDA2000: Maintenance'),
  ('APL: ATRA + ATO تحريض', 'APL: ATRA + ATO Induction'),
  ('APL: ATRA + ATO تدعيم', 'APL: ATRA + ATO Consolidation'),
  ('Dara-VRd (غير مرشح للزرع)', 'Dara-VRd (transplant-ineligible)'),
  ('Decitabine + Venetoclax أسبوعي', 'Decitabine + Venetoclax (weekly)'),
  ('Ibrutinib صيانة بعد IBER', 'Ibrutinib Maintenance after IBER'),
  ('ICE (مجزأ)', 'ICE (fractionated)'),
  ('ICE (مجزأ) (AUC ملغى 2026-11-07 02:04)', 'ICE (fractionated) (AUC removed 2026-11-07 02:04)'),
  ('Pembro-ICE (مجزأ)', 'Pembro-ICE (fractionated)'),
  ('Pembro-ICE (مجزأ) (AUC ملغى 2026-11-07 02:04)', 'Pembro-ICE (fractionated) (AUC removed 2026-11-07 02:04)'),
  ('Pembro-ICE (مجزأ) (Mesna قديم 2026-11-08)', 'Pembro-ICE (fractionated) (old Mesna 2026-11-08)'),
  ('Pola-R-ICE (AUC ملغى 2026-11-07 02:04)', 'Pola-R-ICE (AUC removed 2026-11-07 02:04)'),
  ('Pola-R-ICE (Mesna قديم 2026-11-08)', 'Pola-R-ICE (old Mesna 2026-11-08)'),
  ('R-CHOP-21 (مسودة قديمة)', 'R-CHOP-21 (old draft)'),
  ('R-Cladribine أسبوعي (HCL)', 'R-Cladribine weekly (HCL)'),
  ('R-CODOX-M / R-IVAC (خطورة عالية)', 'R-CODOX-M / R-IVAC (high risk)'),
  ('R-CODOX-M ×3 (خطورة منخفضة)', 'R-CODOX-M ×3 (low risk)'),
  ('TEC (AUC ملغى 2026-11-07 02:04)', 'TEC (AUC removed 2026-11-07 02:04)'),
  ('UKALL صيانة (UKALL14)', 'UKALL14 Maintenance'),
  ('UKALL14 تحريض المرحلة 1', 'UKALL14 Induction Phase 1'),
  ('UKALL14 تحريض المرحلة 2', 'UKALL14 Induction Phase 2'),
  ('UKALL14 تدعيم 1 و2', 'UKALL14 Consolidation 1 & 2'),
  ('UKALL14 تدعيم 3', 'UKALL14 Consolidation 3'),
  ('UKALL14 تدعيم 4', 'UKALL14 Consolidation 4'),
  ('UKALL2011 MTX عالي الجرعة', 'UKALL2011 High-dose MTX'),
  ('UKALL2011 التكثيف المتأخر', 'UKALL2011 Delayed Intensification'),
  ('UKALL2011 تحريض المرحلة 1', 'UKALL2011 Induction Phase 1'),
  ('UKALL2011 تحريض المرحلة 2', 'UKALL2011 Induction Phase 2'),
  ('UKALL2011 صيانة مرحلية (بديل MTX عالي الجرعة)', 'UKALL2011 Interim Maintenance (alternative to HD-MTX)'),
  ('UKALL60+ تحريض وتدعيم (المسار D)', 'UKALL60+ Induction & Consolidation (Arm D)'),
  ('UKALL60+ صيانة (المسار D)', 'UKALL60+ Maintenance (Arm D)'),
  ('Ven + Azacitidine تدعيم', 'Ven + Azacitidine Consolidation'),
  ('Ven + CLAD/LDAC تحريض', 'Ven + CLAD/LDAC Induction'),
  ('Ven + CLAD/LDAC تدعيم', 'Ven + CLAD/LDAC Consolidation'),
  ('VRd (مسودة قديمة)', 'VRd (old draft)'))
update public.protocols p set name = m.new_name from m
 where p.name = m.old_name and not exists (select 1 from public.protocols x where x.name = m.new_name);

-- الـCycles السابقة للـCycle الحالي: تُسجَّل مُعطاة قبل التسجيل في البرنامج، بتواريخ محسوبة رجوعاً
create or replace function public._add_prior_cycles(p_tid uuid, p_first int, p_start date, p_len int)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  for n in 1 .. coalesce(p_first, 1) - 1 loop
    insert into cycles(treatment_id, cycle_no, planned_date, status, postpone_reason)
    values (p_tid, n, p_start - (p_first - n) * p_len, 'given', 'أُعطيت قبل التسجيل في البرنامج')
    on conflict (treatment_id, cycle_no) do nothing;
  end loop;
end $$;
revoke all on function public._add_prior_cycles(uuid, int, date, int) from public, anon, authenticated;

-- 2. إنشاء الخطة من الـCycle الحالي (مثل create_plan في الملف 35 مع p_first_cycle)
create or replace function public.create_plan_at(p_patient uuid, p_protocol uuid, p_diagnosis text, p_icd10 text,
                                                 p_stage text, p_start date, p_disease_status text default null,
                                                 p_doses jsonb default null, p_first_cycle int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tid uuid; v_status text; v_pr protocols; r record; d protocol_drugs; v_new numeric;
begin
  perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist');
  if p_disease_status is not null and p_disease_status not in ('initial', 'relapse', 'maintenance') then
    raise exception 'حالة المرض غير صحيحة';
  end if;
  if exists (select 1 from treatments where patient_id = p_patient and status in ('active', 'pending_approval')) then
    raise exception 'للمريض خطة علاج قائمة، أوقفها أو غيّر البروتوكول بطلب تعديل';
  end if;
  if p_doses is not null and jsonb_typeof(p_doses) <> 'object' then raise exception 'صيغة الجرعات المعدّلة غير صحيحة'; end if;
  select * into v_pr from protocols where id = p_protocol;
  if v_pr.id is null then raise exception 'البروتوكول غير موجود'; end if;
  if coalesce(p_first_cycle, 1) < 1 or coalesce(p_first_cycle, 1) > v_pr.total_cycles then
    raise exception 'رقم الـCycle الحالي يجب أن يكون بين 1 و%', v_pr.total_cycles;
  end if;

  v_status := case when my_role() in ('specialist', 'senior_resident') or _is_real_chief() then 'active' else 'pending_approval' end;
  v_tid := _create_treatment(p_patient, p_protocol, p_diagnosis, p_icd10, p_stage, p_start, v_status, coalesce(p_first_cycle, 1));
  update treatments set disease_status = p_disease_status where id = v_tid;
  perform _add_prior_cycles(v_tid, coalesce(p_first_cycle, 1), p_start, v_pr.cycle_length_days);

  for r in select key, value from jsonb_each_text(coalesce(p_doses, '{}'::jsonb)) loop
    select * into d from protocol_drugs where id = r.key::uuid and protocol_id = p_protocol;
    if d.id is null then raise exception 'دواء غير موجود في هذا البروتوكول'; end if;
    begin v_new := r.value::numeric; exception when others then raise exception 'جرعة غير صحيحة لـ %', d.drug_name; end;
    if v_new is null or v_new <= 0 or v_new > 100000 then raise exception 'جرعة غير صحيحة لـ %', d.drug_name; end if;
    update cycle_doses cd set edited_from = cd.final_dose, final_dose = v_new, source = 'edited'
      from cycles c
     where c.id = cd.cycle_id and c.treatment_id = v_tid and cd.archived_at is null
       and cd.drug_name = d.drug_name and cd.route = d.route and cd.days = d.days and cd.sort = d.sort
       and cd.final_dose <> v_new;
  end loop;

  if v_status = 'pending_approval' then
    perform _notify_specialist(p_patient, 'approval', 'خطة علاج بانتظار موافقتك',
                               (select full_name from patients where id = p_patient), 'treatment', v_tid);
  elsif my_role() in ('senior_resident', 'chief_clinical_pharmacist') then
    perform _notify_specialist(p_patient, 'info',
                               case when my_role() = 'senior_resident' then 'أنشأ الطبيب المقيم خطة علاج' else 'أنشأ مسؤول الصيادلة السريريين خطة علاج' end,
                               (select full_name from patients where id = p_patient), 'treatment', v_tid);
  end if;
  return v_tid;
end $$;
revoke all on function public.create_plan_at(uuid, uuid, text, text, text, date, text, jsonb, int) from public, anon;
grant execute on function public.create_plan_at(uuid, uuid, text, text, text, date, text, jsonb, int) to authenticated;

-- 3. تعديل كل شيء في الخطة
create or replace function public.update_plan(p_tid uuid, p_diagnosis text, p_icd10 text, p_stage text,
                                              p_disease_status text, p_protocol uuid, p_cycle_no int,
                                              p_start date, p_reason text, p_cycle_length int, p_total_cycles int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_old treatments; v_t treatments; v_tid uuid; v_next record; v_last record; v_maxg int; n int; v_cid uuid;
        d protocol_drugs; v_calc record; v_ptotal int;
begin
  select * into v_old from treatments where id = p_tid;
  -- التشخيص والحالة والدرجة والبروتوكول ورقم الـCycle (يتحقق من الصلاحية ويرفض ما لا يجوز)
  v_tid := edit_plan(p_tid, p_diagnosis, p_icd10, p_stage, p_disease_status, p_protocol, p_cycle_no, p_start, p_reason);
  select * into v_t from treatments where id = v_tid for update;
  if v_tid <> p_tid then   -- أُنشئت خطة جديدة من الـCycle المختار: السابقة له تُسجَّل مُعطاة
    perform _add_prior_cycles(v_tid, coalesce(p_cycle_no, 1),
      (select min(planned_date) from cycles where treatment_id = v_tid and status in ('planned', 'held')), v_t.cycle_length_days);
  end if;

  -- المدة بين الـCycles: يبقى موعد الـCycle القادم، وتُعاد جدولة ما بعده
  if p_cycle_length is not null and p_cycle_length <> v_t.cycle_length_days then
    if p_cycle_length < 1 or p_cycle_length > 365 then raise exception 'المدة بين الـCycles بين 1 و365 يوماً'; end if;
    select cycle_no, planned_date into v_next from cycles where treatment_id = v_tid and status in ('planned', 'held') order by cycle_no limit 1;
    update treatments set cycle_length_days = p_cycle_length where id = v_tid;
    if v_next.cycle_no is not null then
      update cycles set planned_date = v_next.planned_date + (cycle_no - v_next.cycle_no) * p_cycle_length
       where treatment_id = v_tid and status in ('planned', 'held') and cycle_no > v_next.cycle_no;
    end if;
    v_t.cycle_length_days := p_cycle_length;
  end if;

  -- عدد الـCycles
  if p_total_cycles is not null and p_total_cycles <> v_t.total_cycles then
    if p_total_cycles < 1 or p_total_cycles > 120 then raise exception 'عدد الـCycles بين 1 و120'; end if;
    select coalesce(max(cycle_no), 0) into v_maxg from cycles where treatment_id = v_tid and status = 'given';
    if p_total_cycles < v_maxg then raise exception 'أُعطي حتى Cycle %، فلا يقل العدد عنه', v_maxg; end if;
    if p_total_cycles < v_t.total_cycles then
      if exists (select 1 from cycles c join cycle_doses cd on cd.cycle_id = c.id join administrations a on a.cycle_dose_id = cd.id
                  where c.treatment_id = v_tid and c.status in ('planned', 'held') and c.cycle_no > p_total_cycles) then
        raise exception 'توجد Cycle قيد الإعطاء ضمن ما سيُلغى';
      end if;
      update cycles set status = 'cancelled', postpone_reason = 'تقليل عدد الـCycles'
       where treatment_id = v_tid and status in ('planned', 'held') and cycle_no > p_total_cycles;
      update mixing_orders o set status = 'held', hold_reason = 'تقليل عدد الـCycles'
        from cycles cc where o.cycle_id = cc.id and cc.treatment_id = v_tid and cc.status = 'cancelled' and o.status <> 'sent';
    else
      select cycle_no, planned_date into v_last from cycles where treatment_id = v_tid and status <> 'cancelled' order by cycle_no desc limit 1;
      select total_cycles into v_ptotal from protocols where id = v_t.protocol_id;
      for n in v_t.total_cycles + 1 .. p_total_cycles loop
        insert into cycles(treatment_id, cycle_no, planned_date)
        values (v_tid, n, coalesce(v_last.planned_date, current_date) + (n - coalesce(v_last.cycle_no, v_t.total_cycles)) * v_t.cycle_length_days)
        on conflict (treatment_id, cycle_no) do update set status = 'planned', postpone_reason = null,
               planned_date = excluded.planned_date
        returning id into v_cid;
        if not exists (select 1 from cycle_doses where cycle_id = v_cid and archived_at is null) then
          for d in select * from protocol_drugs where protocol_id = v_t.protocol_id
                    and (cycles is null or n = any(days_list(cycles))
                         -- ما بعد عدد البروتوكول: أدوية آخر Cycle فيه
                         or (n > v_ptotal and v_ptotal = any(days_list(cycles))))
                    order by sort loop
            select * into v_calc from _calc_dose(d.dose_value, d.dose_unit, v_t.bsa, v_t.weight_kg, d.max_dose);
            insert into cycle_doses(cycle_id, drug_name, route, days, dose_value, dose_unit, calculated,
                                    final_dose, final_unit, capped, is_mixed, instructions, source, sort)
            values (v_cid, d.drug_name, d.route, d.days, d.dose_value, d.dose_unit, v_calc.calculated,
                    v_calc.final_dose, v_calc.final_unit, v_calc.capped, d.is_mixed, d.instructions, 'cycle1', d.sort);
          end loop;
        end if;
      end loop;
    end if;
    update treatments set total_cycles = p_total_cycles where id = v_tid;
    -- كل الـCycles أُعطيت بعد التقليل: تكتمل الخطة
    update treatments t set status = 'completed'
     where t.id = v_tid and not exists (select 1 from cycles c where c.treatment_id = t.id and c.status in ('planned', 'held'));
  end if;
  return v_tid;
end $$;
revoke all on function public.update_plan(uuid, text, text, text, text, uuid, int, date, text, int, int) from public, anon;
grant execute on function public.update_plan(uuid, text, text, text, text, uuid, int, date, text, int, int) to authenticated;
