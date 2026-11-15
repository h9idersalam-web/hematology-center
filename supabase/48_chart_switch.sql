-- =====================================================================
-- 48: إيقاف «صورة الطبلة» مؤقتاً (بطلب صاحب المشروع 2026/11/15) — مفتاح ثالث في «لوحة المدير › الأقسام»
--   - مفتاح chart في app_features (الملف 47)، يبدأ موقوفاً.
--   - موقوف: لا يُطلب من الصيدلي إرفاق صورة الطبلة عند اعتماد الجرعة (لا إشعار ولا مهمة)، ولا تُرفق صور جديدة.
--     الصور المرفقة من قبل تبقى محفوظة وتُعرض.
--   - التشغيل يعيد كل شيء كما كان للجرعات التي تُعتمد بعده.
--   يحتاج الملف 47. آمن للتشغيل أكثر من مرة، ولا يغيّر اختيار المدير بعد أول تشغيل.
-- =====================================================================

alter table public.app_features drop constraint if exists app_features_key_check;
alter table public.app_features add constraint app_features_key_check check (key in ('mixing', 'nursing', 'chart'));
insert into public.app_features(key, enabled) values ('chart', false) on conflict (key) do nothing;

-- التشغيل والإيقاف: المفتاح الثالث بلا دور مرتبط
create or replace function public.admin_set_feature(p_key text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role user_role; v_revoked int := 0; v_synced int := 0; c record;
begin
  perform _require_admin();
  if p_key not in ('mixing', 'nursing', 'chart') or p_enabled is null then raise exception 'قسم غير معروف'; end if;
  v_role := case p_key when 'mixing' then 'mixing_pharmacist'::user_role when 'nursing' then 'nurse'::user_role end;

  update app_features set enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
   where key = p_key and enabled is distinct from p_enabled;
  if not found then
    return jsonb_build_object('key', p_key, 'enabled', p_enabled, 'changed', false);
  end if;

  if not p_enabled and v_role is not null then
    update user_activation_codes set revoked_at = now(), revoke_reason = 'أُوقف قسم هذا الدور'
     where role = v_role and used_at is null and revoked_at is null;
    get diagnostics v_revoked = row_count;
  elsif p_enabled and p_key = 'mixing' then
    for c in select cy.id from cycles cy join treatments t on t.id = cy.treatment_id
              where cy.status in ('planned', 'held') and cy.doctor_approved_by is not null and t.status = 'active' loop
      perform _sync_mixing(c.id, null);
      v_synced := v_synced + 1;
    end loop;
  end if;

  return jsonb_build_object('key', p_key, 'enabled', p_enabled, 'changed', true,
                            'revoked_codes', v_revoked, 'synced_cycles', v_synced);
end $$;
revoke all on function public.admin_set_feature(text, boolean) from public, anon;
grant execute on function public.admin_set_feature(text, boolean) to authenticated;

-- لا تُرفق صورة طبلة جديدة والمفتاح موقوف (الصور السابقة باقية)
create or replace function public._guard_chart() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.chart_attachment_id is not null and new.chart_attachment_id is distinct from old.chart_attachment_id
     and not public.feature_on('chart') then
    raise exception 'صورة الطبلة موقوفة حالياً' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function public._guard_chart() from public, anon, authenticated;

drop trigger if exists cycles_chart_enabled on public.cycles;
create trigger cycles_chart_enabled before update of chart_attachment_id on public.cycles
  for each row execute function public._guard_chart();

-- اعتماد الجرعة (من الملف 39): مهمة صورة الطبلة للصيادلة فقط والمفتاح يعمل
create or replace function public.approve_cycle(p_cycle uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_name text; v_first uuid;
begin
  perform require_role('specialist', 'senior_resident', 'chief_clinical_pharmacist');
  if my_role() = 'chief_clinical_pharmacist' and not _is_real_chief() then
    raise exception 'اعتماد الجرعة لمسؤول الصيادلة الأصلي، لا للرديف' using errcode = '42501';
  end if;
  select * into v_c from cycles where id = p_cycle;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.status <> 'active' then raise exception 'خطة العلاج غير فعّالة'; end if;
  update cycles set doctor_approved_by = auth.uid(), doctor_approved_at = now()
   where id = p_cycle and status = 'planned' and doctor_approved_by is null;
  if not found then raise exception 'الدورة غير قابلة للاعتماد'; end if;

  perform _sync_mixing(p_cycle, auth.uid());
  select full_name into v_name from patients where id = v_t.patient_id;
  select id into v_first from mixing_orders where cycle_id = p_cycle order by day limit 1;
  if v_first is not null then
    perform _notify_roles(array['mixing_pharmacist']::user_role[], 'mixing', 'دورة معتمدة وصلت إلى المزج',
                          v_name || ' · ' || v_t.protocol_name || ' · الدورة ' || v_c.cycle_no, 'mixing_order', v_first);
  end if;
  if v_c.chart_attachment_id is null and public.feature_on('chart') then
    perform _notify_roles(array['clinical_pharmacist', 'chief_clinical_pharmacist']::user_role[], 'task',
                          'أرفق صورة الدورة من طبلة المريض',
                          v_name || ' · ' || v_t.protocol_name || ' · الدورة ' || v_c.cycle_no, 'cycle', p_cycle);
  end if;
end $$;
