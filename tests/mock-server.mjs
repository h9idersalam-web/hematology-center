// خادم تجريبي يحاكي Supabase لاختبار الواجهة محلياً فقط (لا يُرفع إلى GitHub)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const WEB = path.resolve(process.argv[2] || './web');
const PORT = Number(process.argv[3] || 8787);
const today = new Date().toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const AR_FROM = 'أإآٱةىؤئ', AR_TO = 'ااااهيوي';
const arNorm = (t) => String(t || '').replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660).replace(/[ًٌٍَُِّْـ]/g, '')
  .replace(/[أإآٱةىؤئ]/g, (c) => AR_TO[AR_FROM.indexOf(c)]).toLowerCase();

const db = {
  users: {},  // email -> {id,password}
  profiles: [],
  activation_codes: [],
  notifications: [],
  change_requests: [{ id: 'r1', status: 'pending' }],
  patients: [],
  treatments: [],
  cycles_raw: [],
  lab_results: [{ id: 'l1', patient_id: 'p3' }, { id: 'l2', patient_id: 'p3' }],
  attachments: [{ id: 'a1', patient_id: 'p3' }],
};
let fileSeq = 0;
function addPatient(id, full_name, sex, birth_date, height_cm, weight_kg, allergies, specialist_id, extra = {}) {
  fileSeq += 1;
  db.patients.push({ id, file_no: 'HEM-2026-' + String(fileSeq).padStart(4, '0'), full_name, sex, birth_date, height_cm, weight_kg,
    phone: extra.phone || null, allergies, specialist_id, created_at: new Date(Date.now() - (30 - fileSeq) * 864e5).toISOString(),
    archived_at: extra.archived_at || null, archive_reason: extra.archive_reason || null });
}
function addPlan(tid, pid, protocol_name, diagnosis, icd10, stage, len, total, startOffset, givenUpTo, opts = {}) {
  const p = db.patients.find((x) => x.id === pid);
  db.treatments.push({ id: tid, patient_id: pid, protocol_name, diagnosis, icd10, stage, cycle_length_days: len, total_cycles: total,
    start_date: addDays(startOffset), height_cm: p.height_cm, weight_kg: opts.planWeight || p.weight_kg,
    bsa: Math.round(Math.sqrt(p.height_cm * (opts.planWeight || p.weight_kg) / 3600) * 100) / 100,
    status: opts.status || 'active', stop_reason: opts.stop_reason || null, created_at: new Date(Date.now() + (opts.status === 'stopped' ? -9e9 : 0)).toISOString() });
  for (let n = 1; n <= total; n++) {
    const planned = addDays(startOffset + (n - 1) * len);
    const status = opts.status === 'stopped' ? (n <= givenUpTo ? 'given' : 'cancelled') : n <= givenUpTo ? 'given' : (opts.held === n ? 'held' : 'planned');
    db.cycles_raw.push({ id: `${tid}-c${n}`, treatment_id: tid, cycle_no: n, planned_date: planned, status,
      postpone_reason: opts.reasons?.[n] || (status === 'cancelled' ? opts.stop_reason : null),
      doctor_approved_at: opts.approved?.includes(n) ? new Date().toISOString() : null,
      pharmacist_verified_at: opts.verified?.includes(n) ? new Date().toISOString() : null });
  }
}

