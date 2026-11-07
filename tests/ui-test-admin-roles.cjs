// اختبار دور عمل المدير وتغيير صلاحيات المستخدمين (pgrest-lite على 8788)
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const OUT = process.argv[2];
const B = 'http://localhost:8788/';

(async () => {
  await fetch(B + '__reset');
  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [], checks = [];
  const ok = (name, cond) => checks.push((cond ? 'PASS ' : 'FAIL ') + name);
  let n = 0;
  async function login(email) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ' });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    page.on('pageerror', (e) => errors.push(email + ' pageerror: ' + e.message));
    await page.goto(B + '#/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('Pass12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForSelector('text=جلسات اليوم');
    return page;
  }
  const shot = async (page, name, full = false) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/adm-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const confirm = (page, label) => page.locator('dialog').last().getByRole('button', { name: label, exact: true }).click();
  const switchTo = async (page, label) => {
    await page.locator('.role-switch').click();
    await page.locator('dialog .option', { hasText: label }).first().click();
    await page.waitForSelector(`.role-switch >> text=أعمل بدور: ${label}`);
  };

  // المدير في البيانات التجريبية: مسؤول الصيادلة ومدير النظام
  const adm = await login('admin@test.iq');
  ok('admin label without role title', (await adm.locator('header .pill.dark').textContent()) === 'مدير النظام');
  ok('role switch icon shows current role', (await adm.locator('.role-switch').textContent()).includes('مسؤول الصيادلة السريريين'));
  await adm.locator('.role-switch').click(); await adm.waitForSelector('dialog .option');
  ok('7 roles to choose from', (await adm.locator('dialog .option').count()) === 7);
  await shot(adm, 'role-picker');
  await adm.locator('dialog').getByRole('button', { name: 'إغلاق' }).click();

  // يعمل بدور ممرض: يرى الإعطاء، ولا يرى المزج، ويبقى مديراً
  await switchTo(adm, 'ممرض');
  ok('as nurse: nursing tile, no mixing tile', (await adm.locator('[data-k="nurse"]').count()) === 1 && (await adm.locator('[data-k="mix"]').count()) === 0);
  ok('still admin panel', await adm.locator('.admin-panel').waitFor({ timeout: 8000 }).then(() => true, () => false));
  await shot(adm, 'as-nurse');

  // يعمل بدور طبيب اختصاص: يعتمد دورة
  await switchTo(adm, 'طبيب اختصاص');
  await adm.goto(B + '#/patients?f=all'); await adm.waitForSelector('main .row');
  await adm.locator('main .row', { hasText: 'علي حسين' }).click(); await adm.waitForSelector('text=خطة العلاج الحالية');
  await adm.locator('a[aria-label^="الدورة 3،"]').click(); await adm.waitForSelector('text=الجرعات');
  await adm.getByRole('button', { name: 'اعتماد الدورة' }).click(); await confirm(adm, 'اعتماد');
  ok('as specialist: approved cycle', await adm.locator('.step.done', { hasText: 'حيدر سلام' }).waitFor({ timeout: 8000 }).then(() => true, () => false));

  // يعمل بدور صيدلي المزج: يحضّر
  await adm.goto(B + '#/home'); await adm.waitForSelector('.role-switch');
  await switchTo(adm, 'صيدلي المزج الكيميائي');
  await adm.locator('[data-k="mix"]').click(); await adm.waitForSelector('main .row');
  await adm.locator('main .row').first().click(); await adm.waitForSelector('text=ضع علامة على ما حضّرته');
  ok('as mixing: can prepare', (await adm.locator('main input[type=checkbox]').count()) >= 1);

  // تغيير صلاحية مستخدم من لوحة الإدارة
  await adm.goto(B + '#/admin?tab=users'); await adm.waitForSelector('text=نور حيدر');
  await adm.locator('article', { hasText: 'نور حيدر' }).getByRole('button', { name: 'الصلاحية والاشتراك' }).click();
  await adm.locator('dialog select').selectOption('senior_resident');
  ok('role description shown', (await adm.locator('dialog .hint', { hasText: 'صلاحياته:' }).count()) === 1);
  await shot(adm, 'change-role');
  await adm.locator('dialog').getByRole('button', { name: 'حفظ الصلاحية' }).click(); await confirm(adm, 'تغيير');
  await adm.waitForSelector('article:has-text("نور حيدر") >> text=طبيب مقيم أقدم');
  ok('role changed in list', true);
  // طبيبة مختصة لها مرضى: تحذير ورفض
  await adm.locator('article', { hasText: 'د. سارة الربيعي' }).getByRole('button', { name: 'الصلاحية والاشتراك' }).click();
  await adm.locator('dialog select').selectOption('intern');
  ok('specialist with patients: warning', (await adm.locator('dialog .notice', { hasText: 'انقلهم إلى طبيب اختصاص آخر' }).count()) === 1);
  await adm.locator('dialog').getByRole('button', { name: 'حفظ الصلاحية' }).click(); await confirm(adm, 'تغيير');
  ok('specialist with patients: refused', await adm.locator('#toast', { hasText: 'انقلهم' }).waitFor({ timeout: 5000 }).then(() => true, () => false));

  // المستخدم الذي تغيّرت صلاحيته يراها
  const nurse = await login('nurse@test.iq');
  ok('changed user sees new role', (await nurse.locator('header .pill').first().textContent()) === 'طبيب مقيم أقدم');

  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
