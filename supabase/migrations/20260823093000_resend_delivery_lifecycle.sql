-- Extend the existing delivery webhook function for Resend complaint and
-- suppression events without changing the immutable DataEngine migrations.
create or replace function public.apply_email_delivery_webhook(
  target_provider_event_id text,
  target_provider_message_id text,
  target_event_type text,
  target_event_at timestamptz,
  target_error text,
  target_pause_booking boolean,
  target_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.email_delivery_events%rowtype;
  incoming_status text;
  current_rank integer;
  incoming_rank integer;
begin
  insert into public.email_provider_webhook_events (provider_event_id, provider_message_id, event_type, event_at, payload)
  values (target_provider_event_id, target_provider_message_id, target_event_type, target_event_at, coalesce(target_payload, '{}'::jsonb))
  on conflict (provider_event_id) do nothing;

  incoming_status := case target_event_type
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.failed' then 'failed'
    when 'email.complained' then 'failed'
    when 'email.suppressed' then 'failed'
    else null
  end;
  if incoming_status is null then return true; end if;

  select * into event_row
    from public.email_delivery_events
   where provider = 'resend'
     and provider_message_id = target_provider_message_id
   for update;
  if event_row.id is null then return true; end if;

  current_rank := case event_row.status
    when 'bounced' then 50
    when 'failed' then 40
    when 'delivered' then 30
    when 'sent' then 20
    else 10
  end;
  incoming_rank := case incoming_status
    when 'bounced' then 50
    when 'failed' then 40
    when 'delivered' then 30
    else 20
  end;
  if incoming_rank >= current_rank then
    update public.email_delivery_events
       set status = incoming_status,
           delivered_at = case when incoming_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
           failed_at = case when incoming_status in ('failed', 'bounced') then coalesce(failed_at, now()) else failed_at end,
           last_error = case when incoming_status in ('failed', 'bounced') then left(coalesce(target_error, incoming_status), 2000) else last_error end,
           last_provider_event_at = coalesce(target_event_at, now()),
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_provider_event', target_event_type)
     where id = event_row.id;
  end if;

  if target_pause_booking and incoming_status in ('failed', 'bounced') then
    update public.restaurant_claim_profiles
       set business_email_delivery_status = 'hard_bounce',
           business_email_last_error = left(coalesce(target_error, incoming_status), 2000),
           business_email_paused_at = coalesce(business_email_paused_at, now()),
           updated_at = now()
     where restaurant_id = event_row.restaurant_id
       and source = 'dataengine'
       and ownership_status in ('unclaimed', 'claim_pending');
  end if;
  return true;
end;
$$;

revoke all on function public.apply_email_delivery_webhook(text, text, text, timestamptz, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.apply_email_delivery_webhook(text, text, text, timestamptz, text, boolean, jsonb) to service_role;

notify pgrst, 'reload schema';
