// اختبار دور عمل المدير وتغيير صلاحيات المستخدمين (pgrest-lite على 8788)
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const OUT = process.argv[2];
const { execFileSync } = require('node:child_process');
const psql = (sql) => execFileSync('psql', ['-h', '/var/lib/pgtest', '-p', '5499', '-U', 'postgres', '-Atc', sql]).toString().trim();
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
  await adm.locator('a[aria-label^="الجرعة 3،"]').click(); await adm.waitForSelector('text=الجرعات الدوائية');
  await adm.getByRole('button', { name: 'اعتماد الجرعة' }).click(); await confirm(adm, 'اعتماد');
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

  // حساب موقوف: يظهر له زر الصلاحية (الخلل الذي ظهر للمدير)، وتُغيَّر صلاحيته
  await adm.locator('dialog').getByRole('button', { name: 'إغلاق' }).click().catch(() => {});
  await adm.goto(B + '#/admin?tab=users'); await adm.waitForSelector('text=زهراء فاضل');
  const zcard = () => adm.locator('article', { hasText: 'زهراء فاضل' });
  await zcard().getByRole('button', { name: 'إيقاف' }).click(); await confirm(adm, 'إيقاف الحساب');
  await zcard().getByRole('button', { name: 'إعادة التفعيل' }).waitFor();
  ok('suspended user has permission button', (await zcard().getByRole('button', { name: 'الصلاحية والاشتراك' }).count()) === 1);
  await zcard().getByRole('button', { name: 'الصلاحية والاشتراك' }).click();
  await adm.locator('dialog select').selectOption('nurse');
  await adm.locator('dialog').getByRole('button', { name: 'حفظ الصلاحية' }).click(); await confirm(adm, 'تغيير');
  ok('suspended user role changed', await zcard().locator('text=ممرض').first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  await shot(adm, 'suspended-card');

  // الحذف: بلا أثر يُحذف نهائياً
  await adm.locator('article', { hasText: 'د. حسين كامل' }).getByRole('button', { name: 'حذف' }).click();
  ok('delete dialog explains full delete', (await adm.locator('dialog', { hasText: 'فيُحذف حسابه نهائياً' }).count()) === 1);
  await adm.locator('dialog').last().locator('textarea').fill('سُجّل بالخطأ');
  await confirm(adm, 'حذف نهائي');
  ok('clean user deleted', await adm.locator('#toast', { hasText: 'حُذف الحساب نهائياً' }).waitFor({ timeout: 8000 }).then(() => true, () => false));
  ok('gone from list', await adm.locator('article', { hasText: 'د. حسين كامل' }).waitFor({ state: 'detached', timeout: 8000 }).then(() => true, () => false));
  // له أثر (رفع مرفقاً لمريض): يُحذف الدخول ويبقى الاسم
  psql(`insert into attachments(patient_id, kind, file_path, created_by) select id, 'other', 'patients/' || id || '/x.jpg', (select id from profiles where full_name = 'رسل عادل') from patients limit 1`);
  await adm.reload(); await adm.waitForSelector('text=رسل عادل');
  await adm.locator('article', { hasText: 'رسل عادل' }).getByRole('button', { name: 'حذف' }).click();
  ok('delete dialog explains name kept', (await adm.locator('dialog', { hasText: 'ويبقى اسمه على ما سجّله' }).count()) === 1);
  await shot(adm, 'delete-dialog');
  await adm.locator('dialog').last().locator('textarea').fill('انتهى عمله في المركز');
  await confirm(adm, 'حذف نهائي');
  ok('user with records removed', await adm.locator('#toast', { hasText: 'وبقي اسمه على سجلاته' }).waitFor({ timeout: 8000 }).then(() => true, () => false));
  const gone = await browser.newContext(); const gp = await gone.newPage();
  await gp.goto(B + '#/login'); await gp.getByLabel('البريد الإلكتروني').fill('cp@test.iq'); await gp.getByLabel('كلمة المرور').fill('Pass12345');
  await gp.getByRole('button', { name: 'دخول' }).click();
  ok('name kept on record', psql(`select p.full_name from attachments a join profiles p on p.id = a.created_by where a.file_path like '%/x.jpg'`) === 'رسل عادل');
  ok('removed user cannot sign in', await gp.locator('text=جلسات اليوم').waitFor({ timeout: 6000 }).then(() => false, () => true));
  // صفحة «الصلاحيات» فيها زر مباشر
  await adm.goto(B + '#/admin?tab=permissions'); await adm.getByRole('button', { name: 'تغيير صلاحية مستخدم أو حذفه' }).click();
  ok('permissions tab button opens users', await adm.locator('article', { hasText: 'زهراء فاضل' }).waitFor({ timeout: 8000 }).then(() => true, () => false));

  // المستخدم الذي تغيّرت صلاحيته يراها
  const nurse = await login('nurse@test.iq');
  ok('changed user sees new role', (await nurse.locator('header .pill').first().textContent()) === 'طبيب مقيم أقدم');

  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
