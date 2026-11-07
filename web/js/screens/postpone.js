// نافذة تأجيل جلسة: التاريخ الجديد والسبب. تُزاح الجلسات التالية بالفرق نفسه.
import { rpc } from '../api.js';
import { h, field, notice, fmtDate, todayISO, addDaysISO, toast, count } from '../ui.js';

const REASONS = ['نقص العدلات', 'نقص الصفيحات', 'عدوى أو حمى', 'ارتفاع إنزيمات الكبد', 'طلب المريض', 'عدم توفر الدواء'];

export function postponeDialog(cycle) {
  return new Promise((resolve) => {
    const dlg = h('dialog', null);
    const minDate = cycle.planned_date > todayISO() ? addDaysISO(cycle.planned_date, 1) : todayISO();
    const date = h('input', { class: 'input', type: 'date', min: minDate, value: addDaysISO(cycle.planned_date < todayISO() ? todayISO() : cycle.planned_date, 7) });
    const reason = h('textarea', { class: 'input', rows: 2, placeholder: 'اكتب السبب أو اختر من الأسباب الشائعة' });
    const chips = h('div', { style: 'display: flex; flex-wrap: wrap; gap: 6px' },
      REASONS.map((r) => h('button', { type: 'button', class: 'pill muted', style: 'border: 0; padding: 6px 12px; font-size: 14px',
        text: r, onclick: () => { reason.value = r; reason.focus(); } })));
    const shift = h('p', { class: 'hint', 'aria-live': 'polite' });
    const err = h('div');
    const drawShift = () => {
      const days = date.value ? Math.round((new Date(date.value) - new Date(cycle.planned_date)) / 86400000) : 0;
      shift.textContent = days > 0 ? `تأجيل ${count(days, 'day')}. تُزاح مواعيد الجرعات التالية بالمدة نفسها.` : '';
    };
    date.addEventListener('input', drawShift); drawShift();

    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    const ok = h('button', { type: 'button', class: 'btn primary', text: 'تأجيل' });
    ok.addEventListener('click', async () => {
      err.replaceChildren();
      if (!date.value || date.value <= cycle.planned_date) return err.replaceChildren(notice('err', 'warn', h('p', { text: 'اختر تاريخاً بعد الموعد الحالي' })));
      if (date.value < todayISO()) return err.replaceChildren(notice('err', 'warn', h('p', { text: 'لا يمكن التأجيل إلى تاريخ مضى' })));
      if (!reason.value.trim()) return err.replaceChildren(notice('err', 'warn', h('p', { text: 'اكتب سبب التأجيل' })));
      ok.disabled = true;
      try {
        await rpc('postpone_cycle', { p_cycle: cycle.id, p_new_date: date.value, p_reason: reason.value.trim() });
        toast(`أُجّلت الجرعة ${cycle.cycle_no} إلى ${fmtDate(date.value)}`);
        done(true);
      } catch (e) { ok.disabled = false; err.replaceChildren(notice('err', 'warn', h('p', { text: e.message }))); }
    });

    dlg.append(h('div', { class: 'dlg' },
      h('h2', { text: `تأجيل الجرعة ${cycle.cycle_no}` }),
      h('p', { style: 'color: var(--muted)', text: `${cycle.patient_name ? cycle.patient_name + ' · ' : ''}الموعد الحالي ${fmtDate(cycle.planned_date)}` }),
      field('الموعد الجديد', date), shift,
      field('سبب التأجيل', reason), chips, err,
      h('div', { class: 'grid-2' },
        h('button', { type: 'button', class: 'btn secondary', onclick: () => done(false), text: 'إلغاء' }), ok)));
    document.body.append(dlg);
    dlg.addEventListener('cancel', () => done(false));
    dlg.showModal();
  });
}
