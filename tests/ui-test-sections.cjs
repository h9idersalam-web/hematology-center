// إيقاف قسمي المزج والتمريض من «لوحة المدير › الأقسام» وتشغيلهما (الملف 47) — pgrest-lite على 8788
//   node tests/ui-test-sections.cjs <out_dir>      (UI_THEME=b للتصميم الرسمي)
require('./theme-env.cjs');
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const OUT = process.argv[2];
const B = 'http://localhost:8788/';

(async () => {
  await fetch(B + '__reset');
  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [], checks = [];
  const ok = (name, cond) => checks.push((cond ? 'PASS ' : 'FAIL ') + name);
  let n = 0;
  async function page(viewport = { width: 390, height: 844 }, tag = 'anon') {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'ar-IQ' });
    const pg = await ctx.newPage();
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    pg.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
    return pg;
  }
  async function login(email, viewport) {
    const pg = await page(viewport, email);
    await pg.goto(B + '#/login');
    await pg.getByLabel('البريد الإلكتروني').fill(email);
    await pg.getByLabel('كلمة المرور').fill('Pass12345');
    await pg.getByRole('button', { name: 'دخول' }).click();
    await pg.waitForSelector('text=جلسات اليوم');
    return pg;
  }
  const shot = async (pg, name, full = true) => { await pg.waitForTimeout(500); await pg.screenshot({ path: `${OUT}/sec-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const confirm = (pg, label) => pg.locator('dialog').getByRole('button', { name: label, exact: true }).click();
  const has = async (pg, t) => (await pg.locator(`text=${t}`).count()) > 0;

  // ===== 1. المدير يوقف القسمين (حاسوب)
  const admin = await login('admin@test.iq', { width: 1280, height: 900 });
  // شاشة المزج تفتح والقسم يعمل (التصميم الرسمي بلا بطاقة مزج في الرئيسية، فالفحص على الشاشة نفسها)
  await admin.goto(B + '#/mixing');
  ok('mixing screen opens while on', await admin.waitForSelector('.topbar >> text=قسم المزج', { timeout: 8000 }).then(() => true, () => false));
  await admin.goto(B + '#/admin?tab=sections');
  await admin.waitForSelector('article[aria-label="قسم المزج الكيميائي"]');
  ok('three switches running', (await admin.locator('article .pill', { hasText: 'يعمل' }).count()) === 3);
  for (const label of ['قسم المزج الكيميائي', 'قسم التمريض', 'صورة الطبلة']) {
    const card = admin.locator(`article[aria-label="${label}"]`);
    await card.getByRole('button', { name: 'إيقاف القسم مؤقتاً' }).click();
    await confirm(admin, 'إيقاف القسم');
    await admin.locator(`article[aria-label="${label}"] .pill`, { hasText: 'موقوف' }).waitFor();
  }
  ok('all three off', (await admin.locator('article .pill', { hasText: 'موقوف' }).count()) === 3);
  ok('active mixing user flagged', await has(admin, 'بدور «صيدلي المزج الكيميائي»: زهراء فاضل'));
  await shot(admin, 'admin-sections-off-desktop');

  // أدوار الأقسام الموقوفة لا تُعرض في نافذة الصلاحية
  await admin.goto(B + '#/admin?tab=users');
  await admin.waitForSelector('article:has-text("رسل عادل")');
  await admin.locator('article', { hasText: 'رسل عادل' }).getByRole('button', { name: /الصلاحية/ }).click();
  const opts = await admin.locator('dialog select option').allTextContents();
  ok('role picker hides nurse/mixing: ' + opts.length, !opts.some((o) => /ممرض|المزج/.test(o)) && opts.length >= 5);
  await admin.locator('dialog').getByRole('button', { name: 'إغلاق' }).click();

  // ===== 2. الطبيبة تعتمد جرعة والمزج موقوف: لا تذهب إلى المزج
  const sara = await login('sara@test.iq');
  ok('no mixing / nursing tiles for doctor', !(await has(sara, 'قسم المزج')) && !(await has(sara, 'الإعطاء اليوم')));
  await sara.goto(B + '#/patients?f=all'); await sara.waitForSelector('main .row');
  await sara.locator('main .row', { hasText: 'علي حسين' }).click(); await sara.waitForSelector('text=خطة العلاج الحالية');
  await sara.locator('a[aria-label^="Cycle 3،"]').click(); await sara.waitForSelector('text=الجرعات الدوائية');
  await sara.getByRole('button', { name: 'اعتماد الجرعة' }).click(); await confirm(sara, 'اعتماد');
  await sara.waitForSelector('text=أيام الإعطاء');
  ok('approved cycle not sent to mixing', !(await has(sara, 'وصل قسم المزج')) && !(await has(sara, 'المزج والإعطاء')));
  ok('day row says confirm', await has(sara, 'تأكيد الإعطاء'));
  ok('no chart step while chart off', !(await has(sara, 'صورة الطبلة من الصيدلي')));
  const cycleUrl = sara.url();
  const cid = new URL(cycleUrl.replace('#/', '')).searchParams.get('id') || cycleUrl.split('id=')[1];
  await shot(sara, 'doctor-cycle-mixing-off');
  await sara.goto(B + '#/mixing'); await sara.waitForTimeout(800);
  ok('direct #/mixing goes home', await has(sara, 'جلسات اليوم'));

  // ===== 3. الصيدلي السريري يؤكد «تم إعطاء الجرعة بالكامل» بلا تمريض
  const cp = await login('cp@test.iq');
  ok('no chart task on pharmacist home', !(await has(cp, 'بانتظار صورة الطبلة منك')));
  await cp.goto(B + `#/administer?cycle=${cid}&day=1`);
  await cp.waitForSelector('text=تم إعطاء الجرعة بالكامل');
  ok('no administer buttons for anyone', (await cp.getByRole('button', { name: 'تسجيل الإعطاء' }).count()) === 0);
  ok('no vitals card while nursing off', (await cp.locator('text=العلامات الحيوية').count()) === 0);
  await shot(cp, 'pharmacist-confirm-day');
  await cp.getByRole('button', { name: /تم إعطاء الجرعة بالكامل/ }).click();
  await confirm(cp, 'تأكيد');
  await cp.waitForSelector('text=تم إعطاء الجرعة بالكامل لليوم 1', { timeout: 8000 }).catch(() => cp.waitForSelector('.notice.ok, [class*="ok"] >> text=تم إعطاء الجرعة'));
  ok('clinical pharmacist confirmed the day', await has(cp, 'تم إعطاء الجرعة بالكامل'));

  // ===== 4. حساب صيدلي المزج: لا قسم يراه
  const mix = await login('mix@test.iq');
  ok('mixing user sees no mixing tile', !(await has(mix, 'قسم المزج')));
  await mix.goto(B + '#/mixing-order?id=x'); await mix.waitForTimeout(800);
  ok('mixing order link goes home', await has(mix, 'جلسات اليوم'));

  // ===== 5. صفحة التسجيل لا تعرض الأدوار الموقوفة
  const anon = await page();
  await anon.goto(B + '#/register'); await anon.waitForSelector('text=إنشاء الحساب');
  await anon.waitForTimeout(800);
  const groups = await anon.locator('fieldset .choice').allTextContents();
  ok('register groups without nurse: ' + groups.join('/'), !groups.includes('ممرض') && groups.includes('صيدلاني'));
  await anon.locator('fieldset .choice', { hasText: 'صيدلاني' }).click();
  ok('register pharmacist types without mixing', !(await has(anon, 'صيدلي المزج الكيميائي')) && await has(anon, 'صيدلي سريري'));
  await shot(anon, 'register-roles-off');

  // ===== 6. المدير يعيد تشغيل المزج على الهاتف: تصل الجرعة المعتمدة إلى المزج
  const am = await login('admin@test.iq');
  await am.goto(B + '#/admin?tab=sections');
  await am.waitForSelector('article[aria-label="قسم المزج الكيميائي"]');
  const overflow = await am.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('no horizontal scroll on phone', !overflow);
  await shot(am, 'admin-sections-mobile');
  await am.locator('article[aria-label="قسم المزج الكيميائي"]').getByRole('button', { name: 'تشغيل القسم' }).click();
  await confirm(am, 'تشغيل القسم');
  await am.locator('article[aria-label="قسم المزج الكيميائي"] .pill', { hasText: 'يعمل' }).waitFor();
  ok('mixing back on', true);
  await sara.goto(cycleUrl); await sara.reload();
  await sara.waitForSelector('text=المزج والإعطاء', { timeout: 8000 });
  ok('approved cycle reached mixing after re-enable', await has(sara, 'وصل قسم المزج'));
  await mix.goto(B + '#/home'); await mix.reload(); await mix.waitForSelector('text=جلسات اليوم');
  await mix.goto(B + '#/mixing');
  ok('mixing user opens mixing again', await mix.waitForSelector('.topbar >> text=قسم المزج', { timeout: 8000 }).then(() => true, () => false));

  console.log(checks.join('\n'));
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
