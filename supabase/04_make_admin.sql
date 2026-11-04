-- =====================================================================
--  الخطوة 1 (د): جعل حسابك مديراً للنظام
--  شغّله مرة واحدة فقط، بعد أن تنشئ حسابك من شاشة التسجيل في التطبيق.
--  غيّر البريد في السطر الأخير إلى بريدك.
-- =====================================================================

update public.profiles
   set is_admin = true,
       status = 'active',
       subscription_ends = null,
       activated_at = now()
 where id = (select id from auth.users where email = 'haidersalam01@gmail.com');
