-- Run with psql -X -v ON_ERROR_STOP=1 against the intended database.
-- The results are aggregate counts only. Some rows can have multiple flags.
begin transaction isolation level repeatable read read only;

with candidates as (
  select subscription.*,
         coalesce(current_period_start_at, current_period_start::timestamp at time zone 'UTC') as period_start,
         coalesce(current_period_end_at, current_period_end::timestamp at time zone 'UTC') as period_end
    from public.workspace_subscriptions subscription
    join public.workspaces workspace on workspace.id = subscription.workspace_id
   where subscription.source in ('provider', 'paddle')
     and subscription.status in ('active', 'trialing', 'past_due')
     and workspace.status = 'active' and workspace.platform_status = 'active'
)
select coalesce(provider, '(missing)') as provider,
       coalesce(provider_environment, '(missing)') as environment,
       status,
       count(*) as candidate_rows,
       count(*) filter (where period_end is null) as missing_end,
       count(*) filter (where period_end <= now()) as expired_end,
       count(*) filter (where period_start > now()) as future_start,
       count(*) filter (where current_period_end_at is null and current_period_end is not null) as legacy_date_end,
       count(*) filter (where provider is null or provider not in ('stripe', 'paddle')
         or (source = 'paddle' and provider <> 'paddle')
         or provider_environment is null
         or nullif(btrim(provider_customer_id), '') is null
         or nullif(btrim(provider_subscription_id), '') is null
         or nullif(btrim(provider_price_id), '') is null) as incomplete_identity,
       count(*) filter (where not exists (
         select 1 from public.billing_provider_prices price
          where price.provider = candidates.provider and price.environment = candidates.provider_environment
            and price.provider_price_id = candidates.provider_price_id and price.active
       )) as missing_active_price
  from candidates
 group by 1, 2, 3
 order by 1, 2, 3;

commit;
