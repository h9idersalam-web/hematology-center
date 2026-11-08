// اختبار الصيدلية الداخلية (pgrest-lite على 8788)
//   node tests/ui-test-pharmacy.cjs ./shots <مجلد فيه week.xlsx و week.csv>
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const OUT = process.argv[2], FIX = process.argv[3];
const B = 'http://localhost:8788/';
const psql = (sql) => execFileSync('psql', ['-h', '/var/lib/pgtest', '-p', '5499', '-U', 'postgres', '-Atc', sql]).toString().trim();

(async () => {
  await fetch(B + '__reset');
  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [], checks = [];
  const ok = (name, cond) => checks.push((cond ? 'PASS ' : 'FAIL ') + name);
  let n = 0;
  let ctx, page;
  async function fresh() {
    if (ctx) await ctx.close();
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ', acceptDownloads: true });
    page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  }
  const shot = async (name, full = true) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/rep-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  async function login(email) {
    await fresh();
    await page.goto(B + '#/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('Pass12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForSelector('text=جلسات اليوم');
  }

  // ===== مسؤول الصيدلية الداخلية: يرفع ملف الإكسل
  await login('inpharm@test.iq');
  ok('no reports section on home', await page.locator('a[href="#/reports"]').count() === 0);
  await shot('home', false);
  ok('nav: 5 tabs with pharmacy', await page.locator('.bottom-nav a').count() === 5 && await page.locator('.bottom-nav a[href="#/report-pharmacy"]').count() === 1);
  ok('nav fits on phone', await page.evaluate(() => [...document.querySelectorAll('.bottom-nav a span')].every((s) => s.scrollWidth <= s.parentElement.clientWidth + 1)));
  await page.locator('.bottom-nav a[href="#/report-pharmacy"]').click();
  ok('pharmacy tab active', await page.locator('.bottom-nav a[aria-current="page"][href="#/report-pharmacy"]').waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.waitForSelector('text=لا يوجد تقرير بعد');
  ok('format note shown to editor', await page.locator('.xls-note').count() === 1);
  await page.locator('#inv-file').setInputFiles(`${FIX}/week.xlsx`);
  await page.waitForSelector('text=مراجعة ملف week.xlsx');
  const prev = page.locator('.inv-preview tbody tr');
  ok('preview 5 drugs', await prev.count() === 5);
  ok('xlsx date read', (await prev.nth(0).textContent()).includes('2027/03/31'));
  ok('month/year => end of month', (await prev.nth(2).textContent()).includes('2027/03/31'));
  ok('qty 0 => نافد', (await prev.nth(2).textContent()).includes('نافد'));
  ok('Arabic digits qty', (await prev.nth(3).textContent()).includes('8 vial'));
  ok('unclear values flagged', await page.locator('.inv-preview tr.warn').count() === 1);
  await shot('import-review');
  await page.getByRole('button', { name: 'حفظ التقرير' }).click();
  await page.waitForSelector('text=الأحدث');
  await page.waitForTimeout(500);
  ok('saved 5 items', psql("select count(*) from inventory_items where archived_at is null") === '5');
  ok('unclear kept in notes', psql("select notes from inventory_items where drug_name like 'Ondansetron%'").includes('عشرة'));
    ok('expired flagged', await page.locator('.xl td.exp.expired').count() >= 1);
  await shot('report');

  // تعديل دواء، إضافة، حذف
  await page.locator('.xl tbody tr', { hasText: 'Vincristine' }).click();
  await page.locator('dialog').getByLabel('العدد', { exact: true }).fill('9');
  await page.locator('dialog .segmented button', { hasText: 'شحيح' }).click();
  await shot('edit-dialog', false);
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await page.waitForTimeout(600);
  ok('edit saved', psql("select quantity || ':' || status from inventory_items where drug_name like 'Vincristine%'") === '9:low');
  await page.getByRole('button', { name: 'إضافة دواء' }).click();
  await page.locator('dialog').getByLabel('اسم الدواء', { exact: true }).fill('Methotrexate 50mg');
  await page.locator('dialog').getByLabel('العدد', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await page.waitForSelector('text=Methotrexate 50mg');
  await page.locator('.xl tbody tr', { hasText: 'Ondansetron' }).click();
  await page.getByRole('button', { name: 'حذف الدواء من التقرير' }).click();
  await page.locator('dialog').getByRole('button', { name: 'حذف', exact: true }).click();
  await page.waitForTimeout(600);
  ok('delete = archived', psql("select (archived_at is not null)::text from inventory_items where drug_name like 'Ondansetron%'") === 'true');
  ok('list now 5 rows', await page.locator('.xl tbody tr').count() === 5);
  // جدول مثل الإكسل وتواريخ إنكليزية
  ok('table grid lines', await page.locator('.xl td').first().evaluate((td) => getComputedStyle(td).borderBottomStyle === 'solid'));
  ok('english dates', (await page.locator('.xl tbody').textContent()).includes('2027/03/31') && /تقرير بتاريخ \d{4}\/\d{2}\/\d{2}/.test(await page.locator('main').textContent()));
  ok('out row highlighted', await page.locator('.xl tr.st-out').count() === 1);
  await page.getByRole('searchbox', { name: 'ابحث باسم الدواء' }).fill('ritux');
  ok('search', await page.locator('.xl tbody tr').count() === 1);
  await page.getByRole('searchbox', { name: 'ابحث باسم الدواء' }).fill('');
  // تحديث التقرير السابق: تعديل الخانات مباشرة في الجدول
  ok('no empty-report button', await page.getByRole('button', { name: 'تقرير فارغ' }).count() === 0);
  await page.getByRole('button', { name: 'تحديث التقرير السابق' }).click();
  ok('table becomes editable', await page.locator('.xl.editing input').count() > 10);
  await page.getByLabel('العدد: Cytarabine 100mg').fill('5');
  await page.getByLabel('الحالة: Cytarabine 100mg').selectOption('available');
  await page.getByLabel('الصلاحية: Methotrexate 50mg').fill('2027-06-30');
  ok('changed cells marked', await page.locator('.xl td.in.changed').count() === 3);
  await shot('edit-all', false);
  await page.getByRole('button', { name: 'حفظ التعديلات' }).click();
  await page.waitForSelector('.xl:not(.editing)');
  await page.waitForTimeout(500);
  ok('bulk update saved', psql("select quantity || ':' || status from inventory_items where drug_name like 'Cytarabine%' and archived_at is null") === '5:available'
     && psql("select expiry_date from inventory_items where drug_name like 'Methotrexate%'") === '2027-06-30');
  ok('same report updated (no new report)', psql("select count(*) from inventory_reports") === '1');
  await page.getByRole('button', { name: 'تحديث التقرير السابق' }).click();
  await page.getByLabel('العدد: Vincristine 1mg').fill('1');
  await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
  ok('cancel discards', psql("select quantity from inventory_items where drug_name like 'Vincristine%'") === '9');

  // التنزيل كإكسل ثم إعادة قراءته
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تنزيل كملف إكسل' }).click()]);
  const xf = `${OUT}/rep-export.xlsx`; await dl.saveAs(xf);
  const back = execFileSync('python3', ['-c', `import openpyxl,sys;ws=openpyxl.load_workbook(sys.argv[1]).active;print(ws.max_row, ws['A1'].value, ws.sheet_view.rightToLeft)`, xf]).toString().trim();
  ok('export opens in Excel lib: ' + back, back === '6 اسم الدواء True');

  // أسبوع جديد من CSV
  await page.locator('#inv-file').setInputFiles(`${FIX}/week.csv`);
  await page.waitForSelector('text=مراجعة ملف week.csv');
  ok('csv preview 2', await page.locator('.inv-preview tbody tr').count() === 2);
  ok('csv dd/mm/yyyy', (await page.locator('.inv-preview tbody tr').nth(1).textContent()).includes('2027/02/15'));
  await page.getByRole('button', { name: 'حفظ التقرير' }).click();
  await page.waitForTimeout(800);
  ok('2 reports, history select', await page.getByLabel('التقارير السابقة').locator('option').count() === 2);
  ok('no overflow (pharmacy)', await noOverflow());

  // ملف xls قديم مرفوض برسالة واضحة
  const xls = `${OUT}/old.xls`; fs.writeFileSync(xls, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]));
  await page.locator('#inv-file').setInputFiles(xls);
  ok('xls rejected with hint', await page.locator('#toast', { hasText: 'xlsx' }).waitFor({ timeout: 3000 }).then(() => true, () => false));

  // ===== الصيدلي السريري: يقرأ ولا يعدّل الصيدلية، ويكتب التسليم
  await login('cp@test.iq');
  await page.goto(B + '#/report-pharmacy');
  await page.waitForSelector('text=الأحدث');
  ok('cp: no upload button', await page.locator('label[for="inv-file"]').count() === 0 && await page.locator('.xls-note').count() === 0);
  ok('cp: rows read-only', await page.locator('.xl tr.edit').count() === 0);
  // ===== الممرض يقرأ فقط
  await login('nurse@test.iq');
  await page.goto(B + '#/report-pharmacy');
  await page.waitForSelector('text=الأحدث');
  ok('nurse reads, cannot edit', await page.locator('label[for="inv-file"]').count() === 0 && await page.locator('.xl tbody tr').count() === 2);
  ok('nurse got inventory notification', psql("select count(*) from notifications n join profiles p on p.id = n.user_id where p.email = 'nurse@test.iq' and n.link_type = 'inventory_report'") === '2');

  // ===== المدير
  await login('admin@test.iq');
  // المدير يعدّل الصيدلية الداخلية
  await page.goto(B + '#/report-pharmacy');
  await page.waitForSelector('text=الأحدث');
  ok('admin can edit inventory', await page.locator('label[for="inv-file"]').count() === 1);

  // ===== التسجيل: النوع الجديد متاح
  await fresh();
  await page.goto(B + '#/register');
  await page.getByRole('button', { name: /صيدلاني/ }).first().click().catch(() => {});
  ok('register offers new role', await page.locator('text=مسؤول الصيدلية الداخلية').count() >= 1);

  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
