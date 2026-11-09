-- =====================================================================
-- 42: تعديل خطة العلاج بعد إدخالها (بطلب صاحب المشروع 2026/11/9)
--   يعدّل: التشخيص، وحالة المرض، ودرجة المرض، والبروتوكول، ورقم الجرعة (الدورة) الحالية داخل البروتوكول.
--   يحق لـ: مدير البرنامج، وطبيب الاختصاص، والمقيم الأقدم، ومسؤول الصيادلة السريريين الأصلي (لا الرديف).
--   - التشخيص والحالة والدرجة: تُعدَّل في الخطة نفسها.
--   - البروتوكول أو رقم الجرعة: تُوقَف الخطة الحالية (تبقى في «خطط سابقة» بسبب التعديل) وتُنشأ خطة
--     جديدة تبدأ من رقم الجرعة المختار بتاريخ تختاره، بالجرعات الدوائية المحسوبة من جديد. يُرفض إن كانت
--     جرعة قيد الإعطاء (سُجّل إعطاء بعض أدويتها ولم تُغلق).
--   كل تعديل يُسجَّل في سجل التعديلات، ويُبلَّغ الطبيب المختص إن عدّلها غيره.
-- =====================================================================
create or replace function public.edit_plan(p_tid uuid, p_diagnosis text, p_icd10 text, p_stage text,
                                            p_disease_status text, p_protocol uuid, p_cycle_no int,
                                            p_start date default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_t treatments; v_next record; v_pr protocols; v_new uuid; v_restructure boolean; v_sp uuid;
begin
  if not (is_admin() or my_role() in ('specialist', 'senior_resident') or _is_real_chief()) then
    raise exception 'تعديل الخطة للمدير وطبيب الاختصاص والمقيم الأقدم ومسؤول الصيادلة السريريين' using errcode = '42501';
  end if;
  select * into v_t from treatments where id = p_tid for update;
  if v_t.id is null then raise exception 'الخطة غير موجودة'; end if;
  if v_t.status not in ('active', 'pending_approval') then raise exception 'الخطة ليست قائمة'; end if;
  if exists (select 1 from patients where id = v_t.patient_id and archived_at is not null) then raise exception 'ملف المريض مؤرشف'; end if;
  if nullif(trim(coalesce(p_diagnosis, '')), '') is null then raise exception 'اختر التشخيص'; end if;
  if p_disease_status is not null and p_disease_status not in ('initial', 'relapse', 'maintenance') then
    raise exception 'حالة المرض غير صحيحة';
  end if;

  select cycle_no, planned_date into v_next from cycles
   where treatment_id = p_tid and status in ('planned', 'held') order by cycle_no limit 1;
  v_restructure := (p_protocol is not null and p_protocol <> v_t.protocol_id)
                or (p_cycle_no is not null and p_cycle_no is distinct from v_next.cycle_no);

  if not v_restructure then
    update treatments set diagnosis = trim(p_diagnosis), icd10 = nullif(trim(coalesce(p_icd10, '')), ''),
                          stage = nullif(trim(coalesce(p_stage, '')), ''), disease_status = p_disease_status
     where id = p_tid;
    v_new := p_tid;
  else
    if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'اكتب سبب تغيير البروتوكول أو رقم الجرعة'; end if;
    select * into v_pr from protocols where id = coalesce(p_protocol, v_t.protocol_id) and archived_at is null and approved_by is not null;
    if v_pr.id is null then raise exception 'البروتوكول غير معتمد أو مؤرشف'; end if;
    if coalesce(p_cycle_no, 1) < 1 or coalesce(p_cycle_no, 1) > v_pr.total_cycles then
      raise exception 'رقم الجرعة يجب أن يكون بين 1 و%', v_pr.total_cycles;
    end if;
    if exists (select 1 from cycles c join cycle_doses cd on cd.cycle_id = c.id join administrations a on a.cycle_dose_id = cd.id
                where c.treatment_id = p_tid and c.status in ('planned', 'held')) then
      raise exception 'توجد جرعة قيد الإعطاء: أكمل إعطاءها أو أغلقها أولاً';
    end if;
    update treatments set status = 'stopped', stop_reason = 'تعديل الخطة: ' || trim(p_reason) where id = p_tid;
    update cycles set status = 'cancelled', postpone_reason = 'تعديل الخطة'
     where treatment_id = p_tid and status in ('planned', 'held');
    update mixing_orders o set status = 'held', hold_reason = 'تعديل الخطة'
      from cycles c where o.cycle_id = c.id and c.treatment_id = p_tid and c.status = 'cancelled' and o.status <> 'sent';
    v_new := _create_treatment(v_t.patient_id, v_pr.id, trim(p_diagnosis), nullif(trim(coalesce(p_icd10, '')), ''),
                               nullif(trim(coalesce(p_stage, '')), ''),
                               coalesce(p_start, v_next.planned_date, (now() at time zone 'Asia/Baghdad')::date),
                               v_t.status, coalesce(p_cycle_no, 1));
    update treatments set disease_status = p_disease_status,
                          approved_by = case when v_t.status = 'active' then coalesce(v_t.approved_by, auth.uid()) end
     where id = v_new;
  end if;

  select specialist_id into v_sp from patients where id = v_t.patient_id;
  if v_sp is not null and v_sp <> auth.uid() then
    perform _notify(v_sp, 'info', 'عُدّلت خطة العلاج' || case when v_restructure then ' (البروتوكول أو رقم الجرعة)' else '' end,
                    (select full_name from patients where id = v_t.patient_id), 'patient', v_t.patient_id);
  end if;
  return v_new;
end $$;
revoke all on function public.edit_plan(uuid, text, text, text, text, uuid, int, date, text) from public, anon;
grant execute on function public.edit_plan(uuid, text, text, text, text, uuid, int, date, text) to authenticated;
