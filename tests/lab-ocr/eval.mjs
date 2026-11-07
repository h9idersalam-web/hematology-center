// تقييم القراءة على العيّنات: معالجتان كما في المتصفح (رمادية مكبّرة، وعتبة) ثم الدمج والمقارنة بالحقيقة
import { createWorker } from 'tesseract.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
const [dir, modPath] = process.argv.slice(2);
const { parseLines, mergeReads, deskewAngle, cleanGray, stretch, otsu } = await import(modPath);
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json')));
const w = await createWorker('eng', 1, { langPath: path.resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int'), gzip: true, cachePath: path.resolve('.cache') });
await w.setParameters({ tessedit_pageseg_mode: process.env.PSM || '6', preserve_interword_spaces: '1' });
const linesOf = (data) => { const o = []; for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) o.push({ text: l.text, conf: l.confidence, words: l.words.map((x) => ({ text: x.text, conf: x.confidence })) }); return o; };
let bad = 0, total = 0, unsure = 0;
const files = fs.readdirSync(dir).filter((f) => /-(clean\.png|photo\.jpg)$/.test(f)).sort();
for (const f of files) {
  const name = f.split('-')[0], src = path.join(dir, f);
  const a = path.join(dir, '_a.png'), b = path.join(dir, '_b.png');
  // نفس خطوات المتصفح: تكبير، زاوية الميلان (دالتنا)، تدوير، وسيط وتباين (دالتنا)، وعتبة أوتسو
  const dims = (f) => execFileSync('identify', ['-format', '%w %h', f]).toString().split(' ').map(Number);
  const raw = (f) => new Uint8ClampedArray(execFileSync('convert', [f, '-colorspace', 'gray', '-depth', '8', 'gray:-'], { maxBuffer: 1 << 28 }));
  const g0 = path.join(dir, '_g0.png');
  const pgm0 = (buf, ww, hh, f) => { fs.writeFileSync(f + '.pgm', Buffer.concat([Buffer.from(`P5\n${ww} ${hh}\n255\n`), Buffer.from(buf)])); execFileSync('convert', [f + '.pgm', f]); };
  // نفس خطوات المتصفح: تكبير، زاوية الميلان، تدوير، وسيط وشدّ تباين، وعتبة أوتسو
  const [ow, oh] = dims(src); const sc = Math.min(3, 2200 / Math.max(ow, oh));
  execFileSync('convert', [src, '-resize', Math.round(ow * sc) + 'x' + Math.round(oh * sc) + '!', '-colorspace', 'gray', g0]);
  let [w0, h0] = dims(g0);
  const ang = deskewAngle(raw(g0), w0, h0);
  if (Math.abs(ang) >= 0.3) execFileSync('convert', [g0, '-background', 'white', '-rotate', String(-ang), g0]);
  [w0, h0] = dims(g0);
  const cg = cleanGray(raw(g0), w0, h0); const t = otsu(cg);
  pgm0(cg, w0, h0, a); pgm0(cg.map((v) => (v > t ? 255 : 0)), w0, h0, b);
  if (process.env.DBG) console.log('   angle', ang);
  const ra = await w.recognize(a, {}, { blocks: true }); const rb = await w.recognize(b, {}, { blocks: true });
  const res = mergeReads(parseLines(linesOf(ra.data)), parseLines(linesOf(rb.data)));
  const lines = [];
  for (const [t, [v, lo, hi]] of Object.entries(truth[name])) {
    total++;
    const r = res[t];
    const valOk = r && !r.rejected && Math.abs(r.value - v) < 1e-6;
    const refOk = r && (r.low == null || (lo != null && Math.abs(r.low - lo) < 1e-6 && Math.abs(r.high - hi) < 1e-6));
    // الخطر: قيمة خاطئة غير معلَّمة بأنها غير مؤكدة
    const silentWrong = r && !r.rejected && !valOk && !r.uncertain;
    if (silentWrong) bad++;
    if (r?.uncertain) unsure++;
    lines.push(`${t}: ${r ? (r.rejected ? 'REJECTED ' + r.raw : r.value + (r.low != null ? ` [${r.low}-${r.high}]` : '') + (r.uncertain ? ' ?' : '')) : 'missing'} ${valOk ? 'OK' : silentWrong ? '!!SILENT-WRONG' : 'X'}${refOk ? '' : ' REF-WRONG'} ${(r?.reasons || []).join('؛ ')}`);
  }
  console.log(`== ${f}\n  ` + lines.join('\n  '));
}
console.log(`\nTOTAL ${total} · silent wrong ${bad} · marked uncertain ${unsure}`);
await w.terminate();
