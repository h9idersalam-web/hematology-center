import json, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.argv = [sys.argv[0], sys.argv[1]] + sys.argv[2:]
OUT = sys.argv[1]
exec(open(sys.argv[2]).read().split('def render')[0].split("OUT = sys.argv[1]")[1])  # الخطوط والعيّنات
SAMPLES.append(dict(name='flags', font='lib', size=24, lines=[
    'Parameter        Result  Flag   Units      Normal Range',
    'WBC              2.4     L      x10^9/L    4.0 - 11.0',
    'Neutrophils %    30.5    L      %          40 - 75',
    'Hemoglobin       8.6     L      g/dL       12.0 - 16.0',
    'MCH              27.1           pg         27 - 33',
    'Platelets        612     H      x10^9/L    150 - 450',
], truth={'WBC': (2.4, 4.0, 11.0), 'Hb': (8.6, 12.0, 16.0), 'PLT': (612, 150, 450), 'ANC': (0.73, None, None)}))
def render(s):
    font = ImageFont.truetype(fonts[s['font']], s['size']); lh = int(s['size'] * 1.6)
    img = Image.new('L', (1100, 60 + lh * len(s['lines'])), 255); d = ImageDraw.Draw(img)
    for i, line in enumerate(s['lines']): d.text((40, 30 + i * lh), line, font=font, fill=0)
    return img
def harsh(img, seed, level):
    r = random.Random(seed * 7 + level)
    img = img.convert('RGB').rotate(r.uniform(-5, 5), expand=True, fillcolor=(220, 215, 205), resample=Image.BICUBIC)
    f = [1.0, 0.85, 0.7][level]; img = img.resize((int(img.width * f), int(img.height * f)))
    img = img.filter(ImageFilter.GaussianBlur([1.0, 1.2, 1.4][level]))
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            sh = int(60 * x / img.width) if level else 0
            n = r.randint(-20, 20); c = px[x, y]
            px[x, y] = tuple(max(0, min(255, v - sh + n)) for v in c)
    return img
truth = {}
for k, s in enumerate(SAMPLES):
    base = render(s)
    for lv in range(3): harsh(base, k, lv).save(f"{OUT}/{s['name']}{lv}-photo.jpg", quality=60)
    truth[s['name'] + '0'] = truth[s['name'] + '1'] = truth[s['name'] + '2'] = s['truth']
json.dump(truth, open(f'{OUT}/truth.json', 'w'))
print('ok')
