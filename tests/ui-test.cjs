// اختبار الواجهة على مقاس الهاتف مع الخادم التجريبي
const { chromium } = require('playwright');
const OUT = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ar-IQ' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const shot = async (n, full = true) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: full }); };
  const B = 'http://localhost:8787/';

  // 1) حساب جديد
  await page.goto(B + '#/register'); await page.waitForSelector('form');
  await shot('01-register');
  await page.getByRole('button', { name: 'طبيب', exact: true }).click();
  await page.getByRole('button', { name: /طبيب اختصاص/ }).click();
  await page.getByLabel('الاسم الكامل').fill('د. أحمد كريم');
  await page.getByLabel('رقم الهاتف').fill('07711112222');
  await page.getByLabel('البريد الإلكتروني').fill('ahmed@test.iq');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Pass12345');
  await page.getByLabel('تأكيد كلمة المرور').fill('Pass12345');
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await page.waitForSelector('text=تفعيل الحساب');
  await shot('02-activation');
  // كود خاطئ
  await page.getByLabel('كود التفعيل').fill('ABCD2345');
  await page.getByRole('button', { name: /تفعيل وفتح/ }).click();
  await page.waitForSelector('text=الكود غير صحيح');
  console.log('wrong code message OK');

  // 2) المدير يدخل وينشئ كوداً للمستخدم الجديد
  const admin = await ctx.newPage();
  await admin.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  admin.on('pageerror', (e) => errors.push('admin pageerror: ' + e.message));
  await admin.goto(B + '#/login');
  // جلسة مستقلة: نظّف التخزين في الصفحة الجديدة
  await admin.evaluate(() => localStorage.clear()); await admin.reload();
  await admin.getByLabel('البريد الإلكتروني').fill('admin@test.iq');
  await admin.getByLabel('كلمة المرور').fill('Admin12345');
  await admin.getByRole('button', { name: 'دخول' }).click();
  await admin.waitForSelector('text=الإدارة');
  await admin.waitForTimeout(600);
  await admin.screenshot({ path: `${OUT}/03-home-admin.png`, fullPage: true });
  await admin.goto(B + '#/admin?tab=users'); await admin.waitForSelector('text=بانتظار التفعيل');
  await admin.waitForTimeout(500);
  await admin.screenshot({ path: `${OUT}/04-admin-users.png`, fullPage: true });
  await admin.locator('.row', { hasText: 'د. أحمد كريم' }).getByRole('button', { name: 'إرسال كود' }).click();
  await admin.getByRole('button', { name: 'سنة' }).click();
  await admin.getByRole('button', { name: 'إنشاء الكود' }).click();
  await admin.waitForSelector('dialog .code');
  const code = await admin.locator('dialog .code').textContent();
  await admin.screenshot({ path: `${OUT}/05-admin-code.png` });
  const wa = await admin.locator('dialog a', { hasText: 'واتساب' }).getAttribute('href');
  console.log('code', code, 'wa starts', wa.slice(0, 40));
  await admin.getByRole('button', { name: 'إغلاق' }).click();
  await admin.goto(B + '#/admin?tab=codes'); await admin.waitForSelector('text=آخر الأكواد'); await admin.waitForTimeout(400);
  await admin.screenshot({ path: `${OUT}/06-admin-codes.png`, fullPage: true });
  await admin.goto(B + '#/admin?tab=subscriptions'); await admin.waitForTimeout(600);
  await admin.screenshot({ path: `${OUT}/07-admin-subs.png`, fullPage: true });
  await admin.goto(B + '#/admin?tab=permissions'); await admin.waitForTimeout(400);
  await admin.screenshot({ path: `${OUT}/08-admin-perms.png`, fullPage: true });
  await admin.goto(B + '#/notifications'); await admin.waitForSelector('text=طلب تعديل بانتظار موافقتك'); await admin.waitForTimeout(300);
  await admin.screenshot({ path: `${OUT}/09-notifications.png`, fullPage: true });

  // 3) المستخدم الجديد يفعّل بالكود (الصفحة الأولى، جلستها ما زالت محفوظة؟ التخزين مشترك في السياق نفسه)
  await page.evaluate(() => localStorage.clear());
  await page.goto(B + '#/login'); await page.reload();
  await page.getByLabel('البريد الإلكتروني').fill('ahmed@test.iq');
  await page.getByLabel('كلمة المرور').fill('Pass12345');
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForSelector('text=تفعيل الحساب');
  await page.getByLabel('كود التفعيل').fill(code.toLowerCase().replace('-', ''));
  await page.getByRole('button', { name: /تفعيل وفتح/ }).click();
  await page.waitForSelector('text=جلسات اليوم');
  await shot('10-home-specialist');
  const adminVisible = await page.locator('text=تظهر لك وحدك').count();
  console.log('admin panel visible to specialist:', adminVisible);
  // غير المدير لا يدخل الإدارة
  await page.goto(B + '#/admin'); await page.waitForTimeout(500);
  console.log('specialist /admin redirected to:', page.url().split('#')[1]);
  await page.goto(B + '#/patients'); await page.waitForTimeout(300); await shot('11-soon', false);

  // 4) حساب موقوف
  const s2 = await ctx.newPage(); await s2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await s2.goto(B + '#/login'); await s2.evaluate(() => localStorage.clear()); await s2.reload();
  await s2.getByLabel('البريد الإلكتروني').fill('nour@test.iq'); await s2.getByLabel('كلمة المرور').fill('Pass12345');
  await s2.getByRole('button', { name: 'دخول' }).click(); await s2.waitForSelector('text=الحساب موقوف');
  await s2.screenshot({ path: `${OUT}/12-suspended.png` });
  // دخول خاطئ
  await s2.evaluate(() => localStorage.clear()); await s2.goto(B + '#/login'); await s2.reload();
  await s2.getByLabel('البريد الإلكتروني').fill('x@test.iq'); await s2.getByLabel('كلمة المرور').fill('bad');
  await s2.getByRole('button', { name: 'دخول' }).click(); await s2.waitForSelector('text=البريد أو كلمة المرور غير صحيحة');
  await s2.screenshot({ path: `${OUT}/13-login-error.png` });

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
