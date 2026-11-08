-- =====================================================================
-- 33: الإبلاغ عن تفاعل دوائي بعد تسجيل الإعطاء (زر «الإبلاغ عن تفاعل دوائي» في شاشة إعطاء الجرعة)
--     يُضاف وصف التفاعل إلى سجل الإعطاء (ولا يُمحى ما قبله)، ويصل تنبيه فوري للطبيب والصيادلة.
--     التعديل مسجّل في audit_log بالمشغّل الموجود على جدول administrations.
-- =====================================================================
create or replace function public.report_reaction(p_admin uuid, p_reaction text)
returns void language plpgsql security definer set search_path = public as $$
declare v_a administrations; v_drug text; v_name text; v_txt text := nullif(trim(p_reaction), '');
begin
  perform require_role('nurse');
  if v_txt is null then raise exception 'صف التفاعل'; end if;
  if length(v_txt) > 1000 then raise exception 'وصف التفاعل طويل جداً'; end if;
  select * into v_a from administrations where id = p_admin;
  if v_a.id is null then raise exception 'سجل الإعطاء غير موجود'; end if;
  if v_a.given_at < now() - interval '7 days' then raise exception 'مضى أكثر من 7 أيام على الإعطاء'; end if;
  update administrations
     set reaction = case when reaction is null then v_txt
                         else reaction || E'\n' || to_char(now() at time zone 'Asia/Baghdad', 'HH24:MI') || ': ' || v_txt end
   where id = p_admin;
  select drug_name into v_drug from cycle_doses where id = v_a.cycle_dose_id;
  select full_name into v_name from patients where id = v_a.patient_id;
  perform _notify_all('alert', 'تفاعل أثناء الإعطاء: ' || v_name, v_drug || ': ' || v_txt, 'patient', v_a.patient_id);
end $$;

revoke all on function public.report_reaction(uuid, text) from public, anon;
grant execute on function public.report_reaction(uuid, text) to authenticated;
