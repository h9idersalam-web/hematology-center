#!/bin/bash
# تشغيل كل الاختبارات على قاعدة محلية نظيفة
P="psql -h /var/lib/pgtest -p 5499 -U postgres -q -v ON_ERROR_STOP=1"
$P -c "drop schema if exists public cascade; create schema public; grant all on schema public to postgres, public; drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists extensions cascade; drop role if exists anon; drop role if exists authenticated;" 2>/dev/null
$P -f tests/00_supabase_stub.sql && $P -f supabase/01_schema.sql 2>/dev/null && $P -f supabase/02_storage.sql 2>/dev/null && $P -f supabase/03_seed_protocols.sql && $P -f supabase/05_hardening.sql && $P -f supabase/06_patients_view.sql || exit 1
for f in tests/01_flow_test.sql tests/02_extra_test.sql tests/03_patients_test.sql; do
  psql -h /var/lib/pgtest -p 5499 -U postgres -f $f 2>&1 | grep -E '^(psql.*NOTICE:  )?[TEP][0-9]+|ERROR|DONE|FAIL' | sed 's/^psql:[^ ]* NOTICE:  //'
done
