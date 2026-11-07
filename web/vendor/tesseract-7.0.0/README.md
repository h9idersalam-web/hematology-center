# Tesseract.js 7.0.0 (قراءة صور التحاليل داخل الجهاز)

- `tesseract.min.js`, `worker.min.js`: من الحزمة `tesseract.js@7.0.0` (Apache-2.0)
- `core/*-lstm.wasm.js`: من `tesseract.js-core@7.0.0` (Apache-2.0)؛ يختار العامل النسخة المناسبة لدعم الجهاز
- `lang/eng.traineddata.gz`: من `@tesseract.js-data/eng@1.0.0` (النسخة 4.0.0_best_int)، نموذج Tesseract الإنجليزي (Apache-2.0)

تُحمَّل عند أول قراءة فقط، وتُحفظ بعدها في الجهاز. الصورة لا تغادر الهاتف.
