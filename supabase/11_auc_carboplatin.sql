-- =====================================================================
--  جرعة AUC (Carboplatin) بمعادلة Calvert
--    الجرعة (ملغ) = AUC × (GFR + 25)
--    GFR بمعادلة Cockcroft-Gault:
--      (140 − العمر) × الوزن (كغ) × [0.85 للأنثى] ÷ (72 × كرياتينين المصل ملغ/دسل)
--    ويُقصّ GFR عند 125 مل/دقيقة، فأعلى جرعة لـ AUC 5 = 5 × 150 = 750 ملغ
--    (كما في ملف TEC للمركز). ثم يُطبَّق سقف البروتوكول إن وُجد (مثل 800 ملغ).
--  الكرياتينين: أحدث نتيجة Creatinine للمريض خلال آخر 30 يوماً (قسم التحاليل)؛
--  بوحدة mg/dL، وإن كانت µmol/L تُقسم على 88.4.
--  تُحسب الجرعة لكل الدورات عند إنشاء الخطة، وقبل كل دورة يعيد الطبيب حسابها
--  بأحدث كرياتينين (recalc_auc)، ويُسجَّل ذلك كتعديل طبيب في السجل.
--  يُشغَّل بعد الملف 10. آمن للتشغيل أكثر من مرة.
-- =====================================================================

alter table public.protocol_drugs drop constraint if exists protocol_drugs_dose_unit_check;
alter table public.protocol_drugs add constraint protocol_drugs_dose_unit_check
  check (dose_unit in ('mg/m2', 'mg/kg', 'mg', 'units/m2', 'units', 'AUC'));
do $$ begin
  alter table public.protocol_drugs add constraint protocol_drugs_auc_range
    check (dose_unit <> 'AUC' or dose_value between 1 and 10);
exception when duplicate_object then null; end $$;

-- طريقة حساب الجرعة مكتوبة مع الجرعة (لجرعات AUC: الكرياتينين وتاريخه وCrCl)
alter table public.cycle_doses add column if not exists calc_note text;

-- تصفية الكرياتينين بمعادلة Cockcroft-Gault (داخلي)
create or replace function public._crcl(p_patient uuid, p_weight numeric,
                                        out crcl numeric, out crcl_raw numeric, out scr numeric,
                                        out scr_date date, out age int)
language plpgsql stable security definer set search_path = public as $$
declare v_pt patients; v_l lab_results;
begin
  select * into v_pt from patients where id = p_patient;
  if v_pt.birth_date is null or v_pt.sex is null then
    raise exception 'جرعة AUC تحتاج تاريخ ميلاد المريض وجنسه؛ أدخلهما في ملف المريض';
  end if;
  select * into v_l from lab_results
   where patient_id = p_patient and lower(replace(test_name, ' ', '')) in ('creatinine', 's.creatinine', 'scr', 'serumcreatinine')
     and test_date between current_date - 30 and current_date
   order by test_date desc, created_at desc limit 1;
  if v_l.id is null then
    raise exception 'جرعة AUC تحتاج نتيجة كرياتينين خلال آخر 30 يوماً؛ أدخلها في التحاليل';
  end if;
  scr := case when lower(coalesce(v_l.unit, '')) like '%mol%' then round(v_l.value / 88.4, 2) else v_l.value end;
  if scr is null or scr <= 0 or scr > 20 then raise exception 'قيمة الكرياتينين غير صحيحة'; end if;
  age := extract(year from age(current_date, v_pt.birth_date))::int;
  if age < 1 or age > 120 then raise exception 'عمر المريض غير صحيح'; end if;
  crcl_raw := round((140 - age) * p_weight * (case when v_pt.sex = 'female' then 0.85 else 1 end) / (72 * scr), 0);
  crcl := least(greatest(crcl_raw, 0), 125);
  scr_date := v_l.test_date;
end $$;

