# قياس دقة القراءة الآلية لتعداد الدم

العيّنات مصطنعة بقيم معروفة (لا بيانات مرضى). المقياس الأهم: **silent wrong = 0**
(قيمة خاطئة لم تُعلَّم «غير مؤكدة»). يجب أن يبقى صفراً بعد أي تعديل على `web/js/ocr-labs.js`.

```bash
mkdir -p /tmp/ocr && cd /tmp/ocr && npm init -y && npm i tesseract.js@7.0.0 @tesseract.js-data/eng@1.0.0
python3 -I tests/lab-ocr/make_samples.py ./samples                                 # 4 صيغ × (نظيفة + صورة هاتف)
python3 -I tests/lab-ocr/make_photos.py ./real tests/lab-ocr/make_samples.py       # 5 صيغ × 3 مستويات تشويه أشد
cd /tmp/ocr && node <repo>/tests/lab-ocr/eval.mjs <dir> <repo>/web/js/ocr-labs.js   # يحتاج ImageMagick
```
آخر قياس (7 تشرين الثاني 2026): العيّنات 30/30 صحيحة (20 «واضحة» و10 «للتدقيق»)،
والصور المشوّهة (make_photos) 20/57، والمشوّهة جداً 13/57، و**0 خطأ صامت** في كل المجموعات (144 قيمة).
