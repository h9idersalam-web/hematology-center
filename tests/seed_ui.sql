-- بيانات تجريبية لاختبار الشاشات على القاعدة الحقيقية (محلياً فقط)
-- المستخدمون تُنشئهم pgrest-lite، ومعرّف كل مستخدم = md5(بريده)
\set ON_ERROR_STOP 1
do $$
declare
  sara uuid := md5('sara@test.iq')::uuid;
  chief uuid := md5('admin@test.iq')::uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; t uuid; c record;
begin
  -- طبيبة الاختصاص تعتمد ثلاثة بروتوكولات، ويبقى Imatinib وHydroxyurea بانتظار الاعتماد
  perform set_config('request.jwt.claim.sub', sara::text, true);
  perform approve_protocol(id) from protocols where name in ('R-CHOP-21', 'ABVD', 'VRd');

  -- المرضى
  perform set_config('request.jwt.claim.sub', chief::text, true);
  p1 := register_patient('علي حسين كاظم', '1975-03-12', 'male', 170, 72, '07701234567', 'لا توجد حساسية دوائية معروفة', sara);
  p2 := register_patient('زينب عبد الأمير جواد', '1998-07-02', 'female', 160, 55, null, 'Penicillin، Sulfa', sara);
  p3 := register_patient('حسن رعد الموسوي', '1962-11-20', 'male', 175, 80, '07809988776', 'لا توجد حساسية دوائية معروفة', sara);
  p4 := register_patient('كرار ماجد عبيس', '1989-01-15', 'male', 182, 90, null, null, sara);
  p5 := register_patient('فاطمة الزهراء علي', '2004-09-09', 'female', null, null, null, null, sara);
  p6 := register_patient('أمير جاسم محمد', '1970-04-04', 'male', 168, 77, null, 'لا توجد حساسية دوائية معروفة', sara);

  -- خطط فعّالة من الطبيبة: R-CHOP اليوم دورته الثالثة، وABVD اليوم دورته الثانية
  perform set_config('request.jwt.claim.sub', sara::text, true);
  t := create_treatment(p1, (select id from protocols where name = 'R-CHOP-21'), 'لمفوما الخلايا البائية الكبيرة المنتشرة', 'C83.3', 'II', current_date - 42);
  for c in select id from cycles where treatment_id = t and cycle_no <= 2 loop perform complete_cycle(c.id); end loop;
  t := create_treatment(p2, (select id from protocols where name = 'ABVD'), 'لمفوما هودجكن', 'C81.1', 'IIA', current_date - 28);
  perform complete_cycle((select id from cycles where treatment_id = t and cycle_no = 1));

  -- خطة من مسؤول الصيادلة: تنتظر موافقة الطبيبة
  perform set_config('request.jwt.claim.sub', chief::text, true);
  perform create_treatment(p3, (select id from protocols where name = 'VRd'), 'الورم النقوي المتعدد', 'C90.0', 'ISS II', current_date + 2);
end $$;
