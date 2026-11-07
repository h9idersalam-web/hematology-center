// قراءة صورة تعداد الدم آلياً داخل الجهاز (Tesseract.js، مجاني، لا تغادر الصورة الهاتف)
// القراءة اقتراح فقط: تُملأ الحقول ولا تُحفظ إلا بعد أن يراجعها المستخدم مقابل الصورة.
//
// الحماية من أخطاء القراءة:
//   1. تكبير الصورة وتحسين تباينها قبل القراءة
//   2. قراءتان بمعالجتين مختلفتين؛ اختلافهما يجعل القيمة «غير مؤكدة»
//   3. ثقة القارئ في كل رقم؛ الضعيفة «غير مؤكدة»
//   4. حدود فسيولوجية: ما خارجها لا يُملأ أصلاً
//   5. تحويل الوحدات (/cmm و g/L)، والمرجع البعيد عن المعتاد يُهمل ويُستخدم المرجع الافتراضي

const VENDOR = new URL('../vendor/tesseract-7.0.0/', import.meta.url).href;

// ------------------------------------------------------------------ التعرّف على اسم التحليل
// تُطبَّق على بداية السطر بعد تنظيفه (أحرف صغيرة، بلا نقاط داخل الاختصارات)
const LABELS = [
  ['ANC', /^(anc|absolute neutrophils?( count)?|neutrophils? ?(#|\(abs(olute)?\)|abs(olute)?\b|count\b)|neut ?#|neu ?#|gran ?#|granulocytes? ?#)/],
  ['NEUTP', /^(neut ?%|neu ?%|gran ?%|neutrophils?|segmented|polymorphs?)\b/],
  ['WBC', /^(wbc|tlc|total (leu[ck]ocytes?|white (blood )?cells?|wbc)( count)?|white (blood )?cells?( count)?|leu[ck]ocytes?( count)?)\b/],
  ['Hb', /^(hgb|hb|ha?emoglobin)\b/],
  ['PLT', /^(plt|plat|platelets?( count)?|thrombocytes?( count)?)\b/],
];

// حدود معقولة بعد التحويل إلى وحدات التطبيق (×10⁹/L و g/dL)
const PLAUSIBLE = { WBC: [0.05, 500], ANC: [0, 300], Hb: [1.5, 25], PLT: [1, 3000] };
// المراجع المعتادة للمقارنة: مرجع مقروء بعيد عنها (2.5 ضعف أو أكثر) غالباً فقد فاصلته أو جاء من سطر آخر
const TYPICAL = { WBC: [4, 11], ANC: [1.5, 8], Hb: [12, 17.5], PLT: [150, 450] };
export const MIN_CONF = 75;

function cleanLine(s) {
  return s.toLowerCase()
    .replace(/[|\[\]{}_~`"'«»]/g, ' ')
    .replace(/\b([a-z])\.(?=[a-z]\.?)/g, '$1')      // w.b.c → wbc
    .replace(/^[^a-z0-9#%]+/, '')
    .replace(/\s+/g, ' ').trim();
}

// رقم مقروء: "3,200" آلاف، و"9,8" فاصلة عشرية، و"7.85"
function toNum(tok) {
  let t = tok.replace(/[oO]/g, '0').replace(/[lI]/g, '1');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
const NUM = /\d+(?:[.,]\d+)*(?:\.\d+)?/g;

// يحوّل قيمة إلى وحدة التطبيق حسب نص الوحدة وحجم الرقم
function convert(test, v, unitText) {
  const u = (unitText || '').toLowerCase().replace(/\s/g, '');
  if (test === 'Hb') {
    const dl = /g\/?d[l1i]/.test(u);
    if (/g\/l\b|g\/l$/.test(u) && !dl) return { v: v / 10, note: 'حُوّل من g/L' };
    if (/mmol/.test(u)) return { v: v * 1.611, note: 'حُوّل من mmol/L', doubt: true };
    // رقم كبير مع وحدة g/dL: سقطت الفاصلة العشرية غالباً
    if (v > 30 && v <= 250) return { v: v / 10, note: dl ? 'ربما سقطت الفاصلة العشرية' : 'يبدو بوحدة g/L فحُوّل', doubt: dl || !u };
    return { v };
  }
  // الخلايا: /cmm أو /mm3 أو /µL بلا أس ⇒ ÷1000
  const perCmm = /\/(c?mm3?|cumm|cmm|[uµ]l|mcl)\b|\/(c?mm3?|cumm|cmm|[uµ]l|mcl)$/.test(u) && !/10\W?\^?\W?[369]|10[37]|x10|e[39]/.test(u);
  if (perCmm || (test === 'PLT' ? v > 3000 : v > 500)) return { v: v / 1000, note: 'حُوّل من /cmm' };
  return { v };
}

const round = (test, v) => (test === 'PLT' ? Math.round(v) : Math.round(v * 100) / 100);

// يحلل سطراً واحداً: الاسم ثم أول رقم ثم الوحدة ثم المرجع إن وُجد
function parseLine(line) {
  const c = cleanLine(line.text);
  for (const [test, re] of LABELS) {
    const m = c.match(re);
    if (!m) continue;
    const rest = c.slice(m[0].length);
    const nums = [...rest.matchAll(NUM)];
    if (!nums.length) return null;
    const first = nums[0];
    const raw = toNum(first[0]);
    if (raw == null) return null;
    const after = rest.slice(first.index + first[0].length);
    const unitText = (after.match(/^\s*([^\d(]*)/) || [])[1] || '';
    // علامة المختبر بجانب القيمة (H/L): تُقارن لاحقاً بالقيمة للكشف عن قراءة خاطئة
    const fm = after.match(/^\s*\*?\s*(h|l|hi|lo|high|low)\b/);
    const labFlag = fm ? (fm[1][0] === 'h' ? 'H' : 'L') : null;
    // المرجع: "a - b" أو "(a-b)" بعد القيمة
    const rm = after.match(/(\d+(?:[.,]\d+)*)\s*[-–—]\s*(\d+(?:[.,]\d+)*)/);
    const ref = rm ? [toNum(rm[1]), toNum(rm[2])] : null;
    // النسبة المئوية للعدلات: تُحفظ لحساب ANC إن لم يُذكر صراحة
    if (test === 'NEUTP') {
      if (/%/.test(unitText) || /%/.test(c.slice(0, m[0].length + 1)) || (raw <= 100 && !/10|\/l/.test(unitText))) {
        return { test, raw, value: raw, unitText, ref, line: line.text.trim(), conf: wordConf(line, first[0]) };
      }
      return null;
    }
    return { test, raw, unitText, ref, labFlag, line: line.text.trim(), conf: wordConf(line, first[0]) };
  }
  return null;
}

function wordConf(line, numText) {
  if (!line.words?.length) return line.conf ?? 100;
  const digits = numText.replace(/\D/g, '');
  const w = line.words.find((x) => x.text.replace(/\D/g, '').includes(digits) && digits.length);
  return w ? w.conf : (line.conf ?? 100);
}

// من أسطر القراءة إلى نتائج مقترحة: { WBC: { value, low, high, uncertain, reasons[], line } , ... }
export function parseLines(lines) {
  const found = {};
  for (const l of lines) {
    const r = parseLine(l);
    if (r && !found[r.test]) found[r.test] = r;
  }
  const out = {};
  for (const test of ['WBC', 'ANC', 'Hb', 'PLT']) {
    const r = found[test];
    if (!r) continue;
    const reasons = [];
    const cv = convert(test, r.raw, r.unitText);
    const value = round(test, cv.v);
    if (cv.note) reasons.push(cv.note);
    let doubt = !!cv.doubt;
    const [pmin, pmax] = PLAUSIBLE[test];
    if (!(value >= pmin && value <= pmax)) { out[test] = { rejected: true, line: r.line, raw: r.raw }; continue; }
    let low = null, high = null;
    if (r.ref && r.ref[0] != null && r.ref[1] != null && r.ref[0] < r.ref[1]) {
      const lo = round(test, convert(test, r.ref[0], r.unitText).v);
      const hi = round(test, convert(test, r.ref[1], r.unitText).v);
      const [tl, th] = TYPICAL[test];
      if (lo <= tl * 2.5 && lo >= tl / 2.5 && hi <= th * 2.5 && hi >= th / 2.5) { low = lo; high = hi; }
      else reasons.push('المرجع المقروء غير معتاد فلم يُستخدم');
    }
    // المرجع المقروء سليماً على السطر نفسه دليل على أن السطر قُرئ جيداً؛ بدونه لا تُعدّ القيمة واضحة
    if (low == null) { doubt = true; if (!reasons.length) reasons.push('لا يوجد مرجع مقروء على السطر للتأكد'); }
    if (r.conf < MIN_CONF) { doubt = true; reasons.push('القراءة غير واضحة'); }
    if (r.labFlag) {
      const lo = low ?? TYPICAL[test][0], hi = high ?? TYPICAL[test][1];
      if ((r.labFlag === 'L' && value >= lo) || (r.labFlag === 'H' && value <= hi)) {
        doubt = true; reasons.push(`علامة المختبر (${r.labFlag}) لا تطابق القيمة المقروءة`);
      }
    }
    const uncertain = doubt;
    out[test] = { value, low, high, uncertain, reasons, line: r.line, conf: Math.round(r.conf) };
  }
  // ANC محسوب من WBC ونسبة العدلات إن لم يُذكر صراحة
  if (!out.ANC && out.WBC && !out.WBC.rejected && found.NEUTP && found.NEUTP.value > 0 && found.NEUTP.value <= 100) {
    const v = Math.round(out.WBC.value * found.NEUTP.value) / 100;
    out.ANC = { value: v, low: null, high: null, computed: true, uncertain: out.WBC.uncertain || found.NEUTP.conf < MIN_CONF,
      reasons: [`محسوب: WBC × ${found.NEUTP.value}% عدلات`], line: found.NEUTP.line, conf: Math.round(Math.min(out.WBC.conf, found.NEUTP.conf)) };
  }
  return out;
}

// قراءتان: ما اختلفت قيمته بينهما يصبح غير مؤكد
export function mergeReads(a, b) {
  const out = {};
  for (const test of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[test], y = b[test];
    const pick = x && !x.rejected ? x : y;
    if (!pick || pick.rejected) { out[test] = x || y; continue; }
    const r = { ...pick, reasons: [...(pick.reasons || [])] };
    const other = pick === x ? y : x;
    if (!other || other.rejected) {
      if (!r.uncertain) { r.uncertain = r.conf < 90; if (r.uncertain) r.reasons.push('قُرئ مرة واحدة فقط'); }
    } else if (Math.abs(other.value - r.value) > 1e-9) {
      r.uncertain = true;
      r.reasons.push(`قراءتان مختلفتان: ${r.value} أو ${other.value}`);
    } else if (other.low !== r.low || other.high !== r.high) {
      if (other.low == null) { /* تبقى قراءة المرجع الواحدة */ } else if (r.low == null) { r.low = other.low; r.high = other.high; }
      else { r.low = null; r.high = null; r.reasons.push('المرجع غير واضح فلم يُستخدم'); }
    }
    out[test] = r;
  }
  return out;
}

// ------------------------------------------------------------------ معالجة الصورة (دوال نقية تُختبر خارج المتصفح)
// زاوية ميلان النص: الزاوية التي تكون عندها أسطر النص أوضح (أعلى تباين بين صفوف الإسقاط الأفقي)
export function deskewAngle(gray, w, h, maxDeg = 8, step = 0.25) {
  const sx = Math.max(1, Math.floor(w / 900));                       // تصغير للسرعة
  let sum = 0, n = 0;
  for (let y = 0; y < h; y += sx) for (let x = 0; x < w; x += sx) { sum += gray[y * w + x]; n++; }
  const thr = sum / n - 40;
  const pts = [];
  for (let y = 0; y < h; y += sx) for (let x = 0; x < w; x += sx) if (gray[y * w + x] < thr) pts.push(x, y);
  if (pts.length < 200) return 0;
  const bins = Math.ceil(h / sx) + Math.ceil(w / sx) + 4, off = Math.ceil(w / sx) + 2;
  let best = 0, bestScore = -1;
  const hist = new Float64Array(bins);
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += step) {
    const t = Math.tan((a * Math.PI) / 180);
    hist.fill(0);
    for (let i = 0; i < pts.length; i += 2) hist[Math.round((pts[i + 1] - pts[i] * t) / sx) + off]++;
    let score = 0;
    for (let i = 1; i < bins; i++) { const d = hist[i] - hist[i - 1]; score += d * d; }
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return Math.round(best * 100) / 100;
}

// إزالة التشويش: وسيط 3×3 (يُطبَّق بالحجم الأصلي قبل التكبير كي لا يُكبَّر التشويش معه)
export function cleanGray(gray, w, h, doStretch = true) {
  const out = new Uint8ClampedArray(w * h);
  const v = new Array(9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = Math.min(h - 1, Math.max(0, y + dy)) * w;
      for (let dx = -1; dx <= 1; dx++) v[k++] = gray[yy + Math.min(w - 1, Math.max(0, x + dx))];
    }
    v.sort((a, b) => a - b);
    out[y * w + x] = v[4];
  }
  return doStretch ? stretch(out) : out;
}

// شدّ التباين إلى المدى الكامل بإهمال 1% من الأطراف
export function stretch(g) {
  const out = new Uint8ClampedArray(g.length);
  const hist = new Uint32Array(256); for (const x of g) hist[x]++;
  const cut = g.length * 0.01;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < cut) lo++;
  acc = 0; while (hi > 0 && (acc += hist[hi]) < cut) hi--;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < g.length; i++) out[i] = ((g[i] - lo) * 255) / span;
  return out;
}

// عتبة أوتسو للنسخة الأبيض والأسود
export function otsu(gray) {
  const hist = new Float64Array(256); for (const g of gray) hist[g]++;
  const total = gray.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

// ------------------------------------------------------------------ المتصفح
// يحمّل المكتبة عند أول استخدام فقط (نحو 7 ميغابايت، تُحفظ بعدها في الجهاز)
let workerP = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('تعذّر تحميل أداة القراءة. تحقق من الإنترنت.'));
    document.head.append(s);
  });
}
async function getWorker(onProgress) {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(VENDOR + 'tesseract.min.js');
      const w = await window.Tesseract.createWorker('eng', 1, {
        workerPath: VENDOR + 'worker.min.js', corePath: VENDOR + 'core', langPath: VENDOR + 'lang',
        gzip: true, workerBlobURL: false, cacheMethod: 'write',
        logger: (m) => onProgress?.(m),
      });
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

// تجهيز الصورة: تكبير، ثم تصحيح الميلان، ثم إزالة التشويش وشدّ التباين.
// النسخة 1 رمادية، والنسخة 2 أبيض وأسود بعتبة أوتسو؛ تُقرأ كل منهما وتُقارن النتيجتان.
async function prepare(blob) {
  const bmp = await createImageBitmap(blob);
  const target = 2200;
  const scale = Math.min(3, target / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), hgt = Math.round(bmp.height * scale);
  const canvas = (cw, ch) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return [c, c.getContext('2d', { willReadFrequently: true })]; };
  const grayOf = (ctx, cw, ch) => {
    const d = ctx.getImageData(0, 0, cw, ch).data, g = new Uint8ClampedArray(cw * ch);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return g;
  };
  let [cv, ctx] = canvas(w, hgt);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, hgt);
  const angle = deskewAngle(grayOf(ctx, w, hgt), w, hgt);
  if (Math.abs(angle) >= 0.3) {
    const r = (-angle * Math.PI) / 180;
    const nw = Math.round(Math.abs(w * Math.cos(r)) + Math.abs(hgt * Math.sin(r)));
    const nh = Math.round(Math.abs(w * Math.sin(r)) + Math.abs(hgt * Math.cos(r)));
    const [c2, x2] = canvas(nw, nh);
    x2.fillStyle = '#fff'; x2.fillRect(0, 0, nw, nh);
    x2.translate(nw / 2, nh / 2); x2.rotate(r); x2.drawImage(cv, -w / 2, -hgt / 2);
    cv = c2; ctx = x2;
  }
  const W = cv.width, H = cv.height;
  const g = cleanGray(grayOf(ctx, W, H), W, H);
  const thr = otsu(g);
  const img = ctx.createImageData(W, H), d = img.data;
  const render = (fn) => {
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = fn(g[j]); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  };
  return [render((v) => v), render((v) => (v > thr ? 255 : 0)), angle];
}

function linesOf(data) {
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    out.push({ text: l.text, conf: l.confidence, words: (l.words || []).map((w) => ({ text: w.text, conf: w.confidence })) });
  }
  if (!out.length && data.text) for (const t of data.text.split('\n')) out.push({ text: t, conf: data.confidence });
  return out;
}

// الواجهة: صورة ← اقتراحات مدموجة من قراءتين، والنص المقروء للمراجعة
export async function readCbcImage(blob, onProgress) {
  const w = await getWorker(onProgress);
  onProgress?.({ status: 'تجهيز الصورة' });
  const [a, b, angle] = await prepare(blob);
  onProgress?.({ status: 'القراءة الأولى' });
  const ra = await w.recognize(a, {}, { blocks: true, text: true });
  onProgress?.({ status: 'القراءة الثانية للتأكد' });
  const rb = await w.recognize(b, {}, { blocks: true, text: true });
  const result = mergeReads(parseLines(linesOf(ra.data)), parseLines(linesOf(rb.data)));
  return { result, text: ra.data.text, confidence: Math.round(ra.data.confidence), angle };
}
