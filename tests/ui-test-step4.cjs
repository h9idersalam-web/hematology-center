// اختبار الخطوة 4 على القاعدة الحقيقية (tests/pgrest-lite.mjs على المنفذ 8788)
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

  async function login(email) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ' });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    page.on('pageerror', (e) => errors.push(email + ' pageerror: ' + e.message));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/rest/v1/') && !r.url().includes('/rpc/')) errors.push(`${email} ${r.status()} ${r.url().slice(22, 160)}`); });
    page.on('dialog', (d) => d.accept());
    await page.goto(B + '#/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('Pass12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForSelector('text=جلسات اليوم');
    return page;
  }
  const shot = async (page, name, full = true) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/s4-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const confirm = async (page, label) => { await page.locator('dialog').getByRole('button', { name: label, exact: true }).click(); };
  const toastText = async (page) => { await page.waitForTimeout(300); return page.locator('#toast').textContent(); };

  // ===== A. مسؤول الصيادلة يضيف بروتوكولاً (يبقى غير معتمد)
  const chief = await login('admin@test.iq');
  await chief.goto(B + '#/protocols'); await chief.waitForSelector('main .row');
  ok('approved tab lists 3 protocols', (await chief.locator('main .row').count()) === 3);
  await shot(chief, 'protocols');
  await chief.goto(B + '#/protocol-new'); await chief.waitForSelector('text=بيانات البروتوكول');
  await chief.getByLabel('الاسم المختصر').fill('BR-T');
  await chief.getByLabel('المرض').fill('لمفوما الخلايا الصغيرة');
  await chief.getByLabel('المدة بين الجرعات (يوم)').fill('28');
  await chief.getByLabel('عدد الجرعات').fill('6');
  const d1 = chief.locator('.card', { hasText: 'الدواء 1' });
  await d1.getByLabel('اسم الدواء (بالإنجليزية)').fill('Rituximab');
  await d1.getByLabel('الجرعة الدوائية', { exact: true }).fill('375');
  await chief.getByRole('button', { name: 'إضافة دواء' }).click();
  const d2 = chief.locator('.card', { hasText: 'الدواء 2' });
  await d2.getByLabel('اسم الدواء (بالإنجليزية)').fill('Bendamustine');
  await d2.getByLabel('الجرعة الدوائية', { exact: true }).fill('90');
  await d2.getByLabel('أيام الإعطاء داخل الجرعة').fill('1-40');
  await chief.getByRole('button', { name: 'حفظ وإرسال للاعتماد' }).click();
  await chief.waitForSelector('text=أيام الإعطاء غير صحيحة');
  ok('days beyond cycle length rejected', true);
  await d2.getByLabel('أيام الإعطاء داخل الجرعة').fill('1-2');
  ok('live example shown', (await d2.locator('text=مثال لمريض 1.8 م² و70 كغ: 162 ملغ').count()) === 1);
  await shot(chief, 'protocol-form');
  await chief.getByRole('button', { name: 'حفظ وإرسال للاعتماد' }).click();
  await chief.waitForSelector('text=غير معتمد: لا يُستخدم لأي مريض قبل اعتماده');
  ok('new protocol pending', true);
  await shot(chief, 'protocol-pending');

  // ===== B. طبيبة الاختصاص تعتمده
  const sara = await login('sara@test.iq');
  await sara.goto(B + '#/protocols?t=pending'); await sara.waitForSelector('main .row');
  await sara.locator('main .row', { hasText: 'BR-T' }).click();
  await sara.getByRole('button', { name: 'اعتماد البروتوكول' }).click();
  await confirm(sara, 'اعتماد');
  await sara.waitForSelector('text=اعتمده د. سارة الربيعي');
  ok('specialist approved protocol', true);

  // ===== C. خطة R-CHOP لكرار مع معاينة الجرعات
  await sara.goto(B + '#/patients?f=none'); await sara.waitForSelector('main .row');
  await sara.locator('main .row', { hasText: 'كرار' }).click();
  await sara.getByRole('link', { name: 'إنشاء خطة علاج' }).click();
  await sara.waitForSelector('text=البروتوكول');
  await sara.getByRole('button', { name: /R-CHOP-21/ }).click();
  await sara.waitForSelector('text=معاينة الجرعات الدوائية');
  const prev = await sara.locator('main').textContent();
  ok('preview BSA 2.13', prev.includes('BSA 2.13'));
  ok('preview rituximab 799', /Rituximab[\s\S]*799/.test(prev));
  ok('preview vincristine capped to 2', prev.includes('قُصّت إلى السقف 2 ملغ (المحسوب 3)'));
  const dxOpts = await sara.locator('#dx-sel option').allTextContents();
  ok('diagnosis list: English abbreviations, lymphomas only + Other', dxOpts.includes('DLBCL — Diffuse large B-cell lymphoma') && dxOpts.includes('NHL — Non-Hodgkin lymphoma') && dxOpts.includes('Other') && !dxOpts.some((t) => /^(MM|AML|B-ALL|SCD) —/.test(t)) && !dxOpts.some((t) => /[\u0600-\u06FF]/.test(t) && t !== 'اختر التشخيص'));
  await sara.locator('#dx-sel').selectOption('DLBCL');
  ok('no ICD-10 field', (await sara.getByLabel('رمز ICD-10').count()) === 0);
  await sara.getByRole('button', { name: 'إنشاء الخطة' }).click();
  ok('status required', await sara.locator('text=اختر حالة المرض').waitFor({ timeout: 3000 }).then(() => true, () => false));
  await sara.getByRole('radio', { name: /Initial treatment/ }).click();
  await sara.getByLabel('درجة المرض').selectOption('Grade 3');
  await shot(sara, 'plan-preview');
  await sara.getByRole('button', { name: 'إنشاء الخطة' }).click();
  await sara.waitForSelector('text=خطة العلاج الحالية');
  ok('plan active', (await sara.locator('.pill', { hasText: 'فعّالة' }).count()) === 1);
  ok('dates: English digits + weekday', /\d{4}\/\d{1,2}\/\d{1,2} - (الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت)/.test(await sara.locator('main').textContent()) && !/(تشرين|كانون|شباط|آذار|نيسان|أيار|حزيران|تموز|أيلول)/.test(await sara.locator('main').textContent()));
  { const pt = await sara.locator('main').textContent(); ok('patient shows status + grade + diagnosis (English)', pt.includes('Initial treatment') && pt.includes('Grade 3') && pt.includes('DLBCL — Diffuse large B-cell lymphoma') && !pt.includes('علاج أولي') && !pt.includes('C83.3')); }
  const pid = sara.url().split('id=')[1];
  await sara.locator('a[aria-label^="الجرعة 1،"]').click();
  await sara.waitForSelector('text=الجرعات الدوائية');
  const cyc = await sara.locator('main').textContent();
  ok('DB doses match preview (799, 1598, 107, 2)', ['799', '1598', '107'].every((x) => cyc.includes(x)) && cyc.includes('بالسقف (المحسوب 3)'));
  const cycleUrl = sara.url();
  await sara.getByRole('button', { name: 'اعتماد الجرعة' }).click(); await confirm(sara, 'اعتماد');
  await sara.waitForSelector('text=اعتماد الطبيب');
  await sara.waitForTimeout(500);
  ok('cycle approved by sara', (await sara.locator('.step.done', { hasText: 'د. سارة الربيعي' }).count()) === 1);
  await shot(sara, 'cycle-approved');

  // ===== D. الصيدلي السريري: لا تحقق (الملف 14)، الدورة في المزج، ومهمته صورة الطبلة، ثم اقتراح تعديل
  const cp = await login('cp@test.iq');
  await cp.goto(cycleUrl); await cp.waitForSelector('text=صورة الجرعة من طبلة المريض');
  ok('cp has no approve button', (await cp.getByRole('button', { name: 'اعتماد الجرعة' }).count()) === 0);
  ok('no pharmacist verification step', (await cp.getByRole('button', { name: 'تحقق الصيدلاني' }).count()) === 0);
  ok('cycle reached mixing on approval', (await cp.locator('.pill', { hasText: 'وصل قسم المزج' }).count()) >= 1);
  ok('chart task shown to pharmacist', (await cp.locator('text=مطلوب منك: صوّر الجرعة').count()) === 1);
  await shot(cp, 'cycle-chart-task');
  await cp.getByRole('link', { name: 'اقتراح تعديل على الطبيب' }).click();
  await cp.waitForSelector('text=تقرير الأسباب للطبيب');
  ok('clinical pharmacist cannot change protocol/diagnosis', (await cp.locator('text=تغيير البروتوكول').count()) === 0 && (await cp.locator('text=حذف الدواء').count()) === 0);
  const dox = cp.locator('.dose-edit', { hasText: 'Doxorubicin' });
  await dox.getByRole('button', { name: '75%' }).click();
  ok('75% → 80', (await dox.locator('input[type=number]').inputValue()) === '80');
  await cp.getByText('أضف دواءً داعماً', { exact: true }).click();
  await cp.getByLabel('اسم الدواء (بالإنجليزية)').fill('Ondansetron');
  await cp.getByLabel('الجرعة الدوائية النهائية').fill('8');
  await cp.getByRole('button', { name: 'وظائف الكبد' }).click();
  await cp.getByLabel('التقرير').fill('البيليروبين 2.4 ملغ/دل (1.2 إلى 3 أضعاف الحد الأعلى). يُنصح بتخفيض دوكسوروبيسين 25% حسب مرجع eviQ.');
  await shot(cp, 'request-form');
  await cp.getByRole('button', { name: 'إرسال الطلب' }).click(); await confirm(cp, 'إرسال');
  await cp.waitForSelector('text=بانتظار القرار');
  ok('request created with 2 items', (await cp.locator('main .row').count()) === 2);
  await shot(cp, 'request-sent');

  // ===== E. الطبيبة تقرّر: توافق على الجرعة وترفض الدواء المضاف
  await sara.goto(B + '#/home'); await sara.waitForSelector('text=بانتظار موافقتك');
  ok('home shows 1 awaiting', (await sara.locator('.stat.info .n').textContent()) === '1');
  await sara.locator('.stat.info').click(); await sara.waitForSelector('main .row');
  await shot(sara, 'requests-list', false);
  await sara.locator('main .row').first().click(); await sara.waitForSelector('text=قرارك');
  await sara.locator('label.row', { hasText: 'Ondansetron' }).locator('input').uncheck();
  await sara.getByLabel('ملاحظة').fill('Ondansetron موصوف فموياً في وصفة المريض.');
  await shot(sara, 'request-decide');
  await sara.getByRole('button', { name: 'موافقة على البنود المحددة' }).click(); await confirm(sara, 'موافقة');
  await sara.waitForSelector('text=موافقة جزئية');
  ok('partial approval', (await toastText(sara)).includes('جزء'));
  await sara.goto(cycleUrl); await sara.waitForSelector('text=الجرعات الدوائية');
  const after = await sara.locator('main').textContent();
  ok('doxorubicin 80, edited from 107', after.includes('عُدّلت من 107') && after.includes('80'));
  ok('ondansetron not added', !after.includes('Ondansetron'));
  ok('doctor decision keeps cycle approval', (await sara.locator('.step.done', { hasText: 'د. سارة الربيعي' }).count()) === 1);
  await shot(sara, 'cycle-after-decision');

  // ===== F. المقيم الأقدم: تعديل مباشر
  const sr = await login('morteza@test.iq');
  await sr.goto(cycleUrl); await sr.waitForSelector('text=الجرعات الدوائية');
  await sr.getByRole('link', { name: 'تعديل الجرعات الدوائية أو الخطة' }).click(); await sr.waitForSelector('text=التشخيص والمرحلة');
  const cyclo = sr.locator('.dose-edit', { hasText: 'Cyclophosphamide' });
  await cyclo.getByRole('button', { name: '80%' }).click();
  await cyclo.getByLabel('تطبيق على هذه الجرعة والجرعات التالية').uncheck();
  await sr.getByLabel('ملاحظة (اختيارية)').fill('نقص العدلات الدرجة 2');
  await sr.getByRole('button', { name: 'تطبيق التعديلات' }).click(); await confirm(sr, 'تطبيق');
  await sr.waitForSelector('text=عُدّلت من 1598');
  ok('senior resident edit applied (1278)', (await sr.locator('main').textContent()).includes('1278'));

  // ===== G. خطة من مسؤول الصيادلة تنتظر الموافقة، ثم الإيقاف
  await chief.goto(B + '#/patients?f=none'); await chief.waitForSelector('main .row');
  await chief.locator('main .row', { hasText: 'أمير' }).click();
  await chief.getByRole('link', { name: 'إنشاء خطة علاج' }).click();
  await chief.getByRole('button', { name: /ABVD/ }).click();
  await chief.locator('#dx-sel').selectOption('HL'); await chief.getByRole('radio', { name: /Relapse/ }).click();
  await chief.getByRole('button', { name: 'حفظ وإرسال للطبيب المختص' }).click();
  await chief.waitForSelector('text=بانتظار موافقة الطبيب المختص');
  ok('chief plan pending', true);
  const amirUrl = chief.url();
  await sara.goto(amirUrl); await sara.waitForSelector('text=الموافقة على الخطة');
  await sara.getByRole('button', { name: 'الموافقة على الخطة' }).click(); await confirm(sara, 'موافقة');
  await sara.waitForSelector('.pill >> text=فعّالة');
  ok('specialist approved plan', true);
  await sara.getByRole('button', { name: 'إيقاف الخطة' }).click();
  await sara.locator('dialog textarea').fill('رغبة المريض');
  await confirm(sara, 'إيقاف الخطة');
  await sara.waitForSelector('text=خطط سابقة');
  ok('plan stopped → previous plans', (await sara.locator('text=رغبة المريض').count()) >= 1);

  // ===== H. الطبيب الدوري يرى فقط
  const intern = await login('intern@test.iq');
  await intern.goto(cycleUrl); await intern.waitForSelector('text=الجرعات الدوائية');
  ok('intern sees no action buttons', (await intern.locator('main .btn').count()) === 0);
  await intern.goto(B + '#/patient?id=' + pid); await intern.waitForSelector('text=خطة العلاج الحالية');
  ok('intern cannot stop plan', (await intern.getByRole('button', { name: 'إيقاف الخطة' }).count()) === 0);

  // ===== I. مسؤول الصيادلة يطلب تغيير البروتوكول، والطبيبة توافق
  await chief.goto(cycleUrl); await chief.waitForSelector('text=الجرعات الدوائية');
  await chief.getByRole('link', { name: 'اقتراح تعديل على الطبيب' }).click(); await chief.waitForSelector('text=تغيير البروتوكول');
  await chief.getByLabel('البروتوكول الجديد').selectOption({ label: 'BR-T · لمفوما الخلايا الصغيرة' });
  await chief.getByLabel('تاريخ أول جرعة').fill(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  await chief.getByRole('button', { name: 'تعداد الدم' }).click();
  await chief.getByLabel('التقرير').fill('إعادة تصنيف المرض بعد الخزعة: لمفوما خلايا صغيرة. نقترح BR.');
  await chief.getByRole('button', { name: 'إرسال الطلب' }).click(); await confirm(chief, 'إرسال');
  await chief.waitForSelector('text=إلى BR-T');
  await sara.goto(chief.url()); await sara.waitForSelector('text=قرارك');
  await sara.getByRole('button', { name: 'موافقة على البنود المحددة' }).click(); await confirm(sara, 'موافقة');
  await sara.waitForSelector('text=وُوفق عليه');
  await sara.goto(B + '#/patient?id=' + pid); await sara.waitForSelector('text=خطط سابقة');
  ok('protocol switched to BR-T, R-CHOP in previous', (await sara.locator('.tag', { hasText: 'BR-T' }).count()) >= 1);
  await shot(sara, 'patient-after-protocol-change');

  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
