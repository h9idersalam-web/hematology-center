// خادم اختبار محلي: يحاكي واجهة Supabase (المصادقة وPostgREST) فوق PostgreSQL محلي
// بالمخطط والدوال وسياسات الأمان الحقيقية. للاختبار فقط، لا يُنشر.
//   node tests/pgrest-lite.mjs ./web 8788
// يحتاج: PostgreSQL محلي على /var/lib/pgtest:5499 ومكتبة pg
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const WEB = path.resolve(process.argv[2] || './web');
const PORT = Number(process.argv[3] || 8788);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

pg.types.setTypeParser(1082, (v) => v);                                // date
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());        // timestamptz
pg.types.setTypeParser(1114, (v) => v);                                // timestamp
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));  // numeric
pg.types.setTypeParser(20, (v) => Number(v));                          // int8

const pool = new pg.Pool({ host: '/var/lib/pgtest', port: 5499, user: 'postgres', database: 'postgres', max: 6 });

// ------------------------------------------------------------------ إعداد القاعدة
function psql(file) {
  execFileSync('psql', ['-h', '/var/lib/pgtest', '-p', '5499', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: ['ignore', 'ignore', 'pipe'] });
}
const RESET = `drop schema if exists public cascade; create schema public; grant all on schema public to postgres, public;
  drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists extensions cascade; drop schema if exists t cascade;
  drop role if exists anon; drop role if exists authenticated;`;

export const USERS = [
  ['admin@test.iq', 'حيدر سلام', 'chief_clinical_pharmacist', { admin: true }],
  ['sara@test.iq', 'د. سارة الربيعي', 'specialist'],
  ['ali@test.iq', 'د. علي الجبوري', 'specialist'],
  ['morteza@test.iq', 'د. مرتضى سعد', 'senior_resident'],
  ['intern@test.iq', 'د. حسين كامل', 'intern'],
  ['cp@test.iq', 'رسل عادل', 'clinical_pharmacist'],
  ['mix@test.iq', 'زهراء فاضل', 'mixing_pharmacist'],
  ['nurse@test.iq', 'نور حيدر', 'nurse'],
];
const PASSWORD = 'Pass12345';
const passwords = {};