function overview() {
  return db.patients.map((p) => {
    const ts = db.treatments.filter((t) => t.patient_id === p.id)
      .sort((a, b) => (['active', 'pending_approval'].includes(b.status) - ['active', 'pending_approval'].includes(a.status)) || (b.created_at > a.created_at ? 1 : -1));
    const t = ts[0];
    const cs = t ? db.cycles_raw.filter((c) => c.treatment_id === t.id).sort((a, b) => a.cycle_no - b.cycle_no) : [];
    const nx = cs.find((c) => c.status === 'planned' || c.status === 'held');
    const lg = [...cs].reverse().find((c) => c.status === 'given');
    const sp = db.profiles.find((x) => x.id === p.specialist_id);
    return { ...p, specialist_name: sp ? sp.full_name : null, search_key: arNorm(`${p.full_name} ${p.file_no} ${p.phone || ''}`),
      treatment_id: t?.id ?? null, protocol_name: t?.protocol_name ?? null, diagnosis: t?.diagnosis ?? null, stage: t?.stage ?? null,
      treatment_status: t?.status ?? null, total_cycles: t?.total_cycles ?? null,
      next_cycle_no: nx?.cycle_no ?? null, next_date: nx?.planned_date ?? null, next_status: nx?.status ?? null,
      last_cycle_no: lg?.cycle_no ?? null, last_date: lg?.planned_date ?? null };
  });
}
function cyclesJoined() {
  return db.cycles_raw.map((c) => {
    const t = db.treatments.find((x) => x.id === c.treatment_id);
    const p = db.patients.find((x) => x.id === t.patient_id);
    return { ...c, treatments: { protocol_name: t.protocol_name, total_cycles: t.total_cycles, status: t.status,
      patients: { id: p.id, full_name: p.full_name, file_no: p.file_no, allergies: p.allergies, archived_at: p.archived_at } } };
  });
}

function addUser(email, password, meta, extra = {}) {
  const id = crypto.randomUUID();
  db.users[email] = { id, password };
  db.profiles.push({ id, email, full_name: meta.full_name, phone: meta.phone || null, role: meta.role, status: 'pending', is_admin: false, subscription_ends: null, activated_at: null, created_at: new Date().toISOString(), ...extra });
  db.profiles.filter((p) => p.is_admin).forEach((a) => db.notifications.push({ id: crypto.randomUUID(), user_id: a.id, kind: 'new_user', title: 'طلب تفعيل جديد', body: meta.full_name, link_type: 'profile', link_id: id, read_at: null, created_at: new Date().toISOString() }));
  return id;
}

// بيانات أولية: المدير وبعض المستخدمين
const adminId = addUser('admin@test.iq', 'Admin12345', { full_name: 'حيدر سلام', role: 'chief_clinical_pharmacist' }, { status: 'active', is_admin: true });
const spId = addUser('sara@test.iq', 'Pass12345', { full_name: 'د. سارة الربيعي', role: 'specialist', phone: '07701234567' }, { status: 'active', subscription_ends: addDays(240) });
addUser('zahraa@test.iq', 'Pass12345', { full_name: 'زهراء فاضل', role: 'mixing_pharmacist' }, { status: 'active', subscription_ends: addDays(12) });
addUser('nour@test.iq', 'Pass12345', { full_name: 'نور حيدر', role: 'nurse' }, { status: 'suspended', subscription_ends: addDays(90) });
addUser('morteza@test.iq', 'Pass12345', { full_name: 'د. مرتضى سعد', role: 'senior_resident', phone: '07801112233' });
[['approval', 'طلب تعديل بانتظار موافقتك', 'علي حسين كاظم'], ['alert', 'تحليل خارج المرجع', 'حسن رعد: Platelets 26'], ['decision', 'وافق الطبيب على تعديلك', null]]
  .forEach(([kind, title, body], i) => db.notifications.push({ id: crypto.randomUUID(), user_id: adminId, kind, title, body, link_type: kind === 'alert' ? 'patient' : null, link_id: 'p3', read_at: i === 2 ? new Date().toISOString() : null, created_at: new Date(Date.now() - (i + 1) * 900000).toISOString() }));

