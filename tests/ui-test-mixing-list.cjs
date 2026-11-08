// قسم المزج: جرعات اليوم افتراضياً، وغداً، وأي تاريخ، والمتأخرة، والبروتوكول كاملاً (pgrest-lite على 8788)
require('./theme-env.cjs');
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const OUT = process.argv[2];
const B = 'http://localhost:8788/';
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

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
  const shot = async (page, name, full = false) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/mx-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const confirm = (page, label) => page.locator('dialog').getByRole('button', { name: label, exact: true }).click();

  // الطبيبة تعتمد: علي (اليوم)، زينب ABVD (اليوم واليوم 15 بعد 14 يوماً)، رقية (بدأت قبل 4 أيام: متأخرة)
  const sara = await login('sara@test.iq');
  for (const [name, no] of [['علي حسين', 3], ['زينب', 2], ['رقية', 1]]) {
    await sara.goto(B + '#/patients?f=all'); await sara.waitForSelector('main .row');
    await sara.locator('main .row', { hasText: name }).click(); await sara.waitForSelector('text=خطة العلاج الحالية');
    await sara.locator(`a[aria-label^="الجرعة ${no}،"]`).click(); await sara.waitForSelector('text=الجرعات الدوائية');
    await sara.getByRole('button', { name: 'اعتماد الجرعة' }).click(); await confirm(sara, 'اعتماد');
    await sara.locator('.pill', { hasText: 'وصل قسم المزج' }).first().waitFor();
  }

  const mix = await login('mix@test.iq');
  ok('home tile counts today only (2)', await mix.locator('[data-k="mix"] .count').waitFor({ timeout: 8000 }).then(async () => (await mix.locator('[data-k="mix"] .count').textContent()) === '2', () => false));
  await mix.locator('[data-k="mix"]').click(); await mix.waitForSelector('text=أو اختر تاريخاً');
  const names = async () => (await mix.locator('main .card.flush .row .t').allTextContents()).map((x) => x.trim());
  await mix.waitForTimeout(500);
  const todayList = await names();
  ok(`today: only today's doses (${todayList.join('، ')})`, todayList.length === 2 && todayList.some((x) => x.includes('علي')) && todayList.some((x) => x.includes('زينب')));
  ok('late warning for earlier unsent', (await mix.locator('text=1 طلب من أيام سابقة لم يُرسل').count()) === 1);
  await shot(mix, 'today');

  await mix.getByRole('button', { name: 'غداً', exact: true }).click();
  await mix.waitForTimeout(300);
  ok('tomorrow: nothing due', (await names()).length === 0 && (await mix.locator('text=لا توجد جرعات دوائية للتحضير في هذا اليوم').count()) === 1);

  await mix.getByLabel('تاريخ الإعطاء').fill(iso(14));
  await mix.waitForTimeout(300);
  const d14 = await names();
  ok('chosen date (+14): ABVD day 15 only', d14.length === 1 && d14[0].includes('زينب') && (await mix.locator('text=الجرعة 2 · اليوم 15').count()) === 1);
  ok('url keeps chosen date', mix.url().includes('d=' + iso(14)));
  await shot(mix, 'chosen-date');

  await mix.locator('.notice.warn', { hasText: 'لم يُرسل' }).click();
  await mix.waitForTimeout(300);
  ok('late view lists Ruqaya', (await names()).length === 1 && (await names())[0].includes('رقية'));

  await mix.getByRole('button', { name: 'اليوم', exact: true }).click(); await mix.waitForTimeout(300);
  await mix.locator('main .card.flush .row', { hasText: 'علي' }).getByRole('link', { name: /البروتوكول كاملاً/ }).click();
  await mix.waitForSelector('text=المزج والإعطاء');
  ok('full protocol opens the whole cycle', (await mix.locator('text=الجرعات الدوائية').count()) >= 1 && mix.url().includes('#/cycle?id='));
  await mix.goBack(); await mix.waitForSelector('text=أو اختر تاريخاً');
  await mix.locator('main .card.flush .row', { hasText: 'علي' }).locator('a').first().click();
  await mix.waitForSelector('text=ضع علامة على ما حضّرته');
  ok('order has full-protocol button', (await mix.getByRole('link', { name: /البروتوكول كاملاً للمريض/ }).count()) === 1);
  ok('order back returns to its day', (await mix.locator('.topbar a').first().getAttribute('href')).includes('d=' + iso(0)));

  ok('no horizontal overflow', await mix.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
