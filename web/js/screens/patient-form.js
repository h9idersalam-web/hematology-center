// تسجيل مريض جديد أو تعديل بياناته
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, field, notice, toast, busy, latinDigits, arNorm, bsa, ageText, todayISO, confirmDialog, SEX } from '../ui.js';
import { state, go } from '../app.js';
import { can } from '../perms.js';

export const NKDA = 'لا توجد حساسية دوائية معروفة';

export async function render(root, params) {
  const id = params.get('id');
  const back = id ? '#/patient?id=' + id : '#/patients';

  if (!can('editPatient')) {
    mount(root, h('div', { class: 'screen' }, topbar({ title: id ? 'تعديل البيانات' : 'مريض جديد', back }),
      h('main', { class: 'main' }, notice('info', 'lock', h('p', { text: 'تسجيل المرضى وتعديل بياناتهم للأطباء (عدا الدوري) والصيادلة السريريين.' })))));
    return;
  }

  mount(root, h('div', { class: 'screen' }, topbar({ title: id ? 'تعديل البيانات' : 'مريض جديد', back }),
    h('main', { class: 'main' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })))));

  const [pt, specialists, notJoined] = await Promise.all([
    id ? q(sb.from('patients').select('*').eq('id', id).maybeSingle()) : Promise.resolve(null),
    q(sb.from('profiles').select('id, full_name').eq('role', 'specialist').eq('status', 'active').order('full_name')),
    // أطباء اختصاص أضافهم المدير بالاسم قبل انضمامهم (الملف 36)
    q(sb.from('pending_specialists').select('id, full_name').is('linked_at', null).is('archived_at', null).order('full_name')).catch(() => []),
  ]);
  if (id && !pt) throw new Error('المريض غير موجود');
  if (pt && pt.archived_at) throw new Error('ملف هذا المريض مؤرشف ولا يمكن تعديله');

  const v = pt || {};
  const name = h('input', { class: 'input', autocomplete: 'off', required: true, value: v.full_name || '', maxlength: 120 });
  const birth = h('input', { class: 'input', type: 'date', value: v.birth_date || '', max: todayISO(), min: '1900-01-01' });
  const phone = h('input', { class: 'input ltr', type: 'tel', inputmode: 'numeric', autocomplete: 'off', placeholder: '07XXXXXXXXX',
    value: v.phone || '', maxlength: 14, style: 'text-align: right' });
  const height = h('input', { class: 'input ltr', type: 'number', inputmode: 'decimal', min: 30, max: 250, step: '0.1', value: v.height_cm ?? '', style: 'text-align: right' });
  const weight = h('input', { class: 'input ltr', type: 'number', inputmode: 'decimal', min: 1, max: 300, step: '0.1', value: v.weight_kg ?? '', style: 'text-align: right' });
  const nkdaInit = v.allergies === NKDA;
  const allergies = h('textarea', { class: 'input', rows: 2, placeholder: 'مثال: Penicillin، Sulfa', maxlength: 500 });
  allergies.value = nkdaInit ? '' : (v.allergies || '');
  const nkda = h('input', { type: 'checkbox', checked: nkdaInit });
  allergies.disabled = nkdaInit;
  nkda.addEventListener('change', () => { allergies.disabled = nkda.checked; if (nkda.checked) allergies.value = ''; });

  let sex = v.sex || null;
  const sexBox = h('div', { class: 'grid-2', role: 'radiogroup', 'aria-label': 'الجنس' });
  const drawSex = () => sexBox.replaceChildren(...Object.entries(SEX).map(([k, label]) =>
    h('button', { type: 'button', class: 'choice', 'aria-pressed': sex === k ? 'true' : 'false', text: label,
      onclick: () => { sex = k; drawSex(); } })));
  drawSex();

  const defaultSp = v.specialist_id || v.pending_specialist_id || (state.profile.role === 'specialist' ? state.profile.id : '');
  const spSelect = h('select', { class: 'input' },
    h('option', { value: '', text: specialists.length || notJoined.length ? 'اختر الطبيب المختص' : 'لا يوجد طبيب اختصاص بعد' }),
    specialists.map((s) => h('option', { value: s.id, text: s.full_name, selected: s.id === defaultSp })),
    notJoined.map((s) => h('option', { value: s.id, text: s.full_name + ' (لم ينضم بعد)', selected: s.id === defaultSp })));

  const bsaOut = h('p', { class: 'hint', 'aria-live': 'polite' });
  const drawBsa = () => {
    const b = bsa(Number(height.value), Number(weight.value));
    bsaOut.textContent = b ? `مساحة سطح الجسم: ${b} م² (معادلة موستيلر)` : 'الطول والوزن مطلوبان قبل إنشاء خطة العلاج وحساب الجرعات الدوائية.';
  };
  height.addEventListener('input', drawBsa); weight.addEventListener('input', drawBsa); drawBsa();

  const ageOut = h('p', { class: 'hint' });
  const drawAge = () => { ageOut.textContent = birth.value ? 'العمر: ' + ageText(birth.value) : ''; };
  birth.addEventListener('input', drawAge); drawAge();

  const errBox = h('div');
  const submit = h('button', { class: 'btn primary block', type: 'submit', text: id ? 'حفظ التعديلات' : 'تسجيل المريض' });

  // حقول بإطار قرمزي ظاهر على الخلفية البيضاء (بطلب صاحب المشروع)
  const form = h('form', { novalidate: true, class: 'pf-form' },
    h('div', { class: 'card' },
      h('h2', { text: 'البيانات الشخصية' }),
      field('الاسم الكامل (الرباعي)', name),
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'الجنس' }), sexBox),
      h('div', { class: 'field' }, h('label', { for: birth.id = 'f-birth', text: 'تاريخ الميلاد' }), birth, ageOut),
      field('رقم هاتف المريض أو مرافقه', phone, 'يجب أن يكون الرقم عليه واتساب للتواصل معه. 11 رقماً يبدأ بـ 07')),
    h('div', { class: 'card' },
      h('h2', { text: 'القياسات' }),
      h('div', { class: 'grid-2' }, field('الطول (سم)', height), field('الوزن (كغ)', weight)),
      bsaOut,
      id ? notice('info', 'info', h('p', { text: 'تغيير الوزن أو الطول لا يغيّر الجرعات الدوائية لخطة العلاج الحالية تلقائياً. إعادة حساب الجرعات الدوائية تتم بطلب تعديل يوافق عليه الطبيب المختص.' })) : null),
    h('div', { class: 'card' },
      h('h2', { text: 'الحساسية الدوائية' }),
      h('label', { class: 'check' }, nkda, h('span', { text: NKDA })),
      field('الأدوية التي يتحسس منها', allergies)),
    h('div', { class: 'card' },
      h('h2', { text: 'الطبيب المختص' }),
      field('المسؤول عن قرارات العلاج والموافقات (إلزامي)', spSelect, 'وحده يوافق على خطة العلاج أو يرفضها، ويقرّر طلبات تعديل هذا المريض.')),
    errBox, submit);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(submit, async () => {
      errBox.replaceChildren();
      const data = collect();
      if (data.error) return showErr(data.error);

      if (!id) {
        const dup = await findSimilar(data.p_full_name);
        if (dup.length) {
          const ok = await confirmDialog({
            title: 'يوجد مريض باسم مشابه',
            body: dup.map((d) => `${d.full_name} (${d.file_no})`).join('، ') + '. تأكد أنه ليس المريض نفسه قبل إنشاء ملف جديد.',
            okText: 'تسجيل ملف جديد',
          });
          if (!ok) return;
        }
      }

      try {
        if (id) {
          await rpc('update_patient', { p_id: id, ...data });
          toast('حُفظت التعديلات');
          go('/patient?id=' + id);
        } else {
          const newId = await rpc('register_patient', data);
          const row = await q(sb.from('patients').select('file_no').eq('id', newId).single());
          toast(`سُجّل المريض · رقم الملف ${row.file_no}`);
          go('/patient?id=' + newId);
        }
      } catch (err) { showErr(err.message); }
    });
  });

  function showErr(msg) {
    errBox.replaceChildren(notice('err', 'warn', h('p', { text: msg })));
    errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function collect() {
    const full = name.value.replace(/\s+/g, ' ').trim();
    if (full.length < 3) return { error: 'اكتب اسم المريض الكامل' };
    if (full.split(' ').length < 2) return { error: 'اكتب الاسم مع اسم الأب على الأقل، لتمييز المرضى المتشابهين' };
    if (!sex) return { error: 'اختر جنس المريض' };
    if (!spSelect.value) return { error: 'اختر الطبيب المختص بالمريض' };
    if (birth.value && birth.value > todayISO()) return { error: 'تاريخ الميلاد في المستقبل' };
    const ph = latinDigits(phone.value).replace(/[\s-]/g, '').replace(/^\+?964/, '0');
    if (ph && !/^07\d{9}$/.test(ph)) return { error: 'رقم هاتف المريض أو مرافقه غير صحيح، اكتبه بصيغة 07XXXXXXXXX' };
    const hgt = height.value ? Number(latinDigits(height.value)) : null;
    const wgt = weight.value ? Number(latinDigits(weight.value)) : null;
    if (hgt !== null && !(hgt >= 30 && hgt <= 250)) return { error: 'الطول يجب أن يكون بين 30 و250 سم' };
    if (wgt !== null && !(wgt >= 1 && wgt <= 300)) return { error: 'الوزن يجب أن يكون بين 1 و300 كغ' };
    const al = nkda.checked ? NKDA : allergies.value.trim() || null;
    return {
      p_full_name: full, p_birth_date: birth.value || null, p_sex: sex,
      p_height_cm: hgt, p_weight_kg: wgt, p_phone: ph || null, p_allergies: al,
      p_specialist: spSelect.value || null,
    };
  }

  mount(root, h('div', { class: 'screen' },
    topbar({ title: id ? 'تعديل البيانات' : 'مريض جديد', sub: v.file_no || 'يُعطى رقم الملف تلقائياً', back }),
    h('main', { class: 'main' }, form)));
  if (!id) name.focus();
}

// مرضى بأسماء مشابهة: أول اسمين متطابقان بعد توحيد الكتابة
async function findSimilar(full) {
  const parts = arNorm(full).split(' ').slice(0, 2);
  let x = sb.from('patient_overview').select('full_name, file_no').is('archived_at', null);
  for (const p of parts) x = x.ilike('search_key', `%${p.replace(/[%_,()*\\]/g, '')}%`);
  try { return await q(x.limit(3)); } catch { return []; }
}