// المرضى وخطط العلاج
const NKDA = 'لا توجد حساسية دوائية معروفة';
addPatient('p1', 'علي حسين كاظم', 'male', '1975-03-12', 170, 72, NKDA, spId, { phone: '07701234567' });
addPatient('p2', 'زينب عبد الأمير جواد', 'female', '1998-07-02', 160, 55, 'Penicillin، Sulfa', spId);
addPatient('p3', 'حسن رعد الموسوي', 'male', '1962-11-20', 175, 80, NKDA, spId, { phone: '07809988776' });
addPatient('p4', 'كرار ماجد عبيس', 'male', '1989-01-15', 182, 90, null, spId);
addPatient('p5', 'فاطمة الزهراء علي', 'female', '2004-09-09', 158, 49, null, null);
addPatient('p6', 'أمير جاسم محمد', 'male', '1970-04-04', 168, 77, NKDA, spId);
addPatient('p7', 'سجاد كريم ناصر', 'male', '1955-02-02', 165, 70, NKDA, spId, { archived_at: addDays(-20) + 'T10:00:00Z', archive_reason: 'أنهى العلاج وانتقل للمتابعة' });
addPlan('t1', 'p1', 'R-CHOP-21', 'لمفوما الخلايا البائية الكبيرة المنتشرة', 'C83.3', 'II', 21, 6, -42, 2, { approved: [3], verified: [3] });
addPlan('t2', 'p2', 'ABVD', 'لمفوما هودجكن', 'C81.1', 'IIA', 28, 6, -28, 1, { approved: [2] });
addPlan('t3', 'p3', 'VRd', 'الورم النقوي المتعدد', 'C90.0', 'ISS II', 21, 8, -63, 3, { held: 4, reasons: { 4: 'نقص الصفيحات' } });
addPlan('t3old', 'p3', 'Thal-Dex', 'الورم النقوي المتعدد', 'C90.0', 'ISS II', 28, 6, -200, 2, { status: 'stopped', stop_reason: 'عدم الاستجابة' });
addPlan('t4', 'p4', 'R-CHOP-21', 'لمفوما الخلايا البائية الكبيرة المنتشرة', 'C83.3', 'III', 21, 6, -47, 2, { planWeight: 101 });
addPlan('t6', 'p6', 'Imatinib', 'ابيضاض نقوي مزمن', 'C92.1', 'مزمن', 28, 12, 3, 0);

const sessions = {};
function session(id, email) {
  const token = 'tok-' + crypto.randomUUID();
  sessions[token] = id;
  const p = db.profiles.find((x) => x.id === id);
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + token,
    user: { id, aud: 'authenticated', role: 'authenticated', email, user_metadata: { full_name: p.full_name, role: p.role }, app_metadata: {}, created_at: p.created_at } };
}
const uidOf = (req) => sessions[(req.headers.authorization || '').replace('Bearer ', '')] || null;
const me = (req) => db.profiles.find((p) => p.id === uidOf(req));
const active = (p) => p && p.status === 'active' && (p.is_admin || !p.subscription_ends || p.subscription_ends >= today);

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const err = (res, msg, code = 400, pgcode = 'P0001') => send(res, code, { code: pgcode, message: msg, details: null, hint: null });

function matchOne(get, v) {
  let m;
  if ((m = v.match(/^eq\.(.*)$/))) return (r) => String(get(r)) === m[1];
  if (v === 'is.null') return (r) => get(r) === null || get(r) === undefined;
  if (v === 'not.is.null') return (r) => get(r) !== null && get(r) !== undefined;
  if ((m = v.match(/^in\.\((.*)\)$/))) { const set = m[1].split(',').map((x) => x.replace(/"/g, '')); return (r) => set.includes(String(get(r))); }
  if ((m = v.match(/^lt\.(.*)$/))) return (r) => get(r) < m[1];
  if ((m = v.match(/^lte\.(.*)$/))) return (r) => get(r) <= m[1];
  if ((m = v.match(/^gte\.(.*)$/))) return (r) => get(r) >= m[1];
  if ((m = v.match(/^gt\.(.*)$/))) return (r) => get(r) > m[1];
  if ((m = v.match(/^ilike\.(.*)$/))) { const needle = m[1].replace(/[%*]/g, '').toLowerCase(); return (r) => String(get(r) ?? '').toLowerCase().includes(needle); }
  return () => true;
}
const getter = (k) => { const key = k.split('.'); return (r) => key.reduce((o, kk) => (o ? o[kk] : undefined), r); };
function applyFilters(rows, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    if (k === 'or') {
      // or=(a.is.null,a.in.(x,y))
      const inner = v.replace(/^\(/, '').replace(/\)$/, '');
      const parts = inner.match(/[a-z_.]+\.(?:in\.\([^)]*\)|[^,]+)/g) || [];
      const tests = parts.map((p) => { const i = p.indexOf('.'); return matchOne(getter(p.slice(0, i)), p.slice(i + 1)); });
      rows = rows.filter((r) => tests.some((t) => t(r)));
      continue;
    }
    rows = rows.filter(matchOne(getter(k), v));
  }
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((o) => { const [col, dir, nulls] = o.split('.'); return { g: getter(col), desc: dir === 'desc', nullsFirst: nulls === 'nullsfirst' }; }).reverse();
    for (const { g, desc, nullsFirst } of keys) {
      rows = [...rows].sort((a, b) => {
        const x = g(a), y = g(b);
        if (x == null && y == null) return 0;
        if (x == null) return nullsFirst ? -1 : 1;
        if (y == null) return nullsFirst ? 1 : -1;
        return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
      });
    }
  }
  return rows;
}