-- جرعة AUC وسطر طريقة حسابها (داخلي)
create or replace function public._auc_dose(p_auc numeric, p_max numeric, p_crcl numeric, p_crcl_raw numeric,
                                            p_scr numeric, p_scr_date date, p_age int,
                                            out calculated numeric, out final_dose numeric,
                                            out capped boolean, out note text)
language plpgsql immutable set search_path = '' as $$
begin
  calculated := round(p_auc * (p_crcl + 25), 0);
  capped := p_max is not null and calculated > p_max;
  final_dose := case when capped then p_max else calculated end;
  note := 'AUC ' || p_auc::float8 || ' × (CrCl ' || p_crcl || ' + 25) = ' || calculated || ' mg'
       || case when p_crcl_raw > 125 then ' · CrCl المحسوب ' || p_crcl_raw || ' قُصّ إلى 125' else '' end
       || ' · كرياتينين ' || p_scr::float8 || ' ملغ/دسل بتاريخ ' || chr(8294) || to_char(p_scr_date, 'YYYY-MM-DD') || chr(8297)
       || ' · العمر ' || p_age;
end $$;

-- إنشاء الخطة: كما في الملف 10، وجرعات AUC من الكرياتينين
create or replace function public._create_treatment(p_patient uuid, p_protocol uuid, p_diagnosis text,
                                                    p_icd10 text, p_stage text, p_start date,
                                                    p_status text, p_first_cycle_no int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pt patients; v_pr protocols; v_tid uuid; v_bsa numeric; v_cid uuid;
  d protocol_drugs; c record; a record; v_cr record; v_has_cr boolean := false; n int;
begin
  select * into v_pt from patients where id = p_patient and archived_at is null;
  if v_pt.id is null then raise exception 'المريض غير موجود أو مؤرشف'; end if;
  if v_pt.height_cm is null or v_pt.weight_kg is null then
    raise exception 'أدخل طول المريض ووزنه أولاً';
  end if;
  select * into v_pr from protocols where id = p_protocol and archived_at is null;
  if v_pr.id is null then raise exception 'البروتوكول غير موجود'; end if;
  if v_pr.approved_by is null then raise exception 'البروتوكول لم يعتمده طبيب مختص بعد'; end if;

  v_bsa := bsa_mosteller(v_pt.height_cm, v_pt.weight_kg);
  if exists (select 1 from protocol_drugs where protocol_id = p_protocol and dose_unit = 'AUC') then
    select * into v_cr from _crcl(p_patient, v_pt.weight_kg);
    v_has_cr := true;
  end if;

  insert into treatments(patient_id, protocol_id, protocol_name, diagnosis, icd10, stage,
                         cycle_length_days, total_cycles, start_date, height_cm, weight_kg, bsa, status,
                         approved_by)
  values (p_patient, p_protocol, v_pr.name, p_diagnosis, p_icd10, p_stage,
          v_pr.cycle_length_days, v_pr.total_cycles, p_start, v_pt.height_cm, v_pt.weight_kg, v_bsa, p_status,
          case when p_status = 'active' then auth.uid() end)
  returning id into v_tid;

  for n in p_first_cycle_no .. v_pr.total_cycles loop
    insert into cycles(treatment_id, cycle_no, planned_date)
    values (v_tid, n, p_start + (n - p_first_cycle_no) * v_pr.cycle_length_days)
    returning id into v_cid;

    for d in select * from protocol_drugs
              where protocol_id = p_protocol
                and (cycles is null or n = any(days_list(cycles)))
              order by sort loop
      if d.dose_unit = 'AUC' then
        select * into a from _auc_dose(d.dose_value, d.max_dose, v_cr.crcl, v_cr.crcl_raw, v_cr.scr, v_cr.scr_date, v_cr.age);
        insert into cycle_doses(cycle_id, drug_name, route, days, dose_value, dose_unit, calculated,
                                final_dose, final_unit, capped, is_mixed, instructions, calc_note, source, sort)
        values (v_cid, d.drug_name, d.route, d.days, d.dose_value, d.dose_unit, a.calculated,
                a.final_dose, 'mg', a.capped, d.is_mixed, d.instructions,
                a.note || case when n > p_first_cycle_no then ' · يُعاد حسابها بأحدث كرياتينين قبل الدورة' else '' end,
                case when n = p_first_cycle_no then 'protocol' else 'cycle1' end, d.sort);
      else
        select * into c from _calc_dose(d.dose_value, d.dose_unit, v_bsa, v_pt.weight_kg, d.max_dose);
        insert into cycle_doses(cycle_id, drug_name, route, days, dose_value, dose_unit, calculated,
                                final_dose, final_unit, capped, is_mixed, instructions, source, sort)
        values (v_cid, d.drug_name, d.route, d.days, d.dose_value, d.dose_unit, c.calculated,
                c.final_dose, c.final_unit, c.capped, d.is_mixed, d.instructions,
                case when n = p_first_cycle_no then 'protocol' else 'cycle1' end, d.sort);
      end if;
    end loop;
  end loop;
  return v_tid;
end $$;

-- إعادة حساب جرعات AUC لدورة بأحدث كرياتينين (طبيب الاختصاص والمقيم الأقدم)
-- يُسجَّل كتعديل طبيب، ويُسقط اعتماد الدورة السابق كأي تعديل جرعة
create or replace function public.recalc_auc(p_cycle uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_cr record; a record; d cycle_doses; v_items jsonb := '[]'; v_n int := 0;
begin
  perform require_role('specialist', 'senior_resident');
  select * into v_c from cycles where id = p_cycle;
  if v_c.id is null then raise exception 'الدورة غير موجودة'; end if;
  if v_c.status not in ('planned', 'held') then raise exception 'لا يُعاد الحساب لدورة أُعطيت أو أُلغيت'; end if;
  select * into v_t from treatments where id = v_c.treatment_id;
  if not exists (select 1 from cycle_doses where cycle_id = p_cycle and dose_unit = 'AUC' and archived_at is null) then
    raise exception 'لا توجد جرعة AUC في هذه الدورة';
  end if;
  -- الوزن الحالي للمريض، لأن الوزن قد يتغير بين الدورات
  select * into v_cr from _crcl(v_t.patient_id, (select weight_kg from patients where id = v_t.patient_id));

  for d in select * from cycle_doses where cycle_id = p_cycle and dose_unit = 'AUC' and archived_at is null loop
    select * into a from _auc_dose(d.dose_value,
                                   (select pd.max_dose from protocol_drugs pd where pd.protocol_id = v_t.protocol_id
                                     and pd.sort = d.sort and pd.drug_name = d.drug_name limit 1),
                                   v_cr.crcl, v_cr.crcl_raw, v_cr.scr, v_cr.scr_date, v_cr.age);
    update cycle_doses set calculated = a.calculated, capped = a.capped, calc_note = a.note where id = d.id;
    if a.final_dose <> d.final_dose then
      v_items := v_items || jsonb_build_object('kind', 'dose', 'target_dose_id', d.id,
                                               'new_value', a.final_dose::text, 'apply_onward', false);
      v_n := v_n + 1;
    end if;
  end loop;

  if v_n > 0 then
    perform doctor_edit(p_cycle, v_items, 'إعادة حساب جرعة AUC بكرياتينين ' || v_cr.scr::float8
                                         || ' بتاريخ ' || chr(8294) || to_char(v_cr.scr_date, 'YYYY-MM-DD') || chr(8297) || ' (CrCl ' || v_cr.crcl || ')');
  end if;
  return v_n;
end $$;

revoke all on function public._crcl(uuid, numeric) from public, anon, authenticated;
revoke all on function public._auc_dose(numeric, numeric, numeric, numeric, numeric, date, int) from public, anon, authenticated;
revoke all on function public._create_treatment(uuid, uuid, text, text, text, date, text, int) from public, anon, authenticated;
revoke all on function public.recalc_auc(uuid) from public, anon;
grant execute on function public.recalc_auc(uuid) to authenticated;
