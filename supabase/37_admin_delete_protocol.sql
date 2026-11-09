-- =====================================================================
-- 37: مدير البرنامج يحذف بروتوكولاً نهائياً (بطلب صاحب المشروع 2026/11/9)، حتى من المؤرشفة.
--   - للمدير وحده، مع سبب إلزامي.
--   - يُرفض إن استُخدم البروتوكول في أي خطة علاج (قائمة أو منتهية أو مرفوضة) حفاظاً على سجل المرضى.
--   - يُحفظ نص البروتوكول وأدويته كاملاً في سجل التعديلات (audit_log) مع السبب، فيمكن استرجاعه عند الحاجة.
--   - استثناء محصور من منع الحذف: forbid_delete يسمح فقط داخل هذه الدالة (إعداد مؤقت للمعاملة نفسها).
-- =====================================================================

create or replace function public.forbid_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name in ('protocols', 'protocol_drugs') and current_setting('hc.allow_protocol_delete', true) = 'on' then
    return old;
  end if;
  raise exception 'الحذف غير مسموح، استخدم الأرشفة مع ذكر السبب';
end $$;

create or replace function public.admin_delete_protocol(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_p protocols; v_n int; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform _require_admin();
  if v_reason is null then raise exception 'اكتب سبب الحذف'; end if;
  select * into v_p from protocols where id = p_id;
  if v_p.id is null then raise exception 'البروتوكول غير موجود'; end if;
  select count(*) into v_n from treatments where protocol_id = p_id;
  if v_n > 0 then
    raise exception 'استُخدم هذا البروتوكول في % خطة علاج، فلا يُحذف حفاظاً على سجل المرضى. اتركه مؤرشفاً.', v_n;
  end if;
  insert into audit_log(actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), my_role(), 'PROTOCOL_DELETED', 'protocols', p_id::text,
          to_jsonb(v_p) || jsonb_build_object('drugs', (select coalesce(jsonb_agg(to_jsonb(d) order by d.sort), '[]'::jsonb) from protocol_drugs d where d.protocol_id = p_id)),
          jsonb_build_object('reason', v_reason));
  perform set_config('hc.allow_protocol_delete', 'on', true);
  delete from protocol_drugs where protocol_id = p_id;
  delete from protocols where id = p_id;
  perform set_config('hc.allow_protocol_delete', 'off', true);
end $$;
revoke all on function public.admin_delete_protocol(uuid, text) from public, anon;
grant execute on function public.admin_delete_protocol(uuid, text) to authenticated;
