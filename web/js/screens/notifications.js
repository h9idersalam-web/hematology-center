// الإشعارات: طلبات الموافقة والتنبيهات الذكية وردود الأطباء
import { sb, q, rpc } from '../api.js';
import { terms } from '../terms.js';
import { hrefOf, soundEnabled, enableSound, disableSound, canSystemNotify, canPush, isIosBrowser, pushActive, syncPush, dropPush } from '../notify.js';
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

export async function render(root, params) {
  let tab = params.get('tab') || 'all';
  const list = h('div', { class: 'card flush' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  // التنبيه بالصوت على هذا الجهاز
  const soundBox = h('div');
  const drawSound = () => {
    const on = soundEnabled();
    const btn = h('button', { type: 'button', class: 'btn sm ' + (on ? 'secondary' : 'primary'), text: on ? 'إيقاف' : 'تفعيل' });
    btn.addEventListener('click', async () => {
      if (on) { disableSound(); await dropPush(); toast('أُوقفت الإشعارات على هذا الجهاز'); }
      else {
        const perm = await enableSound();
        toast(perm === 'denied' ? 'إشعارات الهاتف ممنوعة من إعدادات المتصفح: اسمح بها ثم فعّل من جديد'
          : pushActive() ? 'فُعّلت: تصلك الإشعارات حتى والتطبيق مغلق' : 'فُعّل التنبيه بالصوت أثناء فتح التطبيق');
      }
      drawSound();
    });
    const push = on && pushActive();
    soundBox.replaceChildren(h('div', { class: 'card', style: 'flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px' },
      h('span', { style: 'display: flex; flex-direction: column; gap: 2px' },
        h('b', { text: 'إشعارات هذا الهاتف' + (on ? ': مفعّلة' : ': متوقفة') }),
        h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: on
          ? (push ? 'تصلك على شاشة الهاتف حتى والتطبيق مغلق، مع نغمة واهتزاز أثناء فتحه.'
            : 'نغمة واهتزاز' + (canSystemNotify() && Notification.permission === 'granted' ? ' وإشعار على شاشة الهاتف' : '') + ' ما دام التطبيق مفتوحاً.')
          : 'فعّلها لتصلك الإشعارات على شاشة الهاتف حتى والتطبيق مغلق.' }),
        isIosBrowser() ? h('span', { style: 'font-size: 13px; color: var(--brand-dark); font-weight: 600', text: 'على آيفون: ثبّت التطبيق أولاً من Safari (مشاركة ← إضافة إلى الشاشة الرئيسية) ثم افتحه من أيقونته، فتعمل الإشعارات والتطبيق مغلق.' })
          : on && !push && canSystemNotify() && Notification.permission === 'denied' ? h('span', { style: 'font-size: 13px; color: var(--brand-dark)', text: 'الإشعارات ممنوعة لهذا التطبيق من إعدادات الهاتف أو المتصفح.' })
          : on && !push && !canPush() ? h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: 'هذا المتصفح لا يدعم الإشعارات والتطبيق مغلق.' }) : null),
      btn));
  };
  // الاشتراك يُجدَّد في الخلفية؛ تُعاد الكتابة حين يتأكد
  if (soundEnabled() && !pushActive()) syncPush().then((ok) => { if (ok) drawSound(); });
  drawSound();

  const markAll = h('button', { class: 'link-btn', style: 'padding: 0 12px', text: 'قراءة الكل', onclick: async () => {
    try { await rpc('mark_notifications_read', { p_ids: null }); toast('عُلِّمت كل الإشعارات مقروءة'); load(); } catch (e) { toast(e.message, true); }
  } });

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'الإشعارات', back: '#/home', actions: markAll }),
    tabs,
    h('main', { class: 'main' }, soundBox, list)));

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
    const href = n.link_type ? hrefOf(n) : null;
    const el = h(href ? 'a' : 'div', { class: 'row', href, style: n.read_at ? null : 'background: #FFFBFB' },
      h('span', { class: 'avatar', style: `border-radius: 10px; width: 38px; height: 38px; background: var(--${k.tone === 'muted' ? 'chip' : k.tone + '-soft'}); color: var(--${k.tone === 'muted' ? 'muted' : k.tone === 'brand' ? 'brand' : k.tone})` }, icon(k.icon, 20)),
      h('span', { class: 'grow' },
        h('span', { class: 't', style: 'font-size: 15px; line-height: 1.6', text: terms(n.title) }),
        n.body ? h('span', { class: 's', style: 'line-height: 1.6', text: terms(n.body) }) : null,
        h('span', { class: 's', style: 'font-size: 13px', text: `${k.label} · ${relTime(n.created_at)}` })),
      n.read_at ? null : h('span', { class: 'sr-only', text: 'غير مقروء' }),
      n.read_at ? null : h('span', { 'aria-hidden': 'true', style: 'width: 10px; height: 10px; border-radius: 5px; background: var(--brand); flex-shrink: 0' }));
    el.addEventListener('click', () => { if (!n.read_at) rpc('mark_notifications_read', { p_ids: [n.id] }).catch(() => {}); });
    return el;
  }

  drawTabs();
  load();
}
