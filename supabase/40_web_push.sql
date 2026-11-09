-- =====================================================================
-- 40: إشعارات Push والتطبيق مغلق (بطلب صاحب المشروع 2026/11/9)
--   - كل جهاز يسمح بالإشعارات يُسجَّل اشتراكه (push_subscriptions) باسم المستخدم.
--   - عند إنشاء أي إشعار (notifications) تستدعي القاعدة دالة الخادم send-push (pg_net)،
--     فترسله إلى أجهزة صاحبه عبر خدمات Google/Apple، ويظهر والهاتف مقفل والتطبيق مغلق.
--   - مفاتيح VAPID يولّدها الخادم نفسه أول مرة ويحفظها في push_config (لا يقرؤها إلا الخادم)،
--     فلا يمرّ أي مفتاح سري بالكود أو بالمحادثة. المفتاح العام فقط يُقرأ (push_public_key).
--   - سر الربط بين القاعدة والدالة (hook_secret) يُولَّد هنا عشوائياً ولا يغادر القاعدة والخادم.
--   لا يحذف شيئاً من البيانات الطبية. فشل الإرسال لا يمنع إنشاء الإشعار أبداً.
-- =====================================================================

do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then raise notice 'pg_net غير متاح هنا: %', sqlerrm;
end $$;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;   -- بلا سياسات: الوصول من الدوال فقط
revoke all on public.push_subscriptions from anon, authenticated, public;

create table if not exists public.push_config (
  id            int primary key default 1 check (id = 1),
  vapid_public  text,
  vapid_private text,
  subject       text not null default 'https://h9idersalam-web.github.io/hematology-center/',
  hook_secret   text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.push_config enable row level security;          -- بلا سياسات: لا يقرؤه إلا الخادم
revoke all on public.push_config from anon, authenticated, public;
insert into public.push_config(id) values (1) on conflict (id) do nothing;

-- المفتاح العام للاشتراك (ليس سراً)
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select vapid_public from push_config where id = 1 and public.is_active_user()
$$;

-- تسجيل اشتراك هذا الجهاز للمستخدم الحالي (الجهاز نفسه ينتقل لمن سجّل الدخول عليه آخراً)
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_user() then raise exception 'الحساب غير مفعّل' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'اشتراك غير صحيح';
  end if;
  insert into push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
                                       user_agent = excluded.user_agent, created_at = now();
end $$;

-- عند تسجيل الخروج: لا تصل إشعاراته لهذا الجهاز بعد الآن
create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

-- هل لهذا المستخدم أجهزة مشتركة؟ (للواجهة)
create or replace function public.push_my_devices() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from push_subscriptions where user_id = auth.uid()
$$;

revoke all on function public.push_public_key() from public, anon;
grant execute on function public.push_public_key() to authenticated;
revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_unsubscribe(text) to authenticated;
revoke all on function public.push_my_devices() from public, anon;
grant execute on function public.push_my_devices() to authenticated;

-- كل إشعار جديد: يُرسل لأجهزة صاحبه (بلا انتظار؛ أي خطأ هنا لا يمنع الإشعار)
create or replace function public._push_on_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  if exists (select 1 from push_subscriptions where user_id = new.user_id) then
    select hook_secret into v_secret from push_config where id = 1;
    perform net.http_post(
      url := 'https://sagnkfyfabhivwntblmd.supabase.co/functions/v1/send-push',
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      timeout_milliseconds := 10000);
  end if;
  return new;
exception when others then
  return new;
end $$;
revoke all on function public._push_on_notification() from public, anon, authenticated;
drop trigger if exists push_on_notification on public.notifications;
create trigger push_on_notification after insert on public.notifications
  for each row execute function public._push_on_notification();
