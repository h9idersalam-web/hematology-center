// اختبار التسجيل والتفعيل والإيقاف على الواجهة (pgrest-lite على 8788)
//   node tests/ui-test-activation.cjs <out_dir>
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const OUT = process.argv[2];
const B = 'http://localhost:8788/';
const EMAIL = `new${Date.now()}@test.iq`;  // المحاكي يتذكر البريد بين التشغيلات

(async () => {
  await fetch(B + '__reset');
  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [], checks = [];
  const ok = (name, cond) => checks.push((cond ? 'PASS ' : 'FAIL ') + name);
  let n = 0;
  const open = async (viewport, tag) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'ar-IQ' });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
    page.on('response', (r) => {
      // 401/403 متوقعة في محاولات التجاوز المقصودة أدناه
      if (r.status() >= 400 && /\/rest\/v1\//.test(r.url()) && !r.url().includes('activation') && !r.url().includes('/rpc/')) errors.push(`${tag} ${r.status()} ${r.url().slice(22, 140)}`);
    });
    return page;
  };
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/act-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true }); };
  const text = async (page, t) => (await page.locator(`text=${t}`).count()) > 0;

  // ===== 1. مستخدم جديد يسجّل (هاتف)
  const u = await open({ width: 390, height: 844 }, 'user');
  await u.goto(B + '#/register');
  await u.getByLabel('الاسم الكامل').fill('سجاد كريم');
  await u.getByLabel('رقم الهاتف').fill('07701112233');
  await u.getByLabel('البريد الإلكتروني').fill(EMAIL);
  await u.getByLabel('كلمة المرور', { exact: true }).fill('Pass12345');
  await u.getByLabel('تأكيد كلمة المرور').fill('Pass12345');
  await u.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await u.waitForSelector('text=حسابك بانتظار التفعيل');
  ok('sign-up lands on pending page', true);
  await shot(u, 'pending-mobile');

  // محاولات التجاوز: فتح شاشة بيانات مباشرة، وطلب البيانات من الواجهة البرمجية بتوكن المستخدم
  await u.goto(B + '#/patients');
  await u.waitForTimeout(600);
  ok('direct #/patients redirects to pending', await text(u, 'حسابك بانتظار التفعيل'));
  const api = await u.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
    const tok = JSON.parse(localStorage.getItem(key)).access_token;
    const hdr = { Authorization: 'Bearer ' + tok, apikey: 'x' };
    const get = async (path) => { const r = await fetch('/rest/v1/' + path, { headers: hdr }); return [r.status, await r.text()]; };
    const post = async (path, body, method = 'POST') => { const r = await fetch('/rest/v1/' + path, { method, headers: { ...hdr, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return [r.status, await r.text()]; };
    return {
      patients: await get('patients?select=id'),
      protocols: await get('protocols?select=id'),
      codes: await get('user_activation_codes?select=*'),
      listUsers: await post('rpc/admin_list_users', {}),
    };
  });
  ok('API patients empty for pending: ' + api.patients[1], api.patients[1] === '[]');
  ok('API protocols empty for pending', api.protocols[1] === '[]');
  ok('API codes table refused: ' + api.codes[0], api.codes[0] >= 400);
  ok('API admin_list_users refused: ' + api.listUsers[0], api.listUsers[0] >= 400);

  await u.locator('#act-code').fill('AAAAA-BBBBB');
  await u.getByRole('button', { name: 'تفعيل الحساب' }).click();
  ok('no code yet message', !!(await u.waitForSelector('text=لا يوجد كود صالح لحسابك', { timeout: 5000 })));

  // ===== 2. المدير يصدر كوداً (حاسوب)
  const a = await open({ width: 1280, height: 900 }, 'admin');
  await a.goto(B + '#/login');
  await a.getByLabel('البريد الإلكتروني').fill('admin@test.iq');
  await a.getByLabel('كلمة المرور').fill('Pass12345');
  await a.getByRole('button', { name: 'دخول' }).click();
  await a.waitForSelector('text=جلسات اليوم');
  await a.goto(B + '#/admin?tab=users');
  await a.waitForSelector('article:has-text("سجاد كريم")');
  ok('admin section title', await text(a, 'إدارة المستخدمين'));
  const card = a.locator('article', { hasText: 'سجاد كريم' });
  ok('card shows pending + no code', (await card.locator('text=بانتظار التفعيل').count()) > 0 && (await card.locator('text=لم يُصدر له كود بعد').count()) > 0);
  await shot(a, 'admin-users-desktop');
  await card.getByRole('button', { name: 'إصدار كود' }).click();
  await a.getByRole('button', { name: '24 ساعة' }).click();
  await a.getByRole('button', { name: 'إصدار الكود' }).click();
  const code = (await a.locator('.code-box .code').innerText()).trim();
  ok('code format ' + code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(code));
  ok('shown-once warning', await text(a, 'لن يظهر مرة أخرى'));
  await shot(a, 'admin-code-issued');
  await a.getByRole('button', { name: 'إغلاق' }).click();
  ok('card now shows valid code date', (await a.locator('article', { hasText: 'سجاد كريم' }).locator('text=كود صالح حتى').count()) > 0);

  // ===== 3. المستخدم: كود خاطئ ثم الصحيح
  await u.locator('#act-code').fill('AAAAA-CCCCC');
  await u.getByRole('button', { name: 'تفعيل الحساب' }).click();
  await u.waitForSelector('text=الكود غير صحيح');
  // المحاولة السابقة قبل صدور الكود لا تُحسب؛ هذه الأولى على الكود الجديد
  ok('remaining attempts shown', await text(u, 'بقيت 4 محاولات'));
  await shot(u, 'wrong-code');
  await u.locator('#act-code').fill(code.toLowerCase());
  await u.getByRole('button', { name: 'تفعيل الحساب' }).click();
  await u.waitForSelector('text=جلسات اليوم', { timeout: 8000 });
  ok('activated -> home', true);
  const after = await u.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
    const tok = JSON.parse(localStorage.getItem(key)).access_token;
    const r = await fetch('/rest/v1/protocols?select=id', { headers: { Authorization: 'Bearer ' + tok, apikey: 'x' } });
    return (await r.json()).length;
  });
  ok('active user reads protocols: ' + after, after > 0);

  // ===== 4. الإيقاف، ثم إعادة الدخول، ثم إعادة التفعيل
  await a.reload();
  await a.waitForSelector('article:has-text("سجاد كريم")');
  await a.locator('article', { hasText: 'سجاد كريم' }).getByRole('button', { name: 'إيقاف' }).click();
  await a.locator('dialog textarea').fill('انتهى التعاقد');
  await a.locator('dialog').getByRole('button', { name: 'إيقاف الحساب' }).click();
  await a.waitForSelector('article:has-text("سجاد كريم") >> text=موقوف');
  ok('admin sees suspended', true);
  await u.reload();
  await u.waitForSelector('text=الحساب موقوف');
  ok('suspended page with reason', await text(u, 'انتهى التعاقد'));
  await shot(u, 'suspended-mobile');
  await u.goto(B + '#/patients');
  await u.waitForTimeout(600);
  ok('suspended cannot open patients', await text(u, 'الحساب موقوف'));

  await a.locator('article', { hasText: 'سجاد كريم' }).getByRole('button', { name: 'إعادة التفعيل' }).click();
  await a.waitForSelector('article:has-text("سجاد كريم") >> text=مفعّل');
  await u.getByRole('button', { name: 'تحديث حالة الحساب' }).click();
  await u.waitForSelector('text=جلسات اليوم', { timeout: 8000 });
  ok('reactivated -> home via refresh button', true);

  // تسجيل الخروج والدخول من جديد
  await u.goto('about:blank');
  await u.goto(B + '#/login');
  await u.evaluate(() => localStorage.clear());
  await u.reload();
  await u.getByLabel('البريد الإلكتروني').fill(EMAIL);
  await u.getByLabel('كلمة المرور').fill('Pass12345');
  await u.getByRole('button', { name: 'دخول' }).click();
  await u.waitForSelector('text=جلسات اليوم', { timeout: 8000 });
  ok('re-login works after activation', true);

  // لوحة المدير على الهاتف
  const am = await open({ width: 390, height: 844 }, 'admin-m');
  await am.goto(B + '#/login');
  await am.getByLabel('البريد الإلكتروني').fill('admin@test.iq');
  await am.getByLabel('كلمة المرور').fill('Pass12345');
  await am.getByRole('button', { name: 'دخول' }).click();
  await am.waitForSelector('text=جلسات اليوم');
  await am.goto(B + '#/admin?tab=users');
  await am.waitForSelector('article:has-text("سجاد كريم")');
  const overflow = await am.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('no horizontal scroll on phone', !overflow);
  await shot(am, 'admin-users-mobile');

  console.log(checks.join('\n'));
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
