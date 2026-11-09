-- =====================================================================
-- 46: مرة إعطاء البروتوكول (بطلب صاحب المشروع 2026/11/9)، مثل ICE (fractionated) يُعطى مرة ثانية:
--   «يُعطى للمرة الثانية» ← عدد الـCycles = عدد البروتوكول × 2، وأول Cycle في المرة الثانية رقمه 4 من 6
--   (لا 1 من 3)، وCycles المرة الأولى (1–3) تُسجَّل مُعطاة. أدوية كل Cycle تُحسب برقمها داخل المرة
--   (Cycle 4 = الأولى من المرة الثانية)، فتبقى قيود «يُعطى في Cycle 1 فقط» صحيحة.
--   p_first_cycle هنا رقم مطلق (مثلاً 4 أو 5 أو 6 في المرة الثانية من بروتوكول من 3).
--   لا أوامر drop.
-- =====================================================================
create or replace function public.create_plan_course(p_patient uuid, p_protocol uuid, p_diagnosis text, p_icd10 text,
                                                     p_stage text, p_start date, p_disease_status text default null,
                                                     p_doses jsonb default null, p_first_cycle int default 1, p_course int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pr protocols; v_per int; v_off int; v_tid uuid;
begin
  select * into v_pr from protocols where id = p_protocol;
  if v_pr.id is null then raise exception 'البروتوكول غير موجود'; end if;
  if coalesce(p_course, 1) < 1 or coalesce(p_course, 1) > 5 then raise exception 'مرة الإعطاء بين 1 و5'; end if;
  v_per := v_pr.total_cycles;
  v_off := (coalesce(p_course, 1) - 1) * v_per;
  if coalesce(p_first_cycle, 1) <= v_off or coalesce(p_first_cycle, 1) > v_off + v_per then
    raise exception 'الـCycle الحالي في المرة % يجب أن يكون بين % و%', p_course, v_off + 1, v_off + v_per;
  end if;
  -- الخطة برقم الـCycle داخل المرة (فتُختار أدوية كل Cycle صحيحاً)
  v_tid := create_plan_at(p_patient, p_protocol, p_diagnosis, p_icd10, p_stage, p_start, p_disease_status,
                          p_doses, coalesce(p_first_cycle, 1) - v_off);
  if v_off > 0 then
    -- الترقيم المطلق: 1..3 تصبح 4..6، وما قبلها (المرة الأولى) مُعطاة
    update cycles set cycle_no = cycle_no + v_off where treatment_id = v_tid;
    update treatments set total_cycles = v_per * p_course where id = v_tid;
    perform _add_prior_cycles(v_tid, p_first_cycle, p_start, v_pr.cycle_length_days);
    update cycles set postpone_reason = 'أُعطيت قبل التسجيل في البرنامج (المرة ' ||
                      case when cycle_no <= v_off then 'السابقة' else 'الحالية' end || ')'
     where treatment_id = v_tid and status = 'given' and postpone_reason = 'أُعطيت قبل التسجيل في البرنامج';
  end if;
  return v_tid;
end $$;
revoke all on function public.create_plan_course(uuid, uuid, text, text, text, date, text, jsonb, int, int) from public, anon;
grant execute on function public.create_plan_course(uuid, uuid, text, text, text, date, text, jsonb, int, int) to authenticated;
