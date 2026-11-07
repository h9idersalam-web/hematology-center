// الإشعارات: طلبات الموافقة والتنبيهات الذكية وردود الأطباء
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, empty, relTime, toast } from '../ui.js';

const KIND = {
  approval: { label: 'بانتظار موافقتك', icon: 'shield', tone: 'brand' },
  decision: { label: 'قرار الطبيب', icon: 'check', tone: 'ok' },
  alert: { label: 'تنبيه', icon: 'warn', tone: 'warn' },
  mixing: { label: 'المزج', icon: 'drop', tone: 'info' },
  mixing_sent: { label: 'المزج', icon: 'drop', tone: 'ok' },
  info: { label: 'للعلم', icon: 'info', tone: 'info' },
  new_user: { label: 'مستخدم جديد', icon: 'users', tone: 'warn' },
  protocol: { label: 'بروتوكول', icon: 'book', tone: 'info' },
  account: { label: 'الحساب', icon: 'key', tone: 'muted' },
};

const LINKS = {
  profile: () => '#/admin?tab=users',
  patient: (id) => '#/patient?id=' + id,
  treatment: (id) => '#/treatment?id=' + id,
  change_request: (id) => '#/request?id=' + id,
  protocol: (id) => '#/protocol?id=' + id,
  cycle: (id) => '#/cycle?id=' + id,
  mixing_order: (id) => '#/mixing-order?id=' + id,
  lab_result: (id) => '#/lab-alert?id=' + id,
};

export async function render(root, params) {
  let tab = params.get('tab') || 'all';
  const list = h('div', { class: 'card flush' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  const markAll = h('button', { class: 'link-btn', style: 'padding: 0 12px', text: 'قراءة الكل', onclick: async () => {
    try { await rpc('mark_notifications_read', { p_ids: null }); toast('عُلِّمت كل الإشعارات مقروءة'); load(); } catch (e) { toast(e.message, true); }
  } });

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'الإشعارات', back: '#/home', actions: markAll }),
    tabs,
    h('main', { class: 'main' }, list)));

  function drawTabs(counts) {
    const items = [['all', 'الكل'], ['approval', 'الموافقات'], ['alert', 'التنبيهات']];
    tabs.replaceChildren(...items.map(([id, label]) => h('button', {
      role: 'tab', 'aria-selected': tab === id ? 'true' : 'false',
      onclick: () => { tab = id; drawTabs(counts); load(); },
    }, label, counts && counts[id] ? h('span', { class: 'count', text: counts[id] }) : null)));
  }

  async function load() {
    try {
      let query = sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
      if (tab !== 'all') query = query.eq('kind', tab);
      const rows = await q(query);
      const unread = await q(sb.from('notifications').select('kind').is('read_at', null));
      const counts = { all: unread.length };
      unread.forEach((r) => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
      drawTabs(counts);
      list.replaceChildren(...(rows.length ? rows.map(row) : [empty('لا توجد إشعارات', 'bell')]));
    } catch (e) {
      list.replaceChildren(h('div', { class: 'notice err', style: 'margin: 12px' }, icon('warn', 20), h('p', { text: e.message })));
    }
  }

  function row(n) {
    const k = KIND[n.kind] || KIND.info;
    // إشعارات «تحليل خارج المرجع» القديمة كانت تشير إلى المريض: تفتح الآن شاشة التحليل نفسها
    const href = n.link_type === 'patient' && n.title === 'تحليل خارج المرجع'
      ? `#/lab-alert?patient=${n.link_id}&at=${encodeURIComponent(n.created_at)}`
      : LINKS[n.link_type] ? LINKS[n.link_type](n.link_id) : null;
    const el = h(href ? 'a' : 'div', { class: 'row', href, style: n.read_at ? null : 'background: #FFFBFB' },
      h('span', { class: 'avatar', style: `border-radius: 10px; width: 38px; height: 38px; background: var(--${k.tone === 'muted' ? 'chip' : k.tone + '-soft'}); color: var(--${k.tone === 'muted' ? 'muted' : k.tone === 'brand' ? 'brand' : k.tone})` }, icon(k.icon, 20)),
      h('span', { class: 'grow' },
        h('span', { class: 't', style: 'font-size: 15px; line-height: 1.6', text: n.title }),
        n.body ? h('span', { class: 's', style: 'line-height: 1.6', text: n.body }) : null,
        h('span', { class: 's', style: 'font-size: 13px', text: `${k.label} · ${relTime(n.created_at)}` })),
      n.read_at ? null : h('span', { class: 'sr-only', text: 'غير مقروء' }),
      n.read_at ? null : h('span', { 'aria-hidden': 'true', style: 'width: 10px; height: 10px; border-radius: 5px; background: var(--brand); flex-shrink: 0' }));
    el.addEventListener('click', () => { if (!n.read_at) rpc('mark_notifications_read', { p_ids: [n.id] }).catch(() => {}); });
    return el;
  }

  drawTabs();
  load();
}
