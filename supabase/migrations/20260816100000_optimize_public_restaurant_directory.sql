-- Keep public restaurant discovery on one database-side eligibility path.
-- Workspace plan limits still reserve the oldest restaurants first, while the
-- public directory only exposes published, active, reservation-enabled rows.

create index if not exists restaurants_workspace_created_idx
  on public.restaurants (workspace_id, created_at asc, id asc);

create or replace view public.public_restaurant_directory as
with ranked_restaurants as (
  select
    restaurant.id,
    restaurant.slug,
    restaurant.name,
    restaurant.logo_url,
    restaurant.primary_image_url,
    restaurant.description,
    restaurant.cuisine,
    restaurant.hours,
    restaurant.atmosphere,
    restaurant.phone,
    restaurant.whatsapp,
    restaurant.menu_url,
    restaurant.location_url,
    restaurant.events_url,
    restaurant.social_links,
    restaurant.profile_visibility,
    restaurant.location,
    restaurant.address_line1,
    restaurant.address_line2,
    restaurant.address_locality,
    restaurant.address_region,
    restaurant.address_postal_code,
    restaurant.address_country,
    restaurant.latitude,
    restaurant.longitude,
    restaurant.official_website_url,
    restaurant.timezone,
    restaurant.language,
    restaurant.status,
    restaurant.platform_status,
    restaurant.reservation_enabled,
    restaurant.reservation_start_date,
    coalesce(restaurant.updated_at, '1970-01-01 00:00:00+00'::timestamptz) as updated_at,
    restaurant.workspace_id,
    restaurant.created_at,
    coalesce(restaurant.discovery_has_banner, false) as discovery_has_banner,
    coalesce(restaurant.discovery_has_business_email, false) as discovery_has_business_email,
    coalesce(restaurant.discovery_score, 0) as discovery_score,
    row_number() over (
      partition by restaurant.workspace_id
      order by restaurant.created_at asc, restaurant.id asc
    ) as workspace_restaurant_position
  from public.restaurants as restaurant
),
with_effective_plan as (
  select
    ranked.*,
    workspace.platform_status as workspace_platform_status,
    plan.restaurant_limit,
    coalesce((plan.features ->> 'removeReserveviaBranding') = 'true', false) as remove_reservevia_branding
  from ranked_restaurants as ranked
  left join public.workspaces as workspace
    on workspace.id = ranked.workspace_id
  left join public.workspace_subscriptions as subscription
    on subscription.workspace_id = ranked.workspace_id
  left join lateral (
    select override.plan_key
    from public.subscription_overrides as override
    where override.workspace_id = subscription.workspace_id
      and override.revoked_at is null
      and override.effective_from <= now()
      and (override.effective_until is null or override.effective_until > now())
    order by override.effective_from desc
    limit 1
  ) as effective_override on true
  left join lateral (
    select subscription.scheduled_plan_key as plan_key
    where subscription.scheduled_plan_key is not null
      and subscription.scheduled_plan_at <= current_date
  ) as effective_scheduled on true
  left join public.plans as plan
    on plan.key = coalesce(effective_override.plan_key, effective_scheduled.plan_key, subscription.plan_key)
    and plan.active = true
)
select
  id,
  slug,
  name,
  logo_url,
  primary_image_url,
  description,
  cuisine,
  hours,
  atmosphere,
  phone,
  whatsapp,
  menu_url,
  location_url,
  events_url,
  social_links,
  profile_visibility,
  location,
  address_line1,
  address_line2,
  address_locality,
  address_region,
  address_postal_code,
  address_country,
  latitude,
  longitude,
  official_website_url,
  timezone,
  language,
  status,
  platform_status,
  reservation_enabled,
  reservation_start_date,
  updated_at,
  workspace_id,
  discovery_has_banner,
  discovery_has_business_email,
  discovery_score,
  remove_reservevia_branding
from with_effective_plan
where status = 'published'
  and platform_status = 'active'
  and reservation_enabled = true
  and (
    workspace_id is null
    or (
      workspace_platform_status = 'active'
      and restaurant_limit is not null
      and workspace_restaurant_position <= restaurant_limit
    )
  );

