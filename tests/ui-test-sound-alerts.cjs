// التنبيه بالصوت أثناء فتح التطبيق (pgrest-lite على 8788)
require('./theme-env.cjs');
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
  async function login(email) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ', permissions: ['notifications'] });
    // عدّاد للنغمات وإشعارات الهاتف
    await ctx.addInitScript(() => {
      window.__tones = 0; window.__shown = [];
      const A = window.AudioContext;
      window.AudioContext = class extends A { createOscillator() { const o = super.createOscillator(); const s = o.start.bind(o); o.start = (...x) => { window.__tones++; return s(...x); }; return o; } };
      if (window.ServiceWorkerRegistration) ServiceWorkerRegistration.prototype.showNotification = function (t, o) { window.__shown.push({ t, o }); return Promise.resolve(); };
      window.Notification = class { constructor(t, o) { window.__shown.push({ t, o }); } static get permission() { return 'granted'; } static requestPermission() { return Promise.resolve('granted'); } };
    });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    page.on('pageerror', (e) => errors.push(email + ' pageerror: ' + e.message));
    await page.goto(B + '#/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('Pass12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForSelector('text=جلسات اليوم');
    return page;
  }
  const sara = await login('sara@test.iq');
  const uid = psql("select id from profiles where full_name = 'د. سارة الربيعي'");
  const tones = () => sara.evaluate(() => window.__tones);
  const shown = () => sara.evaluate(() => window.__shown);
  const checkNow = () => sara.evaluate(async () => { await (await import('./js/notify.js')).checkNow(); });
  const notify = (kind, title, body) => psql(`insert into notifications(user_id, kind, title, body, link_type, link_id) select '${uid}', '${kind}', '${title}', '${body}', 'patient', id from patients limit 1`);

  ok('enable card shown once', await sara.locator('text=فعّل التنبيه بالصوت').waitFor({ timeout: 5000 }).then(() => true, () => false));
  await sara.screenshot({ path: `${OUT}/snd-01-card.png` });
  await sara.getByRole('button', { name: 'تفعيل', exact: true }).click();
  await sara.waitForTimeout(500);
  ok('test chime on enable', (await tones()) >= 2);
  ok('card gone after enabling', (await sara.locator('text=فعّل التنبيه بالصوت').count()) === 0);

  // الإشعارات القديمة لا تُصدر صوتاً
  const t0 = await tones(); await checkNow();
  ok('existing notifications: no sound', (await tones()) === t0 && (await shown()).length === 0);

  // إشعار عادي جديد: نغمتان وإشعار على الشاشة، والعدّاد يتحدث وحده
  const before = Number((await sara.locator('a[href="#/notifications"] .badge-dot').textContent().catch(() => '0')) || 0);
  notify('info', 'للعلم: اختبار', 'نص');
  await checkNow(); await sara.waitForTimeout(400);
  ok('new info notification: 2 tones', (await tones()) - t0 === 2);
  ok('system notification shown', (await shown()).length === 1 && (await shown())[0].t === 'للعلم: اختبار');
  ok('bell badge updated live', Number(await sara.locator('a[href="#/notifications"] .badge-dot').textContent()) === before + 1);

  // تنبيه عاجل: نغمة أقوى (4) ومصطلحات جديدة ورابط الشاشة المعنية
  const t1 = await tones();
  notify('alert', 'تحليل خارج المرجع', 'مريض · قبل الدورة 2: PLT 30');
  await checkNow(); await sara.waitForTimeout(400);
  ok('urgent alert: 4 tones', (await tones()) - t1 === 4);
  const last = (await shown()).slice(-1)[0];
  ok('alert uses new terms', last.t === 'تحليل خارج الحد الطبيعي' && last.o.body.includes('قبل الجرعة 2'));
  ok('alert opens lab alert screen', last.o.data.url.includes('#/lab-alert?patient='));
  ok('urgent stays on screen', last.o.requireInteraction === true);

  // لا يُنبَّه بالإشعار نفسه مرتين
  const t2 = await tones(); await checkNow();
  ok('no repeat for same notification', (await tones()) === t2);

  // الإيقاف من شاشة الإشعارات
  await sara.goto(B + '#/notifications'); await sara.waitForSelector('text=التنبيه بالصوت: مفعّل');
  await sara.screenshot({ path: `${OUT}/snd-02-toggle.png` });
  await sara.getByRole('button', { name: 'إيقاف', exact: true }).click();
  await sara.waitForSelector('text=التنبيه بالصوت: متوقف');
  const t3 = await tones(); notify('info', 'بعد الإيقاف', 'نص'); await checkNow(); await sara.waitForTimeout(300);
  ok('disabled: no sound', (await tones()) === t3);

  // مستخدم آخر يختار «لاحقاً»: لا تعود البطاقة
  const cp = await login('cp@test.iq');
  await cp.getByRole('button', { name: 'لاحقاً' }).click();
  await cp.reload(); await cp.waitForSelector('text=جلسات اليوم');
  ok('"later" hides card for good', (await cp.locator('text=فعّل التنبيه بالصوت').count()) === 0);

  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