async function setup() {
  await pool.query(RESET);
  for (const f of ['tests/00_supabase_stub.sql', 'supabase/01_schema.sql', 'supabase/02_storage.sql', 'supabase/03_seed_protocols.sql',
    ...fs.readdirSync(path.join(ROOT, 'supabase')).filter((f) => /^(0[5-9]|1[0-9])_.*\.sql$/.test(f)).sort().map((f) => 'supabase/' + f)]) {
    psql(path.join(ROOT, f));
  }
  for (const [email, name, role, opt] of USERS) {
    const id = crypto.createHash('md5').update(email).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    await pool.query('insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, { full_name: name, role }]);
    await pool.query(`update profiles set status = 'active', is_admin = $2, subscription_ends = case when $2 then null else current_date + 180 end where id = $1`, [id, !!opt?.admin]);
    passwords[email] = PASSWORD;
  }
  if (fs.existsSync(path.join(ROOT, 'tests/seed_ui.sql'))) psql(path.join(ROOT, 'tests/seed_ui.sql'));
}

// ------------------------------------------------------------------ بنية المخطط
let FKS = [], FN_ARGS = {};
async function loadMeta() {
  FKS = (await pool.query(`
    select c.conname, cl.relname as from_t, a.attname as from_c, cf.relname as to_t, af.attname as to_c
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
      join pg_class cf on cf.oid = c.confrelid
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
     where c.contype = 'f' and n.nspname = 'public'`)).rows;
  const fns = (await pool.query(`
    select p.proname, p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as types
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows;
  for (const f of fns) {
    FN_ARGS[f.proname] = {};
    (f.proargnames || []).forEach((nm, i) => { if (f.types[i]) FN_ARGS[f.proname][nm] = f.types[i]; });
  }
}

// ------------------------------------------------------------------ تحليل select
function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseSelect(s) {
  return splitTop(s || '*').map((tok) => {
    const m = tok.match(/^(?:(\w+):)?([\w*!]+)(?:\((.*)\))?$/s);
    if (!m) throw new Error('bad select ' + tok);
    const [, alias, nameHint, inner] = m;
    const [name, ...mods] = nameHint.split('!');
    if (inner === undefined) return { kind: 'col', name, alias: alias || name };
    return { kind: 'embed', rel: name, alias: alias || name, inner: mods.includes('inner'),
      hint: mods.find((x) => x !== 'inner') || null, children: parseSelect(inner) };
  });
}

function resolveEmbed(parent, rel, hint) {
  let cands = [
    ...FKS.filter((f) => f.from_t === parent && f.to_t === rel).map((f) => ({ ...f, many: false })),
    ...FKS.filter((f) => f.from_t === rel && f.to_t === parent).map((f) => ({ ...f, many: true })),
  ];
  if (hint) cands = cands.filter((f) => f.conname === hint || f.from_c === hint);
  if (cands.length === 0) throw httpErr(400, 'PGRST200', `Could not find a relationship between '${parent}' and '${rel}'`);
  if (cands.length > 1) throw httpErr(300, 'PGRST201', `Could not embed because more than one relationship was found for '${parent}' and '${rel}'`);
  return cands[0];
}
const httpErr = (status, code, message) => Object.assign(new Error(message), { status, code });
const ident = (s) => { if (!/^\w+$/.test(s)) throw httpErr(400, 'PGRST100', 'bad identifier ' + s); return '"' + s + '"'; };

// ------------------------------------------------------------------ المرشّحات
function sqlFilter(col, v, params) {
  const c = ident(col);
  let m;
  const p = (val) => { params.push(val); return '$' + params.length; };
  if ((m = v.match(/^not\.(.*)$/))) return `not (${sqlFilter(col, m[1], params)})`;
  if ((m = v.match(/^eq\.(.*)$/s))) return `${c}::text = ${p(m[1])}`;
  if ((m = v.match(/^neq\.(.*)$/s))) return `${c}::text <> ${p(m[1])}`;
  if (v === 'is.null') return `${c} is null`;
  if (v === 'is.true') return `${c} is true`;
  if (v === 'is.false') return `${c} is false`;
  if ((m = v.match(/^in\.\((.*)\)$/s))) return `${c}::text = any(${p(m[1] === '' ? [] : m[1].split(',').map((x) => x.replace(/^"|"$/g, '')))}::text[])`;
  if ((m = v.match(/^(lt|lte|gt|gte)\.(.*)$/s))) return `${c} ${{ lt: '<', lte: '<=', gt: '>', gte: '>=' }[m[1]]} ${p(m[2])}`;
  if ((m = v.match(/^(ilike|like)\.(.*)$/s))) return `${c}::text ${m[1]} ${p(m[2].replace(/\*/g, '%'))}`;
  throw httpErr(400, 'PGRST100', 'unsupported filter ' + v);
}
function sqlOr(v, params) {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  const parts = splitTop(inner);
  return '(' + parts.map((pt) => { const i = pt.indexOf('.'); return sqlFilter(pt.slice(0, i), pt.slice(i + 1), params); }).join(' or ') + ')';
}
function jsMatch(val, v) {
  let m;
  if ((m = v.match(/^not\.(.*)$/))) return !jsMatch(val, m[1]);
  if (v === 'is.null') return val === null || val === undefined;
  if ((m = v.match(/^eq\.(.*)$/s))) return val !== null && val !== undefined && String(val) === m[1];
  if ((m = v.match(/^neq\.(.*)$/s))) return String(val) !== m[1];
  if ((m = v.match(/^in\.\((.*)\)$/s))) return m[1].split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(val));
  const cmp = (a, b) => (typeof a === 'number' ? a - Number(b) : String(a) < b ? -1 : String(a) > b ? 1 : 0);
  if ((m = v.match(/^(lt|lte|gt|gte)\.(.*)$/s))) { if (val == null) return false; const c = cmp(val, m[2]); return { lt: c < 0, lte: c <= 0, gt: c > 0, gte: c >= 0 }[m[1]]; }
  if ((m = v.match(/^ilike\.(.*)$/s))) return String(val ?? '').toLowerCase().includes(m[1].replace(/[%*]/g, '').toLowerCase());
  throw httpErr(400, 'PGRST100', 'unsupported embedded filter ' + v);
}

// ------------------------------------------------------------------ القراءة
async function embedRows(client, table, rows, items) {
  for (const it of items.filter((x) => x.kind === 'embed')) {
    const fk = resolveEmbed(table, it.rel, it.hint);
    const key = fk.many ? 'id' : fk.from_c;
    const ids = [...new Set(rows.map((r) => r[fk.many ? fk.to_c : fk.from_c]).filter((x) => x != null).map(String))];
    let children = [];
    if (ids.length) {
      const col = fk.many ? fk.from_c : fk.to_c;
      children = (await client.query(`select * from public.${ident(it.rel)} where ${ident(col)}::text = any($1::text[])`, [ids])).rows;
      await embedRows(client, it.rel, children, it.children);
    }
    for (const r of rows) {
      if (fk.many) r[it.alias] = children.filter((c) => String(c[fk.from_c]) === String(r[fk.to_c]));
      else r[it.alias] = children.find((c) => String(c[fk.to_c]) === String(r[fk.from_c])) || null;
    }
    void key;
  }
}
function project(row, items) {
  if (!row) return row;
  const out = {};
  const star = items.some((x) => x.kind === 'col' && x.name === '*');
  if (star) for (const [k, v] of Object.entries(row)) if (!items.some((x) => x.kind === 'embed' && x.alias === k)) out[k] = v;
  for (const it of items) {
    if (it.kind === 'col' && it.name !== '*') {
      if (!(it.name in row)) throw httpErr(400, '42703', `column ${it.name} does not exist`);
      out[it.alias] = row[it.name];
    } else if (it.kind === 'embed') {
      const v = row[it.alias];
      out[it.alias] = Array.isArray(v) ? v.map((x) => project(x, it.children)) : project(v, it.children);
    }
  }
  return out;
}
// مرشّحات على الجداول المضمّنة: emb.col أو emb.emb2.col
function applyEmbeddedFilter(rows, pathParts, v, items) {
  const [head, ...rest] = pathParts;
  const it = items.find((x) => x.kind === 'embed' && x.alias === head);
  if (!it) throw httpErr(400, 'PGRST100', 'unknown embed ' + head);
  const keep = [];
  for (const r of rows) {
    const e = r[it.alias];
    if (rest.length === 1) {
      if (Array.isArray(e)) { r[it.alias] = e.filter((c) => jsMatch(c[rest[0]], v)); if (!it.inner || r[it.alias].length) keep.push(r); }
      else if (e && jsMatch(e[rest[0]], v)) keep.push(r);
      else if (!it.inner) { r[it.alias] = null; keep.push(r); }
    } else {
      const sub = Array.isArray(e) ? e : e ? [e] : [];
      const passed = applyEmbeddedFilter(sub, rest, v, it.children);
      if (Array.isArray(e)) { r[it.alias] = passed; if (!it.inner || passed.length) keep.push(r); }
      else if (passed.length) keep.push(r);
      else if (!it.inner) { r[it.alias] = null; keep.push(r); }
    }
  }
  return keep;
}
function dropEmptyInner(rows, items) {
  return rows.filter((r) => items.every((it) => it.kind !== 'embed' || !it.inner || (Array.isArray(r[it.alias]) ? r[it.alias].length : r[it.alias])));
}

async function readTable(client, table, url, method, headers) {
  const items = parseSelect(url.searchParams.get('select'));
  const params = [], where = [];
  const embedded = [];
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'columns'].includes(k)) continue;
    if (k === 'or') { where.push(sqlOr(v, params)); continue; }
    if (k.includes('.')) { embedded.push([k.split('.'), v]); continue; }
    where.push(sqlFilter(k, v, params));
  }
  let order = '';
  const o = url.searchParams.get('order');
  if (o) order = ' order by ' + o.split(',').map((x) => { const [c, ...mods] = x.split('.'); return ident(c) + ' ' + mods.map((mm) => ({ asc: 'asc', desc: 'desc', nullsfirst: 'nulls first', nullslast: 'nulls last' }[mm] || '')).join(' '); }).join(', ');
  let rows = (await client.query(`select * from public.${ident(table)}${where.length ? ' where ' + where.join(' and ') : ''}${order}`, params)).rows;
  await embedRows(client, table, rows, items);
  for (const [p, v] of embedded) rows = applyEmbeddedFilter(rows, p, v, items);
  rows = dropEmptyInner(rows, items);
  const total = rows.length;
  const off = Number(url.searchParams.get('offset') || 0);
  const lim = url.searchParams.get('limit');
  rows = rows.slice(off, lim ? off + Number(lim) : undefined).map((r) => project(r, items));
  const range = rows.length ? `${off}-${off + rows.length - 1}/${total}` : `*/${total}`;
  return { rows, range };
}

// ------------------------------------------------------------------ الجلسات
const sessions = {};
async function session(email) {
  const { rows } = await pool.query('select u.id, u.email, p.full_name, p.role from auth.users u join profiles p on p.id = u.id where u.email = $1', [email]);
  const u = rows[0];
  const token = 'tok-' + crypto.randomUUID();
  sessions[token] = u.id;
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + token,
    user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: { full_name: u.full_name, role: u.role }, app_metadata: {}, created_at: new Date().toISOString() } };
}
const uidOf = (req) => sessions[(req.headers.authorization || '').replace('Bearer ', '')] || null;

async function asUser(uid, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(uid ? 'set local role authenticated' : 'set local role anon');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
  finally { client.release(); }
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function sendErr(res, e) {
  const code = e.code || 'XX000';
  const status = e.status || (code === '42501' ? 403 : code === 'P0001' ? 400 : 400);
  if (!e.status && !/^(P0001|42501|23|22)/.test(code)) console.error('SQL ERROR', code, e.message);
  send(res, status, { code, message: e.message, details: e.detail || null, hint: e.hint || null });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks);
  const isJson = (req.headers['content-type'] || '').includes('json');
  const json = raw.length && (isJson || url.pathname.startsWith('/auth/')) ? JSON.parse(raw.toString('utf8')) : {};
  try {
    if (req.method === 'OPTIONS') return send(res, 204, undefined, { 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
    if (url.pathname === '/auth/v1/signup') {
      if (passwords[json.email]) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      await pool.query('insert into auth.users(email, raw_user_meta_data) values ($1, $2)', [json.email, json.data || {}]);
      passwords[json.email] = json.password;
      return send(res, 200, await session(json.email));
    }
    if (url.pathname === '/auth/v1/token') {
      if (passwords[json.email] !== json.password) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      // كما في Supabase: الحساب المحذوف (تغيّر بريده) أو المحظور لا يدخل
      const { rows: au } = await pool.query('select banned_until from auth.users where email = $1', [json.email]);
      if (!au.length || (au[0].banned_until && new Date(au[0].banned_until) > new Date())) return send(res, 400, { code: 400, error_code: 'user_banned', msg: 'User is banned' });
      return send(res, 200, await session(json.email));
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname === '/auth/v1/user') {
      const uid = uidOf(req); if (!uid) return send(res, 401, { msg: 'invalid JWT' });
      const { rows } = await pool.query('select email from auth.users where id = $1', [uid]);
      return send(res, 200, (await session(rows[0].email)).user);
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const uid = uidOf(req);
      const name = url.pathname.slice(9);
      if (name.startsWith('rpc/')) {
        const fn = name.slice(4);
        if (!/^\w+$/.test(fn) || !FN_ARGS[fn]) throw httpErr(404, 'PGRST202', 'Could not find the function ' + fn);
        const keys = Object.keys(json);
        const vals = keys.map((k) => {
          const t = FN_ARGS[fn][k];
          if (!t) throw httpErr(404, 'PGRST202', `function ${fn} has no argument ${k}`);
          const v = json[k];
          return v !== null && (t === 'jsonb' || t === 'json') ? JSON.stringify(v) : v;
        });
        const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}::${FN_ARGS[fn][k].replace(/ variadic$/, '')}`).join(', ')}) as r`;
        const r = await asUser(uid, (c) => c.query(sql, vals));
        return send(res, 200, r.rows[0].r);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw httpErr(405, 'PGRST105', 'writes to tables are not used by the app');
      const { rows, range } = await asUser(uid, (c) => readTable(c, name, url, req.method, req.headers));
      const headers = { 'content-range': range };
      if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
      if ((req.headers.accept || '').includes('vnd.pgrst.object')) {
        if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
        return send(res, 200, rows[0], headers);
      }
      return send(res, 200, rows, headers);
    }

    if (url.pathname.startsWith('/storage/v1/object/')) return await storage(req, res, url, raw, json);
    if (url.pathname === '/__reset') { await setup(); await loadMeta(); return send(res, 200, { ok: true }); }
    if (url.pathname === '/js/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(`export const SUPABASE_URL = 'http://localhost:${PORT}';\nexport const SUPABASE_KEY = 'test-anon-key';\nexport const CENTER_NAME = 'مركز أمراض الدم';\n`);
    }
    const file = path.join(WEB, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { sendErr(res, e); }
});

// ------------------------------------------------------------------ التخزين (محاكاة Supabase Storage)
const STORE = path.join(process.env.TMPDIR || '/tmp', 'pgrest-lite-store');
const signs = {};
async function storage(req, res, url, raw, json) {
  const uid = uidOf(req);
  let m;
  if (req.method === 'POST' && (m = url.pathname.match(/^\/storage\/v1\/object\/sign\/([\w-]+)\/(.+)$/))) {
    const [, bucket, name] = m.map(decodeURIComponent);
    const found = await asUser(uid, (c) => c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name]));
    if (!found.rowCount) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const tok = crypto.randomUUID(); signs[tok] = { bucket, name, exp: Date.now() + (json.expiresIn || 60) * 1000 };
    return send(res, 200, { signedURL: `/object/sign/${bucket}/${encodeURI(name)}?token=${tok}` });
  }
  if (req.method === 'GET' && (m = url.pathname.match(/^\/storage\/v1\/object\/sign\/([\w-]+)\/(.+)$/))) {
    const s = signs[url.searchParams.get('token')];
    if (!s || s.exp < Date.now()) return send(res, 400, { message: 'invalid token' });
    const file = path.join(STORE, s.bucket, s.name);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' }[ext] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method === 'POST' && (m = url.pathname.match(/^\/storage\/v1\/object\/([\w-]+)\/(.+)$/))) {
    const [, bucket, name] = m.map(decodeURIComponent);
    try {
      await asUser(uid, (c) => c.query('insert into storage.objects(bucket_id, name) values ($1, $2)', [bucket, name]));
    } catch (e) {
      return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    }
    const file = path.join(STORE, bucket, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, raw);
    return send(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
  }
  return send(res, 404, { message: 'not found' });
}

await setup();
await loadMeta();
console.log('loaded', fs.readdirSync(path.join(ROOT, 'supabase')).filter((f) => /^(0[5-9]|1[0-9])_/.test(f)).join(' '));
server.listen(PORT, () => console.log('pgrest-lite on', PORT));
