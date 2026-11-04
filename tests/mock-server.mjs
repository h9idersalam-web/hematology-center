// خادم تجريبي يحاكي Supabase لاختبار الواجهة محلياً فقط (لا يُرفع إلى GitHub)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const WEB = path.resolve(process.argv[2] || './web');
const PORT = Number(process.argv[3] || 8787);
const today = new Date().toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const db = {
  users: {},  // email -> {id,password}
  profiles: [],
  activation_codes: [],
  notifications: [],
  patients: [{ id: 'p1', archived_at: null }, { id: 'p2', archived_at: null }, { id: 'p3', archived_at: null }],
  change_requests: [{ id: 'r1', status: 'pending' }],
  cycles: [
    { id: 'c1', cycle_no: 3, status: 'planned', planned_date: today, doctor_approved_at: '2026-11-04T08:00:00Z', pharmacist_verified_at: '2026-11-04T08:10:00Z', treatments: { protocol_name: 'R-CHOP-21', total_cycles: 6, status: 'active', patients: { id: 'p1', full_name: 'علي حسين كاظم' } } },
    { id: 'c2', cycle_no: 2, status: 'planned', planned_date: today, doctor_approved_at: '2026-11-04T08:00:00Z', pharmacist_verified_at: null, treatments: { protocol_name: 'ABVD', total_cycles: 6, status: 'active', patients: { id: 'p2', full_name: 'زينب عبد الأمير' } } },
    { id: 'c3', cycle_no: 4, status: 'held', planned_date: today, doctor_approved_at: null, pharmacist_verified_at: null, treatments: { protocol_name: 'VRd', total_cycles: 8, status: 'active', patients: { id: 'p3', full_name: 'حسن رعد' } } },
    { id: 'c4', cycle_no: 3, status: 'planned', planned_date: addDays(-5), treatments: { protocol_name: 'R-CHOP-21', total_cycles: 6, status: 'active', patients: { id: 'p4', full_name: 'كرار ماجد' } } },
  ],
};

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

function applyFilters(rows, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const key = k.split('.');
    const get = (r) => key.reduce((o, kk) => (o ? o[kk] : undefined), r);
    let m;
    if ((m = v.match(/^eq\.(.*)$/))) rows = rows.filter((r) => String(get(r)) === m[1]);
    else if (v === 'is.null') rows = rows.filter((r) => get(r) === null || get(r) === undefined);
    else if (v === 'not.is.null') rows = rows.filter((r) => get(r) !== null && get(r) !== undefined);
    else if ((m = v.match(/^in\.\((.*)\)$/))) { const set = m[1].split(',').map((s) => s.replace(/"/g, '')); rows = rows.filter((r) => set.includes(String(get(r)))); }
    else if ((m = v.match(/^lt\.(.*)$/))) rows = rows.filter((r) => get(r) < m[1]);
    else if ((m = v.match(/^lte\.(.*)$/))) rows = rows.filter((r) => get(r) <= m[1]);
  }
  return rows;
}

const RPC = {
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
    let rows = db[name];
    if (!rows) return err(res, 'no table ' + name, 404);
    // محاكاة RLS المبسطة
    if (name === 'profiles') rows = active(u) ? rows : rows.filter((p) => u && p.id === u.id);
    else if (name === 'notifications') rows = rows.filter((n) => u && n.user_id === u.id);
    else if (name === 'activation_codes') rows = u && u.is_admin ? rows.map((c) => ({ ...c, used: c.used_by ? { full_name: db.profiles.find((p) => p.id === c.used_by).full_name } : null })) : [];
    else rows = active(u) ? rows : [];
    rows = applyFilters(rows, url.searchParams);
    const limit = Number(url.searchParams.get('limit') || 1000);
    const total = rows.length;
    rows = rows.slice(0, limit);
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
