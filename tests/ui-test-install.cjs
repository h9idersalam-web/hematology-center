// زر «أضف إلى الشاشة الرئيسية» على مختلف الأجهزة (pgrest-lite على 8788)
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const OUT = process.argv[2];
const B = 'http://localhost:8788/';
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
};
(async () => {
  await fetch(B + '__reset');
  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [], checks = [];
  const ok = (name, cond) => checks.push((cond ? 'PASS ' : 'FAIL ') + name);
  async function open(ua, { standalone = false, login = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ', userAgent: ua });
    if (standalone) await ctx.addInitScript(() => { const m = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, addEventListener() {}, removeEventListener() {} } : m(q)); });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(B + '#/login'); await page.waitForSelector('text=البريد الإلكتروني');
    if (login) {
      await page.getByLabel('البريد الإلكتروني').fill('sara@test.iq'); await page.getByLabel('كلمة المرور').fill('Pass12345');
      await page.getByRole('button', { name: 'دخول' }).click(); await page.waitForSelector('text=جلسات اليوم');
    }
    return page;
  }
  const btn = (p) => p.getByRole('button', { name: 'أضف التطبيق إلى الشاشة الرئيسية' });

  // آيفون سفاري: الزر في الدخول والرئيسية، ويعرض خطوات المشاركة
  let p = await open(UA.iphone);
  ok('login page shows button', (await btn(p).count()) === 1);
  await p.screenshot({ path: `${OUT}/inst-01-login.png` });
  p = await open(UA.iphone, { login: true });
  ok('home top shows button', (await p.locator('.app-brand').getByRole('button', { name: 'أضف التطبيق إلى الشاشة الرئيسية' }).count()) === 1);
  await p.screenshot({ path: `${OUT}/inst-02-home.png` });
  await btn(p).click();
  ok('iPhone Safari: share-sheet steps', (await p.locator('dialog', { hasText: 'اضغط زر المشاركة' }).count()) === 1 && (await p.locator('dialog', { hasText: 'إضافة إلى الشاشة الرئيسية' }).count()) === 1);
  await p.screenshot({ path: `${OUT}/inst-03-ios-steps.png` });

  p = await open(UA.iphoneChrome); await btn(p).click();
  ok('iPhone Chrome: share in address bar', (await p.locator('dialog', { hasText: 'في شريط العنوان' }).count()) === 1);
  p = await open(UA.androidFirefox); await btn(p).click();
  ok('Android Firefox: menu steps', (await p.locator('dialog', { hasText: 'اختر «تثبيت»' }).count()) === 1);
  p = await open(UA.samsung); await btn(p).click();
  ok('Samsung Internet: steps', (await p.locator('dialog', { hasText: 'إضافة صفحة إلى' }).count()) === 1);

  // أندرويد كروم: نافذة التثبيت الأصلية من المتصفح
  p = await open(UA.androidChrome);
  await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await btn(p).click(); await p.waitForTimeout(300);
  ok('Android Chrome: native install prompt', await p.evaluate(() => window.__prompted === true));
  ok('button gone after accepting', (await btn(p).count()) === 0);
  // أندرويد كروم بلا الحدث (مثلاً أُغلقت النافذة سابقاً): خطوات القائمة
  p = await open(UA.androidChrome); await btn(p).click();
  ok('Android Chrome fallback: menu steps', (await p.locator('dialog', { hasText: 'تثبيت التطبيق' }).count()) === 1);

  // مفتوح من الأيقونة (مثبّت): لا زر
  p = await open(UA.iphone, { standalone: true, login: true });
  ok('installed app: no button', (await btn(p).count()) === 0);
  ok('no horizontal overflow', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // شاشة صغيرة جداً: أيقونة فقط ولا تتجاوز العرض
  const small = await browser.newContext({ viewport: { width: 320, height: 640 }, userAgent: UA.iphone });
  const sp = await small.newPage(); await sp.goto(B + '#/login'); await sp.waitForSelector('text=البريد الإلكتروني');
  ok('small screen: fits', await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  checks.forEach((c) => console.log(c));
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
