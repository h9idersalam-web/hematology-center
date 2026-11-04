// اختبار جرعة AUC على الواجهة (pgrest-lite على 8788)
//   node tests/ui-test-auc.cjs <out_dir> <seed.sql: بروتوكولات Carboplatin>
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const OUT = process.argv[2], SEED = process.argv[3];
const B = 'http://localhost:8788/';
const uid = (e) => crypto.createHash('md5').update(e).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
const sql = (s) => execFileSync('psql', ['-h', '/var/lib/pgtest', '-p', '5499', '-U', 'postgres', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', s]).toString().trim();

(async () => {
  await fetch(B + '__reset');
  execFileSync('psql', ['-h', '/var/lib/pgtest', '-p', '5499', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', SEED]);
  const sara = uid('sara@test.iq');
  sql(`update protocols set approved_by = '${sara}', approved_at = now() where name = 'TEC'`);
  // رجل 60 سنة، 170 سم، 70 كغ، بلا كرياتينين حديث
  const pid = sql(`set role authenticated; set request.jwt.claim.sub = '${sara}';
    select register_patient('مريض واجهة AUC', (current_date - interval '60 years 2 months')::date, 'male', 170, 70, '07700000301', null, null);`).split('\n').pop();

  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [], checks = [];
  const ok = (name, cond) => checks.push((cond ? 'PASS ' : 'FAIL ') + name);
  let n = 0;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ' });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && /\/(rest|storage)\/v1\//.test(r.url()) && !r.url().includes('/rpc/')) errors.push(`${r.status()} ${r.url().slice(22, 170)}`); });
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/auc-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true }); };
  await page.goto(B + '#/login');
  await page.getByLabel('البريد الإلكتروني').fill('sara@test.iq');
  await page.getByLabel('كلمة المرور').fill('Pass12345');
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForSelector('text=جلسات اليوم');

  await page.goto(B + '#/plan-new?patient=' + pid);
  await page.locator('button.option', { hasText: 'TEC' }).first().click();
  const scr = page.getByLabel('كرياتينين المصل (mg/dL)');
  ok('creatinine box shown', await scr.isVisible());
  ok('no recent creatinine message', (await page.locator('text=لا توجد نتيجة كرياتينين خلال آخر 30 يوماً').count()) === 1);
  await scr.fill('1');
  // CrCl = 80 × 70 / 72 = 78 ← 5 × 103 = 515
  ok('CG line', (await page.locator('text=/= 78 mL\\/min/').count()) === 1);
  ok('carboplatin preview 515', (await page.locator('text=AUC 5 × (CrCl 78 + 25) = 515 mg').count()) === 1);
  await shot('plan-preview');
  await page.getByRole('button', { name: 'إنشاء الخطة' }).click();
  await page.waitForURL(/#\/patient\?id=/);
  ok('creatinine saved as lab', sql(`select count(*) from lab_results where patient_id = '${pid}' and test_name = 'Creatinine' and value = 1`) === '1');
  ok('plan carboplatin 515', sql(`select string_agg(distinct d.final_dose::text, ',') from cycle_doses d join cycles c on c.id = d.cycle_id join treatments t on t.id = c.treatment_id where t.patient_id = '${pid}' and d.drug_name = 'Carboplatin'`) === '515');

  // كرياتينين أحدث 1.4 ثم إعادة الحساب في الدورة 2: CrCl = 5600 / 100.8 = 56 ← 5 × 81 = 405
  sql(`insert into lab_results(patient_id, test_date, test_name, value, unit) values ('${pid}', current_date, 'Creatinine', 1.4, 'mg/dL')`);
  const c2 = sql(`select c.id from cycles c join treatments t on t.id = c.treatment_id where t.patient_id = '${pid}' and c.cycle_no = 2`);
  await page.goto(B + '#/cycle?id=' + c2);
  await page.waitForSelector('text=Carboplatin');
  ok('cycle shows calc note', (await page.locator('text=/AUC 5 × \\(CrCl 78 \\+ 25\\) = 515/').count()) >= 1);
  await page.getByRole('button', { name: 'إعادة حساب Carboplatin بأحدث كرياتينين' }).click();
  await page.locator('dialog button, .dialog button', { hasText: 'إعادة الحساب' }).last().click();
  await page.waitForSelector('text=/CrCl 56 \\+ 25\\) = 405/');
  ok('recalculated 405', sql(`select final_dose from cycle_doses where cycle_id = '${c2}' and drug_name = 'Carboplatin'`) === '405');
  await shot('cycle-recalc');
  console.log(checks.join('\n'));
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
