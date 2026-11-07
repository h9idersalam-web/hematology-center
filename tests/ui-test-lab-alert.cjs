// إشعار «تحليل خارج المرجع» يفتح التحليل نفسه (pgrest-lite على 8788)
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const { execFileSync } = require('node:child_process');
const OUT = process.argv[2];
const B = 'http://localhost:8788/';
const psql = (sql) => execFileSync('psql', ['-h', '/var/lib/pgtest', '-p', '5499', '-U', 'postgres', '-Atc', sql]).toString().trim();

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
    page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/rest/v1/') && !r.url().includes('/rpc/')) errors.push(`${email} ${r.status()} ${r.url().slice(22, 170)}`); });
    await page.goto(B + '#/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('Pass12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForSelector('text=جلسات اليوم');
    return page;
  }
  const shot = async (page, name, full = true) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/la-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const pid = psql("select id from patients where full_name like 'علي حسين%'");

  // تحليل سابق ضمن المرجع (قبل أسبوعين)، ثم تحليل اليوم بقيم منخفضة
  const nurse = await login('nurse@test.iq');
  async function enter(date, vals) {
    await nurse.goto(`${B}#/labs-new?patient=${pid}`); await nurse.waitForSelector('text=تاريخ سحب العينة');
    await nurse.getByLabel('تاريخ سحب العينة').fill(date);
    for (const [k, v] of Object.entries(vals)) await nurse.getByLabel(k, { exact: true }).fill(v);
    await nurse.getByRole('button', { name: 'حفظ النتائج' }).click();
    await nurse.waitForURL(/#\/labs\?/);
    await nurse.waitForTimeout(600);
  }
  const d = (k) => { const x = new Date(); x.setDate(x.getDate() + k); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  await enter(d(-14), { 'WBC (×10⁹/L)': '6.1', 'ANC (×10⁹/L)': '3.9', 'Hb (g/dL)': '14.2', 'PLT (×10⁹/L)': '210' });
  await enter(d(0), { 'WBC (×10⁹/L)': '1.6', 'ANC (×10⁹/L)': '0.4', 'Hb (g/dL)': '13.6', 'PLT (×10⁹/L)': '38' });

  const sara = await login('sara@test.iq');
  await sara.goto(B + '#/notifications'); await sara.waitForSelector('main .row');
  await sara.locator('main .row', { hasText: 'ANC 0.4' }).click();
  await sara.waitForSelector('text=التحاليل خارج المرجع');
  ok('opens lab alert screen (not the full file)', sara.url().includes('#/lab-alert?id='));
  ok('header: name, diagnosis, protocol', (await sara.locator('main a.card').first().textContent()).includes('علي حسين كاظم')
     && (await sara.locator('main a.card').first().textContent()).includes('لمفوما') && (await sara.locator('main a.card .tag', { hasText: 'R-CHOP-21' }).count()) === 1);
  ok('3 out-of-range results (WBC, ANC, PLT)', (await sara.locator('.card.lab-alert').count()) === 3);
  const anc = sara.locator('.card.lab-alert', { hasText: 'ANC' });
  ok('ANC value and grade 4', (await anc.textContent()).includes('0.4') && (await anc.textContent()).includes('نقص العدلات: الدرجة 4'));
  ok('PLT grade 3', (await sara.locator('.card.lab-alert', { hasText: 'PLT' }).textContent()).includes('نقص الصفيحات: الدرجة 3'));
  ok('previous value and change', (await sara.locator('.card.lab-alert', { hasText: 'PLT' }).textContent()).includes('السابق 210'));
  ok('febrile neutropenia note', (await sara.locator('text=حمى قلة العدلات').count()) === 1);
  ok('next cycle note', (await sara.locator('text=الدورة القادمة 3').count()) === 1);
  ok('reference ≠ treatment threshold note', (await sara.locator('text=وليس حدّ إعطاء العلاج').count()) === 1);
  ok('in-range results collapsed', (await sara.locator('summary', { hasText: 'ضمن المرجع (1)' }).count()) === 1);
  await shot(sara, 'alert');
  await sara.locator('main a.card').first().click();
  ok('tapping name opens full file', await sara.locator('text=خطة العلاج الحالية').waitFor({ timeout: 8000 }).then(() => true, () => false));

  // إشعار قديم يشير إلى المريض: يفتح الشاشة نفسها
  psql(`insert into notifications(user_id, kind, title, body, link_type, link_id, created_at)
        select specialist_id, 'alert', 'تحليل خارج المرجع', 'إشعار قديم', 'patient', id, now() + interval '1 minute' from patients where id = '${pid}'`);
  await sara.goto(B + '#/notifications'); await sara.waitForSelector('main .row');
  await sara.locator('main .row', { hasText: 'إشعار قديم' }).click();
  ok('old notification opens lab alert too', await sara.locator('text=التحاليل خارج المرجع').waitFor({ timeout: 8000 }).then(async () => (await sara.locator('.card.lab-alert').count()) === 3, () => false));

  ok('no horizontal overflow', await sara.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
