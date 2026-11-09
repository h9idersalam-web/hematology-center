-- =====================================================================
-- 41: «تم إعطاء الجرعة بالكامل» لكل يوم على حدة (بطلب صاحب المشروع 2026/11/9)
--   - الجرعة التي تُعطى على عدة أيام يُؤكَّد اكتمال إعطائها يوماً بيوم (اليوم 1، ثم 2، ثم 3...).
--   - يؤكده: الممرض، وطبيب الاختصاص، والمقيم الأقدم، ومسؤول الصيادلة السريريين.
--   - شرطه: سُجّل إعطاء كل دواء في ذلك اليوم، وحلّ موعد اليوم، والجرعة معتمدة وفعّالة.
--   - تأكيد آخر يوم متبقٍّ يُغلق الجرعة كلها (مُعطاة) تلقائياً، كما يفعل complete_cycle.
--   - complete_cycle (إغلاق الجرعة كلها دفعة واحدة) يبقى كما هو للطبيب والمقيم الأقدم ومسؤول الصيادلة.
-- =====================================================================

create table if not exists public.cycle_day_completions (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references public.cycles(id),
  day           int  not null check (day between 1 and 120),
  completed_by  uuid references public.profiles(id) default auth.uid(),
  completed_at  timestamptz not null default now(),
  unique (cycle_id, day)
);
alter table public.cycle_day_completions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cycle_day_completions' and policyname = 'cycle_day_completions_read') then
    create policy cycle_day_completions_read on public.cycle_day_completions for select to authenticated using (public.is_active_user());
  end if;
end $$;
revoke all on public.cycle_day_completions from anon, public;
grant select on public.cycle_day_completions to authenticated;
create or replace trigger audit_cycle_day_completions after insert or update or delete on public.cycle_day_completions
  for each row execute function public.audit_trigger();
create or replace trigger no_delete_cycle_day_completions before delete on public.cycle_day_completions
  for each row execute function public.forbid_delete();

-- يعيد 'day' إن اكتمل هذا اليوم فقط، و'cycle' إن كان آخر يوم فأُغلقت الجرعة كلها
create or replace function public.complete_cycle_day(p_cycle uuid, p_day int)
returns text language plpgsql security definer set search_path = public as $$
declare v_c cycles; v_t treatments; v_days int[]; v_missing int;
begin
  perform require_role('nurse', 'specialist', 'senior_resident', 'chief_clinical_pharmacist');
  select * into v_c from cycles where id = p_cycle for update;
  if v_c.id is null then raise exception 'الدورة غير موجودة'; end if;
  select * into v_t from treatments where id = v_c.treatment_id;
  if v_t.status <> 'active' then raise exception 'خطة العلاج غير فعّالة'; end if;
  if v_c.status not in ('planned', 'held') then raise exception 'الدورة مغلقة من قبل'; end if;
  if v_c.doctor_approved_by is null then raise exception 'لم يعتمد الطبيب هذه الدورة بعد'; end if;

  select array_agg(distinct d order by d) into v_days
    from cycle_doses cd, unnest(days_list(cd.days)) as d
   where cd.cycle_id = p_cycle and cd.archived_at is null;
  if v_days is null or not (p_day = any(v_days)) then raise exception 'لا توجد أدوية في اليوم % من الدورة', p_day; end if;
  if v_c.planned_date + (p_day - 1) > (now() at time zone 'Asia/Baghdad')::date then
    raise exception 'لم يحن موعد اليوم % من الدورة بعد', p_day;
  end if;

  select count(*) into v_missing
    from cycle_doses cd
   where cd.cycle_id = p_cycle and cd.archived_at is null and p_day = any(days_list(cd.days))
     and not exists (select 1 from administrations a where a.cycle_dose_id = cd.id and a.day = p_day);
  if v_missing > 0 then
    raise exception 'لم يُسجَّل إعطاء كل أدوية اليوم % بعد (ناقص %)', p_day, v_missing;
  end if;

  insert into cycle_day_completions(cycle_id, day) values (p_cycle, p_day)
  on conflict (cycle_id, day) do nothing;
  if not found then raise exception 'سُجّل اكتمال اليوم % من قبل', p_day; end if;

  -- آخر يوم متبقٍّ: تُغلق الجرعة كلها
  if not exists (select 1 from unnest(v_days) d
                  where not exists (select 1 from cycle_day_completions x where x.cycle_id = p_cycle and x.day = d)) then
    update cycles set status = 'given' where id = p_cycle;
    update mixing_orders set status = 'held', hold_reason = 'أُغلقت الدورة'
     where cycle_id = p_cycle and status <> 'sent';
    update treatments t set status = 'completed'
     where t.id = v_t.id
       and not exists (select 1 from cycles c where c.treatment_id = t.id and c.status in ('planned', 'held'));
    return 'cycle';
  end if;
  return 'day';
end $$;
revoke all on function public.complete_cycle_day(uuid, int) from public, anon;
grant execute on function public.complete_cycle_day(uuid, int) to authenticated;
