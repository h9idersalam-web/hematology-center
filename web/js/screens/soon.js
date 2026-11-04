// أقسام تُبنى في الخطوات القادمة
import { h, mount, topbar, bottomNav, icon } from '../ui.js';

const INFO = {
  patients: ['المرضى', 'قائمة المرضى وتسجيل مريض جديد وملف المريض', 'الخطوة 3'],
  appointments: ['المواعيد', 'جلسات اليوم والأسبوع والجرعات المتأخرة', 'الخطوة 3'],
  protocols: ['البروتوكولات', 'مكتبة البروتوكولات واعتمادها', 'الخطوة 4'],
};

export function render(id) {
  return (root) => {
    const [title, desc, step] = INFO[id];
    mount(root, h('div', { class: 'screen' },
      topbar({ title, back: '#/home' }),
      h('main', { class: 'main with-nav' },
        h('div', { class: 'empty', style: 'padding-top: 60px' },
          icon('clock', 40, '#8A929C'),
          h('p', { style: 'font-size: 18px; font-weight: 700; color: var(--ink)', text: 'يُبنى في ' + step }),
          h('p', { text: desc }))),
      bottomNav(id)));
  };
}
