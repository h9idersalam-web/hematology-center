// اختبار دورات الدواء على الواجهة (pgrest-lite على 8788)
//   node tests/ui-test-drug-cycles.cjs <out_dir> <seed.sql اختياري: بروتوكولات المركز>
require('./theme-env.cjs');
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const { execFileSync } = require('node:child_process');
const OUT = process.argv[2], SEED = process.argv[3];
const B = 'http://localhost:8788/';

(async () => {
  await fetch(B + '__reset');
  if (SEED) execFileSync('psql', ['-h', '/var/lib/pgtest', '-p', '5499', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', SEED]);
  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [], checks = [];
  const ok = (name, cond) => checks.push((cond ? 'PASS ' : 'FAIL ') + name);
  let n = 0;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ' });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && /\/(rest|storage)\/v1\//.test(r.url())) errors.push(`${r.status()} ${r.url().slice(22, 170)}`); });
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/dc-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true }); };
  await page.goto(B + '#/login');
  await page.getByLabel('البريد الإلكتروني').fill('sara@test.iq');
  await page.getByLabel('كلمة المرور').fill('Pass12345');
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForSelector('text=جلسات اليوم');

  // 1. نموذج البروتوكول: حقل الدورات وتلميحه والتحقق منه
  await page.goto(B + '#/protocol-new');
  await page.waitForSelector('text=بيانات البروتوكول');
  await page.getByLabel('الاسم المختصر').fill('UI-CYC');
  await page.getByLabel('المرض').fill('اختبار');
  await page.getByLabel('المدة بين الجرعات (يوم)').fill('28');
  await page.getByLabel('عدد الجرعات').fill('3');
  await page.getByLabel('اسم الدواء (بالإنجليزية)').fill('Carfilzomib');
  await page.getByLabel('الجرعة الدوائية', { exact: true }).fill('20');
  const cyc = page.getByLabel('الجرعات التي يُعطى فيها (اختياري)');
  ok('cycles hint empty = all', (await page.locator('text=يُعطى في كل الجرعات').count()) === 1);
  await cyc.fill('5');
  await page.getByRole('button', { name: /حفظ/ }).click();
  ok('cycles beyond total rejected', (await page.locator('text=الجرعات غير صحيحة أو تتجاوز عدد الجرعات (3)').count()) === 1);
  await cyc.fill('1');
  ok('cycles hint shows Cycle 1 فقط', (await page.locator('text=Cycle 1 فقط').count()) >= 1);
  await shot('form');
  await page.getByRole('button', { name: /حفظ/ }).click();
  await page.waitForURL(/#\/protocol\?id=/);
  await page.waitForSelector('text=Carfilzomib');
  ok('protocol view shows cycles', (await page.locator('text=Cycle 1 فقط').count()) >= 1);
  await shot('protocol-view');

  if (SEED) {
    // 2. بروتوكول المركز KRd: أسطر الدورات
    await page.goto(B + '#/protocols?t=pending');
    await page.waitForSelector('main .row');
    ok('pending tab lists center protocols', (await page.locator('main .row').count()) >= 50);
    await shot('pending-list');
    await page.locator('main .row', { hasText: 'KRd' }).first().click();
    await page.waitForSelector('text=Carfilzomib');
    ok('KRd shows cycle ranges', (await page.locator('text=Cycles 2–12').count()) >= 1 && (await page.locator('text=Cycles 13–20').count()) >= 1);
    ok('KRd unapproved', (await page.locator('text=/بانتظار|غير معتمد/').count()) >= 1);
    await shot('krd');
  }
  console.log(checks.join('\n'));
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
