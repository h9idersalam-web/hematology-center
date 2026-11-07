# عيّنات تقارير تعداد دم بصيغ مختلفة، مع القيم الصحيحة لكل منها، لاختبار القراءة الآلية
import json, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
F = '/usr/share/fonts/truetype/'
fonts = {
    'sans': F + 'dejavu/DejaVuSans.ttf', 'mono': F + 'dejavu/DejaVuSansMono.ttf',
    'lib': F + 'liberation/LiberationSans-Regular.ttf', 'serif': F + 'liberation/LiberationSerif-Regular.ttf',
}

SAMPLES = [
    # 1. جهاز آلي (نمط Sysmex): وحدات 10^3/uL
    dict(name='analyzer', font='mono', size=24, lines=[
        'AL-AMAL LABORATORY            CBC REPORT',
        'Patient: XXXXX   Age: 45Y   Sex: M   Date: 05/11/2026',
        '',
        'Test          Result    Unit        Ref. Range',
        'WBC           7.85      10^3/uL     4.00 - 11.00',
        'NEUT#         5.12      10^3/uL     2.00 - 7.50',
        'LYMPH#        1.90      10^3/uL     1.00 - 4.00',
        'NEUT%         65.2      %           40.0 - 75.0',
        'RBC           4.21      10^6/uL     4.50 - 5.90',
        'HGB           12.4      g/dL        13.5 - 17.5',
        'HCT           37.9      %           41.0 - 53.0',
        'MCV           90.0      fL          80.0 - 100.0',
        'MCH           29.5      pg          27.0 - 33.0',
        'MCHC          32.7      g/dL        31.0 - 36.0',
        'PLT           245       10^3/uL     150 - 400',
        'MPV           9.8       fL          7.5 - 11.5',
    ], truth={'WBC': (7.85, 4.0, 11.0), 'ANC': (5.12, 2.0, 7.5), 'Hb': (12.4, 13.5, 17.5), 'PLT': (245, 150, 400)}),
    # 2. مختبر محلي: عدد خلايا بالمليمتر المكعب، والمرجع بين قوسين
    dict(name='cmm', font='lib', size=26, lines=[
        'مختبر الشفاء للتحليلات المرضية',
        'Complete Blood Picture',
        'Name: ............        Date: 06-11-2026',
        '',
        'Hemoglobin (Hb)            9.8  g/dl          (12 - 16)',
        'P.C.V                      29   %             (36 - 46)',
        'W.B.C                      3,200  /cmm        (4000 - 11000)',
        'Neutrophils                45  %',
        'Lymphocytes                48  %',
        'Platelets                  85,000  /cmm       (150000 - 450000)',
        'ESR                        40  mm/hr',
    ], truth={'WBC': (3.2, 4.0, 11.0), 'Hb': (9.8, 12, 16), 'PLT': (85, 150, 450)}),
    # 3. وحدات SI: الهيموغلوبين بالغرام/لتر
    dict(name='si', font='sans', size=24, lines=[
        'HAEMATOLOGY',
        'Investigation                    Result     Units        Reference',
        'Haemoglobin                      98         g/L          120 - 160',
        'Total Leucocyte Count            2.1        x10^9/L      4.0 - 11.0',
        'Absolute Neutrophil Count        0.8        x10^9/L      2.0 - 7.5',
        'Platelet Count                   34         x10^9/L      150 - 400',
        'Red Cell Count                   3.40       x10^12/L     4.5 - 5.5',
    ], truth={'WBC': (2.1, 4.0, 11.0), 'ANC': (0.8, 2.0, 7.5), 'Hb': (9.8, 12.0, 16.0), 'PLT': (34, 150, 400)}),
    # 4. صيغة مختصرة بلا مراجع وأسماء كاملة
    dict(name='plain', font='serif', size=28, lines=[
        'CBC',
        'White Blood Cells: 14.6 x10^9/L',
        'Neutrophils (absolute): 11.2 x10^9/L',
        'Hemoglobin: 10.1 g/dL',
        'MCHC: 31.8 g/dL',
        'Platelets: 512 x10^9/L',
    ], truth={'WBC': (14.6, None, None), 'ANC': (11.2, None, None), 'Hb': (10.1, None, None), 'PLT': (512, None, None)}),
]

def render(s):
    font = ImageFont.truetype(fonts[s['font']], s['size'])
    w, lh = 1100, int(s['size'] * 1.6)
    img = Image.new('L', (w, 60 + lh * len(s['lines'])), 255)
    d = ImageDraw.Draw(img)
    for i, line in enumerate(s['lines']):
        d.text((40, 30 + i * lh), line, font=font, fill=0)
    return img

def photo(img, seed):
    # محاكاة صورة هاتف: ميلان، تشويش، ضبابية خفيفة، إضاءة غير متساوية، دقة أقل
    r = random.Random(seed)
    img = img.convert('RGB').rotate(r.uniform(-2.5, 2.5), expand=True, fillcolor=(235, 232, 225), resample=Image.BICUBIC)
    img = img.resize((int(img.width * 0.75), int(img.height * 0.75)))
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    px = img.load()
    for y in range(img.height):
        shade = int(25 * y / img.height)
        for x in range(0, img.width):
            n = r.randint(-12, 12)
            c = px[x, y]
            px[x, y] = tuple(max(0, min(255, v - shade + n)) for v in c)
    return img

truth = {}
for k, s in enumerate(SAMPLES):
    base = render(s)
    base.save(f"{OUT}/{s['name']}-clean.png")
    photo(base, k).save(f"{OUT}/{s['name']}-photo.jpg", quality=80)
    truth[s['name']] = s['truth']
json.dump(truth, open(f'{OUT}/truth.json', 'w'), indent=1)
print('ok', list(truth))
