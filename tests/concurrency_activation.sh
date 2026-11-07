#!/bin/bash
# طلبان متزامنان بالكود نفسه: يجب أن ينجح واحد فقط (الملف 22). محلياً فقط، بعد run_all.
P="psql -h /var/lib/pgtest -p 5499 -U postgres -Atq -v ON_ERROR_STOP=1"
U='00000000-0000-0000-0000-000000000064'
$P -c "insert into auth.users(id, email, raw_user_meta_data) values ('$U', 'race@t', '{\"full_name\":\"سباق\",\"role\":\"nurse\"}') on conflict do nothing"
CODE=$($P -c "set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000039'; select (admin_issue_code('$U', 6, 72, 'nurse'))->>'code'" | tail -1)
call() { $P -c "begin; set local role authenticated; set local request.jwt.claim.sub = '$U'; select r->>'ok' || ' ' || coalesce(r->>'error', '') from (select activate_account('$CODE') as r) x; $1 commit;" | grep -E "^(true|false)" | head -1; }
# الأول يبقي المعاملة مفتوحة ثانيتين بعد الاستهلاك، والثاني يبدأ أثناءها
( call "select pg_sleep(2);" > /tmp/race_a.txt ) &
sleep 0.5
( call "" > /tmp/race_b.txt ) &
wait
A=$(cat /tmp/race_a.txt); B=$(cat /tmp/race_b.txt)
echo "C24 concurrent A: $A"
echo "C24 concurrent B: $B"
OK=$( (echo "$A"; echo "$B") | grep -c '^true')
echo "C25 exactly one success: $([ "$OK" = 1 ] && echo true || echo FAIL) · used rows: $($P -c "select count(*) from user_activation_codes where user_id = '$U' and used_at is not null")"
