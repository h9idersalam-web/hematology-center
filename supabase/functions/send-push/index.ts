// دالة الخادم send-push (الملف 40): ترسل كل إشعار جديد إلى أجهزة صاحبه، والتطبيق مغلق.
//   - تستدعيها قاعدة البيانات (مشغّل notifications) مع سر الربط x-push-secret.
//   - { action: 'init' }: تولّد مفاتيح VAPID أول مرة وتحفظها في push_config، وتعيد المفتاح العام فقط.
//   المفاتيح والسر لا تغادر الخادم والقاعدة. verify_jwt مطفأ لأن الدالة تتحقق بالسر نفسها.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// المصطلحات المعتمدة في الواجهة (نسخة من web/js/terms.js)
const DOSE: [RegExp, string][] = [
  [/والجرعات/g, "و§1"], [/الجرعات/g, "§1"], [/وجرعاتها/g, "و§2"], [/جرعاتها/g, "§2"], [/وجرعات/g, "و§3"], [/جرعات/g, "§3"],
  [/والجرعة/g, "و§4"], [/للجرعة/g, "ل§5"], [/الجرعة/g, "§4"], [/وجرعته/g, "و§6"], [/جرعتان/g, "§7"], [/جرعة/g, "§8"],
];
const OUT: Record<string, string> = { "§1": "الجرعات الدوائية", "§2": "جرعاتها الدوائية", "§3": "جرعات دوائية", "§4": "الجرعة الدوائية",
  "§5": "لجرعة الدوائية", "§6": "جرعته الدوائية", "§7": "جرعتان دوائيتان", "§8": "جرعة دوائية" };
function terms(s: string | null): string {
  if (!s || !/[؀-ۿ]/.test(s)) return s || "";
  let t = s.replace(/خارج المرجع/g, "خارج الحد الطبيعي");
  for (const [re, ph] of DOSE) t = t.replace(re, ph);
  t = t.replace(/دورات/g, "جرعات").replace(/دورة/g, "جرعة").replace(/دورت/g, "جرعت");
  return t.replace(/§\d/g, (m) => OUT[m]);
}

// رابط الإشعار داخل التطبيق (نسخة من hrefOf في web/js/notify.js)
const LINKS: Record<string, (id: string) => string> = {
  profile: () => "#/admin?tab=users",
  patient: (id) => "#/patient?id=" + id,
  treatment: (id) => "#/treatment?id=" + id,
  change_request: (id) => "#/request?id=" + id,
  protocol: (id) => "#/protocol?id=" + id,
  cycle: (id) => "#/cycle?id=" + id,
  mixing_order: (id) => "#/mixing-order?id=" + id,
  lab_result: (id) => "#/lab-alert?id=" + id,
  inventory_report: (id) => "#/report-pharmacy?id=" + id,
};
function hrefOf(n: { link_type: string | null; link_id: string | null; title: string; created_at: string }) {
  if (n.link_type === "patient" && /^تحليل خارج (المرجع|الحد الطبيعي)$/.test(n.title)) {
    return `#/lab-alert?patient=${n.link_id}&at=${encodeURIComponent(n.created_at)}`;
  }
  return n.link_type && LINKS[n.link_type] ? LINKS[n.link_type](n.link_id || "") : "#/notifications";
}
const URGENT = new Set(["alert", "approval"]);

async function config() {
  const { data, error } = await sb.from("push_config").select("*").eq("id", 1).single();
  if (error) throw error;
  if (data.vapid_public && data.vapid_private) return data;
  const k = webpush.generateVAPIDKeys();
  await sb.from("push_config").update({ vapid_public: k.publicKey, vapid_private: k.privateKey }).eq("id", 1).is("vapid_public", null);
  const again = await sb.from("push_config").select("*").eq("id", 1).single();
  return again.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const cfg = await config();
    if (body.action === "init") return json({ publicKey: cfg.vapid_public });

    if (!cfg.hook_secret || req.headers.get("x-push-secret") !== cfg.hook_secret) return json({ error: "unauthorized" }, 401);
    if (!body.id) return json({ error: "missing id" }, 400);

    const { data: n } = await sb.from("notifications").select("id, user_id, kind, title, body, link_type, link_id, created_at").eq("id", body.id).single();
    if (!n) return json({ sent: 0, reason: "no notification" });
    const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id);
    if (!subs?.length) return json({ sent: 0 });

    webpush.setVapidDetails(cfg.subject, cfg.vapid_public, cfg.vapid_private);
    const payload = JSON.stringify({
      title: terms(n.title), body: terms(n.body), url: hrefOf(n), tag: n.id, urgent: URGENT.has(n.kind),
    });
    let sent = 0;
    const gone: string[] = [], ok: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
          { TTL: 60 * 60 * 24, urgency: URGENT.has(n.kind) ? "high" : "normal" });
        sent++; ok.push(s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.id);   // الاشتراك انتهى (أُزيل التطبيق أو سُحب الإذن)
        else console.error("push failed", code, (e as Error).message);
      }
    }));
    if (gone.length) await sb.from("push_subscriptions").delete().in("id", gone);
    if (ok.length) await sb.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).in("id", ok);
    return json({ sent, removed: gone.length });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