revoke all on public.public_restaurant_directory from anon, authenticated;
grant select on public.public_restaurant_directory to service_role;

create or replace function public.search_public_restaurants(
  p_query text default null,
  p_location text default null,
  p_cuisine text default null,
  p_atmosphere text default null,
  p_after jsonb default null,
  p_limit integer default 6
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
with cursor_values as (
  select
    case when jsonb_typeof(p_after) = 'object' and p_after ? 'banner' then (p_after ->> 'banner')::boolean end as banner,
    case when jsonb_typeof(p_after) = 'object' and p_after ? 'businessEmail' then (p_after ->> 'businessEmail')::boolean end as business_email,
    case when jsonb_typeof(p_after) = 'object' and p_after ? 'score' then (p_after ->> 'score')::integer end as score,
    case when jsonb_typeof(p_after) = 'object' and p_after ? 'updatedAt' then (p_after ->> 'updatedAt')::timestamptz end as updated_at,
    case when jsonb_typeof(p_after) = 'object' and p_after ? 'name' then p_after ->> 'name' end as name,
    case when jsonb_typeof(p_after) = 'object' and p_after ? 'id' then (p_after ->> 'id')::uuid end as id
),
matched as (
  select directory.*
  from public.public_restaurant_directory as directory
  where (
      nullif(btrim(p_query), '') is null
      or directory.name ilike '%' || p_query || '%'
      or directory.cuisine ilike '%' || p_query || '%'
      or directory.atmosphere ilike '%' || p_query || '%'
      or directory.location ilike '%' || p_query || '%'
    )
    and (nullif(btrim(p_location), '') is null or directory.location ilike '%' || p_location || '%')
    and (nullif(btrim(p_cuisine), '') is null or directory.cuisine ilike p_cuisine)
    and (nullif(btrim(p_atmosphere), '') is null or directory.atmosphere ilike '%' || p_atmosphere || '%')
),
filtered as (
  select matched.*
  from matched
  cross join cursor_values as cursor
  where (
      p_after is null
      or jsonb_typeof(p_after) <> 'object'
      or not (p_after ? 'id')
      or matched.discovery_has_banner < cursor.banner
      or (matched.discovery_has_banner = cursor.banner and matched.discovery_has_business_email < cursor.business_email)
      or (matched.discovery_has_banner = cursor.banner and matched.discovery_has_business_email = cursor.business_email and matched.discovery_score < cursor.score)
      or (matched.discovery_has_banner = cursor.banner and matched.discovery_has_business_email = cursor.business_email and matched.discovery_score = cursor.score and matched.updated_at < cursor.updated_at)
      or (matched.discovery_has_banner = cursor.banner and matched.discovery_has_business_email = cursor.business_email and matched.discovery_score = cursor.score and matched.updated_at = cursor.updated_at and matched.name > cursor.name)
      or (matched.discovery_has_banner = cursor.banner and matched.discovery_has_business_email = cursor.business_email and matched.discovery_score = cursor.score and matched.updated_at = cursor.updated_at and matched.name = cursor.name and matched.id > cursor.id)
    )
),
paged as (
  select filtered.*
  from filtered
  order by discovery_has_banner desc, discovery_has_business_email desc, discovery_score desc, updated_at desc, name asc, id asc
  limit least(greatest(coalesce(p_limit, 6), 1), 12) + 1
),
visible_page as (
  select paged.*
  from paged
  order by discovery_has_banner desc, discovery_has_business_email desc, discovery_score desc, updated_at desc, name asc, id asc
  limit least(greatest(coalesce(p_limit, 6), 1), 12)
)
select jsonb_build_object(
  'total', (select count(*) from matched),
  'hasMore', (select count(*) > least(greatest(coalesce(p_limit, 6), 1), 12) from paged),
  'rows', coalesce(
    (
      select jsonb_agg(to_jsonb(visible_page) order by discovery_has_banner desc, discovery_has_business_email desc, discovery_score desc, updated_at desc, name asc, id asc)
      from visible_page
    ),
    '[]'::jsonb
  )
);
$function$;

revoke all on function public.search_public_restaurants(text, text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.search_public_restaurants(text, text, text, text, jsonb, integer) to service_role;
