// اختبار الخطوة 5 على القاعدة الحقيقية: التحاليل والمرفقات والمزج والتمريض (pgrest-lite على 8788)
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
    await nav(page, B + '#/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('Pass12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForSelector('text=جلسات اليوم');
    return page;
  }
  // الانتقال إلى الرابط نفسه لا يعيد التحميل؛ أعد تحميل الصفحة حينها
  const nav = async (page, url) => { if (page.url() === url) await page.reload(); else await page.goto(url); };
  const shot = async (page, name, full = true) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/s5-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const confirm = (page, label) => page.locator('dialog').getByRole('button', { name: label, exact: true }).click();
  const openPatient = async (page, name) => { await nav(page, B + '#/patients?f=all'); await page.waitForSelector('main .row'); await page.locator('main .row', { hasText: name }).click(); await page.waitForSelector('text=خطة العلاج الحالية'); };
  const cycleUrlOf = async (page, name, no) => { await openPatient(page, name); await page.locator(`a[aria-label^="الجرعة ${no}،"]`).click(); await page.waitForSelector('text=الجرعات الدوائية'); return page.url(); };

  const sara = await login('sara@test.iq');
  const cp = await login('cp@test.iq');
  const mix = await login('mix@test.iq');
  const nurse = await login('nurse@test.iq');

  // ===== 1. التحاليل: صورة ثم قيم، مرتان لرسم المنحنى
  const ali = await cycleUrlOf(sara, 'علي حسين', 3);
  ok('cycle shows no CBC yet', (await sara.locator('text=أدخل نتائج تعداد الدم قبل اعتماد الجرعة').count()) === 1);
  await openPatient(nurse, 'علي حسين');
  await nurse.getByRole('link', { name: 'رفع تحليل أو وصفة أو مرفق' }).click();
  await nurse.waitForSelector('text=نوع المرفق');
  await nurse.locator('#up-file').setInputFiles(FIX + '/cbc.jpg');
  await nurse.getByLabel('العنوان (اختياري)').fill('تعداد دم كامل');
  await shot(nurse, 'upload');
  await nurse.getByRole('button', { name: 'رفع وحفظ في ملف المريض' }).click();
  await nurse.waitForSelector('text=صورة التحليل');
  ok('upload → lab entry with image and auto-read', true);
  // الصورة هنا بلا قيم: تفشل القراءة بهدوء ويبقى الإدخال اليدوي
  ok('unreadable image → manual entry', await nurse.locator('text=لم تُقرأ قيم تعداد الدم من هذه الصورة').waitFor({ timeout: 120000 }).then(() => true, () => false));
  await nurse.getByLabel('WBC (×10⁹/L)').fill('3.1');
  await nurse.getByLabel('ANC (×10⁹/L)').fill('1.2');
  await nurse.getByLabel('Hb (g/dL)').fill('10.4');
  await nurse.getByLabel('PLT (×10⁹/L)').fill('132');
  ok('live low flags', (await nurse.locator('.lab-flag.low').count()) === 4);
  await shot(nurse, 'lab-entry', false);
  await nurse.getByRole('button', { name: 'حفظ النتائج' }).click();
  await nurse.waitForSelector('text=كل القيم');
  await nurse.waitForTimeout(300);
  ok('toast reports 4 out of range', (await nurse.locator('#toast').textContent()).includes('4 خارج الحد الطبيعي'));
  // قيم سابقة قبل 21 يوماً
  await nav(nurse, nurse.url().replace('#/labs?', '#/labs-new?'));
  await nurse.waitForSelector('text=تاريخ سحب العينة');
  const d21 = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  await nurse.getByLabel('تاريخ سحب العينة').fill(d21);
  await nurse.getByLabel('WBC (×10⁹/L)').fill('6.2');
  await nurse.getByLabel('ANC (×10⁹/L)').fill('3.8');
  await nurse.getByLabel('Hb (g/dL)').fill('12.9');
  await nurse.getByLabel('PLT (×10⁹/L)').fill('240');
  await nurse.getByRole('button', { name: 'حفظ النتائج' }).click();
  await nurse.waitForSelector('svg.spark');
  ok('trend charts drawn', (await nurse.locator('svg.spark').count()) === 4);
  await shot(nurse, 'labs-view');
  const notifs = await sara.evaluate(async () => 0);
  void notifs;

  // ===== 2. الاعتماد مع آخر تعداد: تصل الدورة إلى المزج فوراً (الملف 14: لا تحقق ولا تحويل يدوي)
  await nav(sara, ali); await sara.waitForSelector('.cbc');
  ok('cycle shows latest CBC with flags', (await sara.locator('.cbc-i.low').count()) === 4);
  await sara.getByRole('button', { name: 'اعتماد الجرعة' }).click(); await confirm(sara, 'اعتماد');
  await sara.waitForSelector('.step.done');
  ok('approval sends cycle to mixing', await sara.locator('.pill', { hasText: 'وصل قسم المزج' }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await nav(cp, ali); await cp.waitForSelector('text=صورة الجرعة من طبلة المريض');
  ok('no verify or transfer for pharmacist', (await cp.getByRole('button', { name: 'تحقق الصيدلاني' }).count()) === 0 && (await cp.getByRole('link', { name: 'تحويل للمزج' }).count()) === 0);
  await shot(cp, 'cycle-chart-due');

  // ===== 3. الصيدلي يرفق صورة الطبلة فتصل إلى المزج للتحقق
  await cp.locator('#chart-in').setInputFiles(FIX + '/rx.jpg');
  await cp.waitForSelector('.step.done >> text=صورة الطبلة من الصيدلي');
  ok('chart attached by pharmacist', (await cp.locator('.step.done', { hasText: 'رسل عادل' }).count()) === 1);
  await cp.locator('.pill', { hasText: 'وصل قسم المزج' }).click();
  await cp.waitForSelector('text=التحقق');
  ok('order created', (await cp.locator('.pill', { hasText: 'وارد' }).count()) === 1);
  ok('chart visible to order', (await cp.locator('.file-tile', { hasText: 'صورة الطبلة' }).count()) === 1 && (await cp.locator('text=لم تصل بعد').count()) === 0);
  ok('pharmacist sees no prepare boxes', (await cp.locator('main input[type=checkbox]').count()) === 0);
  await shot(cp, 'order-with-chart');

  // ===== 4. صيدلي المزج: تحضير وإرسال على دفعتين
  await nav(mix, B + '#/home'); await mix.waitForSelector('.dept');
  ok('mixing tile shows 1', (await mix.locator('[data-k="mix"] .count').textContent()) === '1');
  await mix.locator('[data-k="mix"]').click(); await mix.waitForSelector('main .row');
  await mix.locator('main .row').first().click(); await mix.waitForSelector('text=ضع علامة على ما حضّرته');
  const tick = async (drug) => { await mix.locator('label.row', { hasText: drug }).locator('input').check(); await mix.waitForSelector(`.mix-item.done >> text=${drug}`); };
  await tick('Rituximab'); await tick('Cyclophosphamide');
  await mix.getByRole('button', { name: /إرسال المحضَّر/ }).click(); await confirm(mix, 'إرسال');
  await mix.waitForSelector('.pill >> text=أُرسل جزء');
  ok('partial send', true);
  await tick('Doxorubicin'); await tick('Vincristine');
  await shot(mix, 'mixing-order');
  await mix.getByRole('button', { name: /إرسال المحضَّر/ }).click(); await confirm(mix, 'إرسال');
  await mix.waitForSelector('.pill >> text=أُرسل كاملاً');
  ok('fully sent', true);

  // ===== 5. التمريض: إعطاء اليوم الأول
  async function giveAll(page, url, day, reactionFor) {
    await nav(page, url);
    await page.waitForFunction((d) => (document.querySelector('.topbar .sub')?.textContent || '').endsWith('اليوم ' + d), day);
    await page.waitForSelector('main .row');
    for (;;) {
      const btn = page.getByRole('button', { name: 'تسجيل الإعطاء' }).first();
      if (!(await btn.count())) break;
      const drug = (await btn.locator('xpath=ancestor::div[contains(@class,"row")]').locator('.t').textContent()).trim();
      await btn.click(); await page.waitForSelector('dialog');
      await page.getByLabel('الضغط').fill('120/80'); await page.getByLabel('النبض').fill('82');
      await page.getByLabel('الحرارة').fill('36.8'); await page.getByLabel('الأكسجة %').fill('98');
      if (reactionFor && drug.startsWith(reactionFor)) {
        await page.locator('dialog').getByRole('button', { name: 'حدث تفاعل' }).click();
        await page.locator('dialog textarea').fill('قشعريرة وحكة بعد 20 دقيقة، أُوقف التسريب وأُعطي Chlorpheniramine، واستُكمل بنصف المعدل');
        await shot(page, 'give-reaction', false);
      }
      await confirm(page, 'تأكيد الإعطاء');
      await page.waitForSelector('dialog', { state: 'detached' });
      const before = await page.locator('main .pill.ok').count();
      await page.waitForFunction((b) => document.querySelectorAll('main .pill.ok').length > b, before - 1, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(700);
    }
  }
  await nav(nurse, B + '#/home'); await nurse.waitForSelector('.dept');
  await nurse.locator('.dept-t', { hasText: 'الإعطاء اليوم' }).click(); await nurse.waitForSelector('main .row');
  ok('nursing list shows ready patient', await nurse.locator('main .row', { hasText: 'علي حسين' }).locator('.pill', { hasText: 'جاهزة للإعطاء' }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await shot(nurse, 'nursing-list', false);
  await nurse.locator('main .row', { hasText: 'علي حسين' }).click(); await nurse.waitForSelector('text=قبل كل جرعة دوائية');
  const adminUrl = nurse.url();
  await giveAll(nurse, adminUrl, 1, 'Rituximab');
  ok('all 5 day-1 doses given', await nurse.waitForFunction(() => document.querySelectorAll('main .pill.ok').length === 5, null, { timeout: 5000 }).then(() => true, () => false));
  ok('reaction shown', (await nurse.locator('text=تفاعل: قشعريرة').count()) === 1);
  await shot(nurse, 'administered');
  await nav(nurse, adminUrl.replace('day=1', 'day=2')); await nurse.waitForSelector('main .row');
  ok('future day blocked', await nurse.locator('.pill', { hasText: 'لم يحن موعده' }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  ok('no horizontal overflow on phone', await nurse.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  // الطبيبة أُبلغت بالتفاعل
  await nav(sara, B + '#/notifications'); await sara.waitForSelector('main .row');
  ok('specialist notified of reaction', (await sara.locator('text=تفاعل أثناء الإعطاء').count()) >= 1);
  await nav(mix, B + '#/notifications'); await mix.waitForSelector('main .row');
  ok('mixing pharmacist notified of reaction too', (await mix.locator('text=تفاعل أثناء الإعطاء').count()) >= 1);

  // ===== 6. دورة كاملة لرقية: تبدأ قبل 4 أيام، والمزج يبدأ دون انتظار صورة الطبلة، ويغلقها مسؤول الصيادلة
  const ruq = await cycleUrlOf(sara, 'رقية', 1);
  await sara.getByRole('button', { name: 'اعتماد الجرعة' }).click(); await confirm(sara, 'اعتماد');
  await sara.waitForSelector('.step.done');
  const orderHref = await sara.locator('.pill', { hasText: 'وصل قسم المزج' }).first().getAttribute('href');
  await nav(mix, B + orderHref); await mix.waitForSelector('text=ضع علامة على ما حضّرته');
  ok('mixing starts before chart arrives', (await mix.locator('text=لم تصل بعد').count()) === 1);
  for (const d of ['Rituximab', 'Cyclophosphamide', 'Doxorubicin', 'Vincristine']) await tick(d);
  await mix.getByRole('button', { name: /إرسال المحضَّر/ }).click(); await confirm(mix, 'إرسال');
  await mix.waitForSelector('.pill >> text=أُرسل كاملاً');
  const cid = ruq.split('id=')[1];
  for (let day = 1; day <= 5; day++) await giveAll(nurse, `${B}#/administer?cycle=${cid}&day=${day}`, day);
  ok('nurse cannot close cycle', (await nurse.getByRole('button', { name: 'إغلاق الجرعة 1' }).count()) === 0);
  const chief = await login('admin@test.iq');
  await nav(chief, `${B}#/administer?cycle=${cid}&day=5`); await chief.waitForSelector('main .row');
  ok('chief sees close button on last day', await chief.getByRole('button', { name: 'إغلاق الجرعة 1' }).waitFor({ timeout: 8000 }).then(() => true, () => false));
  await chief.getByRole('button', { name: 'إغلاق الجرعة 1' }).click(); await confirm(chief, 'إغلاق');
  await chief.waitForTimeout(800);
  await nav(sara, ruq); await sara.waitForSelector('text=الجرعات الدوائية');
  ok('cycle closed as given', (await sara.locator('.pill', { hasText: 'أُعطيت' }).count()) >= 1);

  // ===== 7. الطبيب الدوري لا يرفع
  const intern = await login('intern@test.iq');
  await openPatient(intern, 'علي حسين');
  ok('intern has no upload button', (await intern.getByRole('link', { name: 'رفع تحليل أو وصفة أو مرفق' }).count()) === 0);
  await intern.getByRole('link', { name: /الملفات المرفقة/ }).click(); await intern.waitForSelector('.file-tile');
  ok('intern can view files (cbc + chart)', (await intern.locator('.file-tile').count()) === 2);
  await shot(intern, 'files', false);

  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
