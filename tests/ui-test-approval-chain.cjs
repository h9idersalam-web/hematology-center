// اختبار سلسلة الموافقات الجديدة (الملف 14) على الواجهة: pgrest-lite على المنفذ 8788
//   node tests/ui-test-approval-chain.cjs ./shots
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
    page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/rest/v1/') && !r.url().includes('/rpc/')) errors.push(`${email} ${r.status()} ${r.url().slice(22, 170)}`); });
    await page.goto(B + '#/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('Pass12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForSelector('text=جلسات اليوم');
    return page;
  }
  const nav = async (page, url) => { if (page.url() === url) await page.reload(); else await page.goto(url); };
  const shot = async (page, name, full = true) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/ac-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const confirm = (page, label) => page.locator('dialog').getByRole('button', { name: label, exact: true }).click();
  const openPatient = async (page, name) => { await nav(page, B + '#/patients?f=all'); await page.waitForSelector('main .row'); await page.locator('main .row', { hasText: name }).click(); await page.waitForSelector('text=خطة العلاج الحالية'); };

  const chief = await login('admin@test.iq');      // مسؤول الصيادلة ومدير البرنامج
  const sara = await login('sara@test.iq');        // الطبيبة المختصة بكل مرضى البيانات التجريبية
  const ali = await login('ali@test.iq');          // طبيب اختصاص آخر
  const sr = await login('morteza@test.iq');
  const cp = await login('cp@test.iq');
  const mix = await login('mix@test.iq');

  // ===== 1. خطة تنتظر الموافقة: للطبيبة المختصة بالمريض فقط
  await openPatient(ali, 'حسن رعد');
  ok('other specialist sees no approve button', (await ali.getByRole('button', { name: 'الموافقة على الخطة' }).count()) === 0
     && (await ali.locator('text=للطبيب المختص بالمريض').count()) === 1);
  await openPatient(sara, 'حسن رعد');
  ok('patient specialist sees approve and reject', (await sara.getByRole('button', { name: 'الموافقة على الخطة' }).count()) === 1
     && (await sara.getByRole('button', { name: 'رفض الخطة' }).count()) === 1);
  await shot(sara, 'plan-approve-reject');
  await sara.getByRole('button', { name: 'رفض الخطة' }).click();
  await sara.locator('dialog textarea').fill('نحتاج تأكيد التشخيص بالخزعة');
  await confirm(sara, 'رفض');
  await sara.waitForSelector('text=خطط سابقة');
  ok('plan rejected with reason', (await sara.locator('text=نحتاج تأكيد التشخيص بالخزعة').count()) >= 1);

  // ===== 2. الرديف: المدير يعيّن، ومسؤول الصيادلة يفعّل
  await nav(chief, B + '#/admin?tab=users'); await chief.waitForSelector('text=رسل عادل');
  await chief.locator('article', { hasText: 'رسل عادل' }).getByRole('button', { name: 'تعيينه رديفاً لمسؤول الصيادلة' }).click();
  await confirm(chief, 'تعيين');
  await chief.waitForSelector('text=رديف مسؤول الصيادلة (الصلاحيات موقوفة)');
  ok('admin designated deputy', true);
  await nav(chief, B + '#/home'); await chief.waitForSelector('text=رديف مسؤول الصيادلة');
  await shot(chief, 'chief-deputy-off', false);
  await chief.getByRole('button', { name: 'تفعيل الصلاحيات' }).click(); await confirm(chief, 'تفعيل');
  await chief.waitForSelector('text=الصلاحيات مفعّلة');
  ok('chief activated deputy', true);
  await nav(cp, B + '#/home'); await cp.reload(); await cp.waitForSelector('text=جلسات اليوم');
  ok('deputy sees acting role', await cp.locator('text=رديف مسؤول الصيادلة (الصلاحيات مفعّلة)').waitFor({ timeout: 70000 }).then(() => true, () => false));
  await shot(cp, 'deputy-home', false);
  ok('deputy has no toggle of own', (await cp.getByRole('button', { name: 'تفعيل الصلاحيات' }).count()) === 0);

  // ===== 3. اعتماد دورة اليوم لعلي: تصل إلى المزج، ثم طلب المزج للجرعة فقط
  await openPatient(sara, 'علي حسين');
  await sara.locator('a[aria-label^="الدورة 3،"]').click(); await sara.waitForSelector('text=الجرعات');
  const cycleUrl = sara.url();
  await sara.getByRole('button', { name: 'اعتماد الدورة' }).click(); await confirm(sara, 'اعتماد');
  await sara.locator('.pill', { hasText: 'وصل قسم المزج' }).waitFor();
  ok('approved cycle reached mixing', true);

  await nav(mix, cycleUrl); await mix.waitForSelector('text=الجرعات');
  await mix.getByRole('link', { name: 'اقتراح تعديل على الطبيب' }).click(); await mix.waitForSelector('text=تقرير الأسباب للطبيب');
  ok('mixing: dose only (no infusion, add, diagnosis, protocol, remove)',
    (await mix.locator('text=المحلول ومعدل التسريب').count()) === 0 && (await mix.locator('text=إضافة دواء').count()) === 0
    && (await mix.locator('text=التشخيص والمرحلة').count()) === 0 && (await mix.locator('text=حذف الدواء').count()) === 0);
  await mix.locator('.dose-edit', { hasText: 'Doxorubicin' }).getByRole('button', { name: '75%' }).click();
  await mix.getByRole('button', { name: 'أخرى' }).click();
  await mix.getByLabel('التقرير').fill('الفيال المتوفر 50 ملغ؛ نقترح تقريب الجرعة.');
  await shot(mix, 'mixing-request-form');
  await mix.getByRole('button', { name: 'إرسال الطلب' }).click(); await confirm(mix, 'إرسال');
  await mix.waitForSelector('text=بانتظار القرار');
  const reqUrl = mix.url();

  // مسؤول الصيادلة (والرديف المفعّل) لا يقرّر طلب المزج؛ المقيم الأقدم يقرّر
  await nav(chief, reqUrl); await chief.waitForSelector('text=البنود');
  ok('chief cannot decide mixing request', (await chief.locator('text=قرارك').count()) === 0 && (await chief.locator('text=القرار لـالطبيب المختص بهذا المريض أو المقيم الأقدم').count()) === 1);
  await nav(sr, reqUrl); await sr.waitForSelector('text=قرارك');
  await sr.getByRole('button', { name: 'موافقة على البنود المحددة' }).click();
  ok('confirm warns approval drops', (await sr.locator('dialog', { hasText: 'يُسقط اعتماد الدورة' }).count()) === 1);
  await confirm(sr, 'موافقة');
  await sr.waitForSelector('text=وُوفق عليه');

  // ===== 4. الدورة معلّقة في المزج حتى يُعاد الاعتماد
  await nav(sara, cycleUrl); await sara.waitForSelector('text=الجرعات');
  ok('cycle shows hold notice', (await sara.locator('text=فعُلّق المزج حتى يعيد الطبيب اعتمادها').count()) === 1);
  ok('re-approve button back', (await sara.getByRole('button', { name: 'اعتماد الدورة' }).count()) === 1);
  await shot(sara, 'cycle-held');
  const orderHref = await sara.locator('.pill', { hasText: 'معلّق' }).first().getAttribute('href');
  await nav(mix, B + orderHref); await mix.waitForSelector('text=الطلب معلّق');
  ok('mixing order held, no prepare boxes', (await mix.locator('main input[type=checkbox]').count()) === 0);
  await shot(mix, 'order-held');
  await sara.getByRole('button', { name: 'اعتماد الدورة' }).click(); await confirm(sara, 'اعتماد');
  await sara.locator('.pill', { hasText: 'وصل قسم المزج' }).waitFor();
  await nav(mix, B + orderHref); await mix.waitForSelector('text=ضع علامة على ما حضّرته');
  ok('order resumes after re-approval', (await mix.locator('main input[type=checkbox]').count()) >= 1);

  // ===== 5. الصيدلي السريري العادي: صورة الطبلة مهمة على صفحته الرئيسية
  await nav(chief, B + '#/home'); await chief.waitForSelector('text=بانتظار صورة الطبلة منك');
  ok('chart task listed on pharmacist home', (await chief.locator('section', { hasText: 'بانتظار صورة الطبلة منك' }).locator('.row').count()) >= 1);
  await shot(chief, 'chief-home-tasks', false);

  // ===== 6. إيقاف الرديف يعيده صيدلياً سريرياً
  await chief.getByRole('button', { name: 'إيقاف الصلاحيات' }).click(); await confirm(chief, 'إيقاف');
  await chief.waitForSelector('text=الصلاحيات موقوفة');
  await cp.evaluate(() => { location.hash = '#/home'; });
  await cp.reload(); await cp.waitForSelector('text=جلسات اليوم');
  ok('deputy back to clinical pharmacist', await cp.locator('text=صيدلي سريري · رديف (الصلاحيات موقوفة)').waitFor({ timeout: 70000 }).then(() => true, () => false));

  ok('no horizontal overflow', await sara.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
