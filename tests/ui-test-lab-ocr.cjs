// اختبار القراءة الآلية لصورة تعداد الدم في المتصفح (pgrest-lite على 8788)
//   node tests/ui-test-lab-ocr.cjs ./shots <مجلد العيّنات من tests/lab-ocr/make_samples.py>
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const { execFileSync } = require('node:child_process');
const OUT = process.argv[2], FIX = process.argv[3];
const B = 'http://localhost:8788/';
const psql = (sql) => execFileSync('psql', ['-h', '/var/lib/pgtest', '-p', '5499', '-U', 'postgres', '-Atc', sql]).toString().trim();

(async () => {
  await fetch(B + '__reset');
  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [], checks = [];
  const ok = (name, cond) => checks.push((cond ? 'PASS ' : 'FAIL ') + name);
  let n = 0;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ' });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const shot = async (name, full = true) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/ocr-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const confirm = () => page.locator('dialog').getByRole('button', { name: 'تأكيد', exact: true }).click().catch(() => {});

  await page.goto(B + '#/login');
  await page.getByLabel('البريد الإلكتروني').fill('cp@test.iq');
  await page.getByLabel('كلمة المرور').fill('Pass12345');
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForSelector('text=جلسات اليوم');
  const pid = psql("select id from patients where full_name like 'كرار%'");

  async function uploadAndRead(file) {
    await page.goto(`${B}#/upload?patient=${pid}&kind=lab`);
    await page.locator('#up-file').setInputFiles(`${FIX}/${file}`);
    await page.getByRole('button', { name: /رفع/ }).click();
    await page.waitForSelector('text=صورة التحليل');
    await page.waitForFunction(() => /قُرئت|لم تُقرأ|تعذّرت/.test(document.querySelector('main').textContent), null, { timeout: 120000 });
  }
  const val = (t) => page.locator('.lab-row', { hasText: t }).first().locator('.lab-v');

  // ===== 1. تقرير جهاز آلي (صورة هاتف): القيم والمراجع تُملأ وتُعلَّم
  const t0 = Date.now();
  await uploadAndRead('analyzer-photo.jpg');
  ok(`read in ${Math.round((Date.now() - t0) / 1000)}s`, true);
  ok('WBC 7.85', (await val('WBC').inputValue()) === '7.85');
  ok('ANC 5.12', (await val('ANC').inputValue()) === '5.12');
  ok('Hb 12.4', (await val('Hb').inputValue()) === '12.4');
  ok('PLT 245', (await val('PLT').inputValue()) === '245');
  ok('values marked as machine-read', (await page.locator('.lab-v.ocr, .lab-v.ocr-doubt').count()) === 4);
  ok('source line shown', (await page.locator('.lab-src code', { hasText: 'HGB' }).count()) === 1);
  ok('Hb flagged low against read range', (await page.locator('.lab-row', { hasText: 'Hb' }).first().locator('.lab-flag.low').count()) === 1);
  await shot('analyzer-filled');

  // الحفظ يحتاج تأكيد المراجعة (وعلامة لكل قيمة غير مؤكدة)
  await page.getByRole('button', { name: 'حفظ النتائج' }).click();
  ok('save blocked before review', await page.locator('.notice.err').waitFor({ timeout: 5000 }).then(() => true, () => false));
  for (const box of await page.locator('.lab-src input[type=checkbox]').all()) await box.check();
  await page.getByLabel('راجعت كل قيمة مقروءة آلياً مقابل صورة التحليل، وهي صحيحة').check();
  // تعديل يدوي لقيمة: تصبح إدخالاً عادياً
  await val('PLT').fill('246');
  ok('manual edit clears machine mark', (await page.locator('.lab-row', { hasText: 'PLT' }).first().locator('.lab-v.ocr, .lab-v.ocr-doubt').count()) === 0);
  await page.getByRole('button', { name: 'حفظ النتائج' }).click();
  await page.waitForURL(/#\/labs\?/, { timeout: 15000 }).catch(async () => console.log('SAVE ERR:', await page.locator('.notice.err').allTextContents()));
  await page.waitForTimeout(800);
  ok('saved with entry method', psql(`select string_agg(test_name || '=' || value || ':' || entry_method, ',' order by test_name) from lab_results where patient_id = '${pid}'`)
     === 'ANC=5.12:ocr,Hb=12.4:ocr,PLT=246:manual,WBC=7.85:ocr');
  ok('attachment linked', psql(`select count(distinct attachment_id) from lab_results where patient_id = '${pid}' and attachment_id is not null`) === '1');

  // ===== 2. وحدات /cmm: تحويل إلى ×10⁹/L
  await uploadAndRead('cmm-photo.jpg');
  ok('cmm WBC 3.2', (await val('WBC').inputValue()) === '3.2');
  ok('cmm PLT 85', (await val('PLT').inputValue()) === '85');
  ok('cmm Hb 9.8', (await val('Hb').inputValue()) === '9.8');
  ok('conversion explained', (await page.locator('text=حُوّل من /cmm').count()) >= 1);
  await shot('cmm-filled');

  // ===== 3. صورة رديئة: ما لا يُقرأ بثقة يُعلَّم بالأصفر ويحتاج علامة تحقق
  await uploadAndRead('flags1-photo.jpg');
  const doubts = await page.locator('.lab-v.ocr-doubt').count();
  const doubtBoxes = await page.locator('.lab-src input[type=checkbox]').count();
  ok(`poor photo: doubtful values need own check (${doubts})`, doubts === doubtBoxes);
  await shot('poor-photo');

  ok('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
