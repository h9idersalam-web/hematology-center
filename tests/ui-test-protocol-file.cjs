// اختبار ملف البروتوكول المرجعي على القاعدة الحقيقية (pgrest-lite على 8788)
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const OUT = process.argv[2], FIX = process.argv[3];
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
    page.on('response', (r) => { if (r.status() >= 400 && /\/(rest|storage)\/v1\//.test(r.url()) && !r.url().includes('/rpc/')) errors.push(`${email} ${r.status()} ${r.url().slice(22, 170)}`); });
    await page.goto(B + '#/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('Pass12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForSelector('text=جلسات اليوم');
    return page;
  }
  const nav = async (page, url) => { if (page.url() === url) await page.reload(); else await page.goto(url); };
  const shot = async (page, name, full = true) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/pf-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const openProto = async (page, name) => { await nav(page, B + '#/protocols'); await page.waitForSelector('main .row'); await page.locator('main .row', { hasText: name }).first().click(); await page.waitForSelector('text=الملف المرجعي'); };
  const opensPdf = async (page, label) => {
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: label }).click()]);
    await popup.waitForURL(/object\/sign\//, { timeout: 8000 }).catch(() => {});
    const u = popup.url(); await popup.close(); return /object\/sign\/patient-files\/protocols\//.test(u);
  };

  const chief = await login('admin@test.iq');
  const sara = await login('sara@test.iq');

  // 1. مسؤول الصيادلة يرفق أول ملف لبروتوكول معتمد (ABVD)، ثم لا يستطيع استبداله
  await openProto(chief, 'ABVD');
  ok('no file notice shown', (await chief.locator('text=لم يُرفق ملف البروتوكول المعتمد في المركز بعد').count()) === 1);
  await chief.locator('#proto-file').setInputFiles(FIX + '/protocol.pdf');
  await chief.waitForSelector('text=فتح ملف البروتوكول');
  ok('chief attached first file', true);
  ok('chief cannot replace approved file', (await chief.locator('label[for="proto-file"]').count()) === 0 && (await chief.locator('text=استبدال ملف بروتوكول معتمد لطبيب الاختصاص فقط').count()) === 1);
  ok('opens signed PDF link', await opensPdf(chief, 'فتح ملف البروتوكول'));
  await shot(chief, 'protocol-with-file');

  // 2. طبيبة الاختصاص أُبلغت، وتستطيع الاستبدال
  await nav(sara, B + '#/notifications'); await sara.waitForSelector('main .row');
  ok('specialist notified', (await sara.locator('text=أُرفق ملف مرجعي لبروتوكول ABVD').count()) === 1);
  await openProto(sara, 'ABVD');
  ok('specialist sees replace', (await sara.locator('label[for="proto-file"]', { hasText: 'استبدال الملف' }).count()) === 1);
  await sara.locator('#proto-file').setInputFiles(FIX + '/protocol.pdf');
  await sara.waitForTimeout(1500);
  ok('specialist replaced', (await sara.locator('#toast').textContent()).includes('أُرفق الملف'));

  // 3. بروتوكول جديد بملفه من النموذج
  await nav(chief, B + '#/protocol-new'); await chief.waitForSelector('text=بيانات البروتوكول');
  await chief.getByLabel('الاسم المختصر').fill('CVP');
  await chief.getByLabel('المرض').fill('لمفوما لاهودجكينية منخفضة الدرجة');
  await chief.getByLabel('طول الدورة (يوم)').fill('21');
  await chief.getByLabel('عدد الدورات').fill('8');
  await chief.getByLabel('ملف البروتوكول المرجعي (اختياري)').setInputFiles(FIX + '/protocol.pdf');
  const d1 = chief.locator('.card', { hasText: 'الدواء 1' });
  await d1.getByLabel('اسم الدواء (بالإنجليزية)').fill('Cyclophosphamide');
  await d1.getByLabel('الجرعة', { exact: true }).fill('750');
  await chief.getByRole('button', { name: 'حفظ وإرسال للاعتماد' }).click();
  await chief.waitForSelector('text=غير معتمد: لا يُستخدم');
  ok('new protocol has file', (await chief.getByRole('button', { name: 'فتح ملف البروتوكول' }).count()) === 1);
  ok('unapproved: author may still replace', (await chief.locator('label[for="proto-file"]').count()) === 1);
  await shot(chief, 'new-protocol-file');

  // 4. الرابط يظهر عند إنشاء الخطة وفي شاشة الدورة
  await nav(sara, B + '#/patients?f=none'); await sara.waitForSelector('main .row');
  await sara.locator('main .row', { hasText: 'كرار' }).click();
  await sara.getByRole('link', { name: 'إنشاء خطة علاج' }).click();
  await sara.getByRole('button', { name: /ABVD/ }).click(); await sara.waitForSelector('text=معاينة الجرعات');
  ok('plan form links protocol file', (await sara.getByRole('button', { name: 'مطابقة مع ملف البروتوكول ABVD' }).count()) === 1);
  await shot(sara, 'plan-file-link', false);
  await sara.getByRole('button', { name: 'إنشاء الخطة' }).click(); await sara.waitForSelector('text=خطة العلاج الحالية');
  await sara.locator('a[aria-label^="الدورة 1،"]').click(); await sara.waitForSelector('text=الجرعات');
  ok('cycle screen links protocol file', await opensPdf(sara, 'ملف البروتوكول ABVD'));

  // 5. الطبيب الدوري يفتح ولا يرفق
  const intern = await login('intern@test.iq');
  await openProto(intern, 'ABVD');
  ok('intern can open, cannot attach', (await intern.getByRole('button', { name: 'فتح ملف البروتوكول' }).count()) === 1 && (await intern.locator('#proto-file').count()) === 0);

  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