const EDITORS = ['specialist', 'senior_resident', 'clinical_pharmacist', 'chief_clinical_pharmacist'];
const RPC = {
  register_patient(u, a) {
    if (!EDITORS.includes(u.role)) throw ['ليست لديك صلاحية لهذا الإجراء', '42501'];
    const id = 'p' + crypto.randomUUID().slice(0, 6);
    addPatient(id, a.p_full_name.trim(), a.p_sex, a.p_birth_date, a.p_height_cm, a.p_weight_kg, a.p_allergies,
      a.p_specialist || (u.role === 'specialist' ? u.id : null), { phone: a.p_phone });
    db.patients.at(-1).created_at = new Date().toISOString();
    return id;
  },
  update_patient(u, a) {
    if (!EDITORS.includes(u.role)) throw ['ليست لديك صلاحية لهذا الإجراء', '42501'];
    const p = db.patients.find((x) => x.id === a.p_id && !x.archived_at);
    if (!p) throw 'المريض غير موجود أو مؤرشف';
    Object.assign(p, { full_name: a.p_full_name, birth_date: a.p_birth_date, sex: a.p_sex, height_cm: a.p_height_cm, weight_kg: a.p_weight_kg,
      phone: a.p_phone, allergies: a.p_allergies, specialist_id: a.p_specialist });
    return null;
  },
  archive_patient(u, a) {
    if (u.role !== 'specialist') throw ['ليست لديك صلاحية لهذا الإجراء', '42501'];
    const p = db.patients.find((x) => x.id === a.p_id); p.archived_at = new Date().toISOString(); p.archive_reason = a.p_reason; return null;
  },
  postpone_cycle(u, a) {
    if (!['specialist', 'senior_resident'].includes(u.role)) throw ['ليست لديك صلاحية لهذا الإجراء', '42501'];
    const c = db.cycles_raw.find((x) => x.id === a.p_cycle && ['planned', 'held'].includes(x.status));
    if (!c) throw 'الدورة غير قابلة للتأجيل';
    const shift = Math.round((new Date(a.p_new_date) - new Date(c.planned_date)) / 864e5);
    db.cycles_raw.filter((x) => x.treatment_id === c.treatment_id && x.cycle_no >= c.cycle_no && ['planned', 'held'].includes(x.status))
      .forEach((x) => { const d = new Date(x.planned_date); d.setDate(d.getDate() + shift); x.planned_date = d.toISOString().slice(0, 10); if (x === c) x.postpone_reason = a.p_reason; });
    return null;
  },
  redeem_activation_code(u, { p_code }) {
    const c = db.activation_codes.find((x) => x.code === String(p_code).trim().toUpperCase());
    if (!c) throw 'الكود غير صحيح';
    if (c.revoked) throw 'أُلغي هذا الكود';
    if (c.used_by) throw 'استُخدم هذا الكود من قبل';
    if (c.role !== u.role) throw 'الكود لا يطابق التخصص الذي اخترته';
    const d = new Date(); d.setMonth(d.getMonth() + c.months);
    c.used_by = u.id; c.used_at = new Date().toISOString();
    u.status = 'active'; u.subscription_ends = d.toISOString().slice(0, 10);
    return u.subscription_ends;
  },
  admin_create_code(u, { p_role, p_months }) {
    if (!u.is_admin) throw ['للمدير فقط', '42501'];
    const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = ''; for (let i = 0; i < 8; i++) { code += ch[crypto.randomInt(ch.length)]; if (i === 3) code += '-'; }
    db.activation_codes.unshift({ code, role: p_role, months: p_months, created_by: u.id, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), used_by: null, revoked: false });
    return code;
  },
  admin_revoke_code(u, { p_code }) { const c = db.activation_codes.find((x) => x.code === p_code); if (c && !c.used_by) c.revoked = true; return null; },
  admin_update_user(u, { p_user, p_status, p_role }) {
    if (!u.is_admin) throw ['للمدير فقط', '42501'];
    const t = db.profiles.find((p) => p.id === p_user);
    if (p_status) t.status = p_status; if (p_role) t.role = p_role; return null;
  },
  admin_extend_subscription(u, { p_user, p_months }) {
    const t = db.profiles.find((p) => p.id === p_user);
    const base = t.subscription_ends && t.subscription_ends > today ? new Date(t.subscription_ends) : new Date();
    base.setMonth(base.getMonth() + p_months); t.subscription_ends = base.toISOString().slice(0, 10); return t.subscription_ends;
  },
  mark_notifications_read(u, { p_ids }) {
    db.notifications.filter((n) => n.user_id === u.id && !n.read_at && (!p_ids || p_ids.includes(n.id))).forEach((n) => { n.read_at = new Date().toISOString(); });
    return null;
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  for await (const ch of req) body += ch;
  const json = body ? JSON.parse(body) : {};

  if (url.pathname === '/auth/v1/signup') {
    if (db.users[json.email]) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
    const id = addUser(json.email, json.password, json.data || {});
    return send(res, 200, session(id, json.email));
  }
  if (url.pathname === '/auth/v1/token') {
    const u = db.users[json.email];
    if (!u || u.password !== json.password) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return send(res, 200, session(u.id, json.email));
  }
  if (url.pathname === '/auth/v1/logout') return send(res, 204);
  if (url.pathname === '/auth/v1/user') { const p = me(req); return p ? send(res, 200, session(p.id, p.email).user) : send(res, 401, { msg: 'invalid JWT' }); }

  if (url.pathname.startsWith('/rest/v1/')) {
    const u = me(req);
    const name = url.pathname.slice(9);
    if (name.startsWith('rpc/')) {
      const fn = RPC[name.slice(4)];
      if (!u) return err(res, 'سجّل الدخول أولاً', 401, '42501');
      try { return send(res, 200, fn(u, json)); }
      catch (e) { return Array.isArray(e) ? err(res, e[0], 403, e[1]) : err(res, String(e)); }
    }
    let rows = name === 'patient_overview' ? overview() : name === 'cycles' ? cyclesJoined() : db[name];
    if (!rows) return err(res, 'no table ' + name, 404);
    // محاكاة RLS المبسطة
    if (name === 'profiles') rows = active(u) ? rows : rows.filter((p) => u && p.id === u.id);
    else if (name === 'notifications') rows = rows.filter((n) => u && n.user_id === u.id);
    else if (name === 'activation_codes') rows = u && u.is_admin ? rows.map((c) => ({ ...c, used: c.used_by ? { full_name: db.profiles.find((p) => p.id === c.used_by).full_name } : null })) : [];
    else rows = active(u) ? rows : [];
    rows = applyFilters(rows, url.searchParams);
    const limit = Number(url.searchParams.get('limit') || 1000);
    const total = rows.length;
    rows = rows.slice(0, limit).map((r) => (name === 'patients' ? { ...r } : r));
    const headers = { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${total}` };
    if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
    if ((req.headers.accept || '').includes('vnd.pgrst.object')) return send(res, 200, rows[0] || null, headers);
    return send(res, 200, rows, headers);
  }

  // إعدادات الاختبار بدل config.js الحقيقي
  if (url.pathname === '/js/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(`export const SUPABASE_URL = 'http://localhost:${PORT}';\nexport const SUPABASE_KEY = 'test-anon-key';\nexport const CENTER_NAME = 'مركز أمراض الدم';\n`);
  }
  // الملفات الثابتة
  let file = path.join(WEB, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT, () => console.log('mock on', PORT));
