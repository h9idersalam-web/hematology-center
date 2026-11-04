// اختبار شاشات الخطوة 3 (المرضى والملف والمواعيد) مع الخادم التجريبي
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const OUT = process.argv[2];
const B = 'http://localhost:8787/';

(async () => {
  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ' });
  const errors = [];
  const checks = [];
  const ok = (name, cond) => { checks.push((cond ? 'PASS ' : 'FAIL ') + name); };

  async function login(email, pass) {
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    page.on('pageerror', (e) => errors.push(email + ' pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(email + ' console: ' + m.text()); });
    await page.goto(B + '#/login'); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(pass);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForSelector('text=جلسات اليوم');
    return page;
  }
  const shot = async (page, n, full = true) => { await page.waitForTimeout(450); await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: full }); };
  const rows = (page) => page.locator('main .card.flush .row').count();

  // ===== مسؤول الصيادلة (المدير)
  const a = await login('admin@test.iq', 'Admin12345');
  await shot(a, 's3-01-home');

  await a.goto(B + '#/patients'); await a.waitForSelector('text=القائمة'); await a.waitForSelector('main .row');
  await shot(a, 's3-02-patients');
  ok('in-treatment list shows 5 active plans', (await rows(a)) === 5);
  ok('overdue patient first', (await a.locator('main .row').first().textContent()).includes('كرار'));

  await a.getByLabel('بحث في المرضى').fill('زينب');
  await a.waitForTimeout(600);
  ok('search زينب → 1', (await rows(a)) === 1);
  await a.getByLabel('بحث في المرضى').fill('امير جاسم');
  await a.waitForTimeout(600);
  ok('search امير (no hamza) finds أمير', (await a.locator('main .row', { hasText: 'أمير جاسم' }).count()) === 1);
  await a.getByLabel('بحث في المرضى').fill('0007');
  await a.waitForTimeout(600);
  await a.getByRole('button', { name: 'الكل' }).click(); await a.waitForTimeout(600);
  await a.getByLabel('بحث في المرضى').fill('');
  await a.waitForTimeout(600);
  await a.getByRole('button', { name: 'بلا خطة' }).click(); await a.waitForTimeout(600);
  ok('no-plan filter shows فاطمة', (await a.locator('main .row', { hasText: 'فاطمة' }).count()) === 1);
  await a.getByRole('button', { name: 'مؤرشف' }).click(); await a.waitForTimeout(600);
  ok('archived filter shows سجاد', (await a.locator('main .row', { hasText: 'سجاد' }).count()) === 1);
  await shot(a, 's3-03-archived-filter', false);
  await a.getByLabel('بحث في المرضى').fill('لا يوجد هذا');
  await a.waitForTimeout(600);
  ok('empty search message', (await a.locator('text=لا يوجد مريض بهذا البحث').count()) === 1);

  // تسجيل مريض جديد
  await a.goto(B + '#/patient-new'); await a.waitForSelector('text=البيانات الشخصية');
  await shot(a, 's3-04-new-empty');
  await a.getByRole('button', { name: 'تسجيل المريض' }).click();
  await a.waitForSelector('text=اكتب اسم المريض الكامل');
  ok('empty form blocked', true);
  await a.getByLabel('الاسم الكامل (الرباعي)').fill('فاطمه الزهراء علي');
  await a.getByRole('button', { name: 'أنثى' }).click();
  await a.getByLabel('رقم الهاتف').fill('123');
  await a.getByRole('button', { name: 'تسجيل المريض' }).click();
  await a.waitForSelector('text=رقم الهاتف غير صحيح');
  ok('bad phone blocked', true);
  await a.getByLabel('رقم الهاتف').fill('٠٧٨١٢٣٤٥٦٧٨');
  await a.getByLabel('الطول (سم)').fill('160');
  await a.getByLabel('الوزن (كغ)').fill('60');
  ok('BSA live 1.63', (await a.locator('text=مساحة سطح الجسم: 1.63').count()) === 1);
  await a.getByRole('button', { name: 'تسجيل المريض' }).click();
  await a.waitForSelector('text=يوجد مريض باسم مشابه');
  ok('duplicate name warning (ة/ه normalized)', true);
  await shot(a, 's3-05-duplicate', false);
  await a.locator('dialog').getByRole('button', { name: 'إلغاء' }).click();
  await a.getByLabel('الاسم الكامل (الرباعي)').fill('مريم حسن عباس');
  await a.locator('input[type=date]').fill('1991-06-15');
  await a.getByText('لا توجد حساسية دوائية معروفة').click();
  await a.getByLabel('المسؤول عن قرارات العلاج والموافقات').selectOption({ label: 'د. سارة الربيعي' });
  await shot(a, 's3-06-new-filled');
  await a.getByRole('button', { name: 'تسجيل المريض' }).click();
  await a.waitForSelector('text=ملف HEM-2026-');
  await a.waitForTimeout(300);
  const toastTxt = await a.locator('#toast').textContent();
  ok('register toast has file no: ' + toastTxt, /رقم الملف HEM-2026-\d{4}/.test(toastTxt));
  ok('phone normalized to latin', (await a.locator('a[href="tel:07812345678"]').count()) === 1);
  await shot(a, 's3-07-new-patient-file');
  ok('chief pharmacist sees no archive button', (await a.getByRole('button', { name: 'أرشفة الملف' }).count()) === 0);

  // تعديل
  await a.getByRole('link', { name: 'تعديل بيانات المريض' }).click();
  await a.waitForSelector('text=تعديل البيانات');
  await a.getByLabel('الوزن (كغ)').fill('58');
  await a.getByRole('button', { name: 'حفظ التعديلات' }).click();
  await a.waitForSelector('text=58 كغ');
  ok('edit saved', true);

  // ملفات المرضى الموجودين
  await a.goto(B + '#/patient?id=p2'); await a.waitForSelector('text=جدول الدورات');
  ok('allergy banner shown', (await a.locator('text=Penicillin').count()) > 0);
  ok('no postpone for pharmacist', (await a.locator('button[aria-label^="تأجيل"]').count()) === 0);
  await shot(a, 's3-08-file-allergy');
  await a.goto(B + '#/patient?id=p4'); await a.waitForSelector('text=جدول الدورات');
  ok('weight-change warning', (await a.locator('text=أقل من وزن الخطة').count()) === 1);
  ok('overdue tile', (await a.locator('text=متأخرة 5 أيام').count()) === 1);
  await shot(a, 's3-09-file-overdue-weight');
  await a.goto(B + '#/patient?id=p3'); await a.waitForSelector('text=خطط سابقة');
  await shot(a, 's3-10-file-previous');
  await a.goto(B + '#/patient?id=p5'); await a.waitForSelector('text=لا توجد خطة علاج حالية');
  ok('missing allergy warning', (await a.locator('text=لم تُسجَّل معلومات الحساسية').count()) === 1);
  await shot(a, 's3-11-file-noplan', false);

  // المواعيد
  await a.goto(B + '#/appointments'); await a.waitForSelector('text=جاهزة للمزج');
  ok('today 3 sessions', (await rows(a)) === 3);
  await shot(a, 's3-12-appointments-today');
  await a.getByRole('button', { name: '7 أيام' }).click(); await a.waitForTimeout(600);
  ok('week includes Imatinib in 3 days', (await a.locator('text=Imatinib').count()) === 1);
  await shot(a, 's3-13-appointments-week');
  await a.getByRole('button', { name: 'المتأخرة' }).click(); await a.waitForTimeout(600);
  ok('late shows كرار', (await a.locator('main .row', { hasText: 'كرار' }).count()) === 1);

  // من الرئيسية إلى ملف المريض
  await a.goto(B + '#/home'); await a.waitForSelector('main .row');
  await a.locator('main .row').first().click(); await a.waitForSelector('text=جدول الدورات');
  ok('home row opens patient file', a.url().includes('#/patient?id='));

  // ===== طبيبة الاختصاص: التأجيل والأرشفة
  const s = await login('sara@test.iq', 'Pass12345');
  await s.goto(B + '#/appointments?v=late'); await s.waitForSelector('main .row');
  await s.locator('button[aria-label="تأجيل جلسة كرار ماجد عبيس"]').click();
  await s.waitForSelector('dialog');
  await s.locator('dialog').getByRole('button', { name: 'نقص العدلات' }).click();
  await shot(s, 's3-14-postpone-dialog', false);
  await s.locator('dialog').getByRole('button', { name: 'تأجيل', exact: true }).click();
  await s.waitForSelector('text=لا توجد جلسات متأخرة');
  ok('postpone clears late list', true);
  await s.goto(B + '#/patient?id=p4'); await s.waitForSelector('text=جدول الدورات');
  ok('postpone reason on cycle', (await s.locator('text=أُجّلت: نقص العدلات').count()) === 1);
  await shot(s, 's3-15-after-postpone');

  await s.goto(B + '#/patient?id=p5'); await s.waitForSelector('text=أرشفة الملف');
  await s.getByRole('button', { name: 'أرشفة الملف' }).click();
  await s.locator('dialog textarea').fill('انتقلت إلى مركز آخر');
  await s.locator('dialog').getByRole('button', { name: 'أرشفة' }).click();
  await s.waitForSelector('text=مؤرشف منذ');
  ok('archived banner', true);
  ok('archived file has no edit button', (await s.locator('a[aria-label="تعديل بيانات المريض"]').count()) === 0);
  await shot(s, 's3-16-archived', false);

  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
