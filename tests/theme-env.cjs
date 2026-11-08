// المظهر في اختبارات الواجهة: التصميم 2 صار الرسمي، لكن أغلب الاختبارات كُتبت للمظهر القديم.
// UI_THEME=off (الافتراضي هنا) يشغّلها على المظهر القديم، وUI_THEME=b على التصميم 2.
const theme = process.env.UI_THEME || 'off';
for (const name of ['playwright', 'playwright-core']) {
  let pw; try { pw = require(name); } catch { continue; }
  const launch = pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch = async (...a) => {
    const b = await launch(...a);
    const nc = b.newContext.bind(b);
    b.newContext = async (...o) => {
      const ctx = await nc(...o);
      await ctx.addInitScript((t) => { try { if (!localStorage.getItem('hc-theme')) localStorage.setItem('hc-theme', t === 'b' ? '' : t); } catch {} }, theme);
      return ctx;
    };
    return b;
  };
}
