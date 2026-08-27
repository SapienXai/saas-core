# Claimable restaurants

Claimable restaurants are platform-created restaurant pages that can receive reservation requests before a business has a Reservevia account. They use the same restaurant-to-workspace relationship as normal restaurants: the platform provisions an empty Free workspace first, creates the restaurant inside it, and a successful claim adds the verified business user as an owner of that existing workspace.

## Lifecycle

1. A `platform_owner` or `platform_admin` creates a restaurant manually or imports it from the Excel workflow.
2. The restaurant is published with `ownership_status = unclaimed` and a private business contact profile. Existing and self-service restaurants are backfilled or created as `claimed`.
3. The public `/r/[slug]` page shows only a safe claimable projection and never exposes the business contact address or private source metadata.
4. A reservation remains `pending`. The private business contact receives a core transactional notification with a reservation-management bearer link and a restaurant-specific claim link.
5. The business can accept or decline the individual reservation without an account. Accepting changes `pending` to `confirmed`; declining changes it to `cancelled`, and a guest outcome email is sent when a guest email exists.
6. A verified authenticated user can claim one restaurant. An exact verified match to the private business email is eligible immediately. A non-consumer official domain is eligible only when that domain matches exactly one unclaimed restaurant. Shared domains and other cases go to platform review.
7. Completion updates the existing workspace membership and private claim profile. The restaurant ID and `restaurants.workspace_id` never change, and the user is sent to the existing management experience.

## Platform operations

`/platform/restaurants` supports:

- manual creation with the minimum public and ownership fields;
- a server-side `.xlsx` template and upload/preview/confirm workflow;
- an explicit update mode for existing platform-created restaurants, matched by public slug first and unique private business email second;
- row-level validation, warnings, collision-safe slugs, duplicate business-email detection, and partial completion;
- claim/source filters and a restaurant detail page with private business contact data;
- inspection, approval, and rejection of manual-review claim requests.

Only `platform_owner` and `platform_admin` may create, import, or approve/reject claims. Support and auditor roles remain read-only. Every privileged mutation is recorded in `platform_audit_logs` without bearer tokens or guest contact data.

## Website assets

When an official website URL is available, Platform Control uses the existing server-side website importer to discover logo and banner candidates from Open Graph metadata, structured data, icons, and relevant page images. The selected first usable candidate is downloaded server-side, checked against supported image file signatures and size limits, then copied into the existing public `restaurant-assets` Storage bucket. Only the resulting Storage URL is written to `restaurants.logo_url` or `restaurants.primary_image_url`; the restaurant page never hotlinks an external website image.

Manual creation imports assets automatically after provisioning. Excel confirmation imports assets for each successfully created or updated restaurant after the row-level database operation completes. The same server-side crawl also fills fields that were blank in the workbook—description, cuisine, atmosphere, hours, location, phone/WhatsApp, menu/location/events links, social links, and (when safe and still empty) the private business contact email. Explicit Excel values always win, and existing logo/banner/profile values are never overwritten by this enrichment pass. Missing or blocked images are warnings and do not fail restaurant provisioning. Existing restaurants can be retried from their Platform restaurant detail page with `Import website images`. Operators should review the result and replace unsuitable assets through the normal restaurant profile controls after a business claims the restaurant.

Asset fetching is server-only and uses redirect limits, response-size limits, public-host checks, actual raster file signatures, and a short timeout. Macros, arbitrary client image URLs, private hosts, and unsupported image formats are not accepted. The official website is the only automatic source; Google Images and map-provider image scraping are not used.

## Privacy and token rules

Business contact fields live in `restaurant_claim_profiles`, not in the public restaurant projection. The import, claim, and reservation-management tables have no anonymous or ordinary authenticated read policy; server-side service-role access is required. Claim and reservation-management URLs contain random bearer values, while the database stores SHA-256 hashes only. Tokens expire, and reservation-management tokens are consumed after a successful state change.

Consumer email domains are never accepted as an official-domain ownership signal. A domain match is scoped to the explicitly selected restaurant and never grants ownership of a chain. Email possession alone does not bypass verified-email and exact-email/domain/manual-review rules.

## Import recovery

The upload creates a private import batch snapshot. Confirm re-reads that snapshot rather than trusting preview JSON. Create rows provision their workspace and restaurant atomically through the database RPC; update rows lock and modify their existing platform restaurant in place. A failed row is recorded without orphaning its workspace or rolling back successful rows. Repeating confirm is idempotent because completed rows are skipped.

For a failed or ambiguous import update, use the preview match column to correct the workbook slug/email and upload again. Update mode never matches ordinary self-service or legacy restaurants, never moves a restaurant to another workspace, and preserves blank cells. For a failed or ambiguous claim, platform staff should inspect the restaurant detail and claim request, verify the official business relationship through the existing operational process, then approve or reject with a reason. No raw token or secret should be copied into an audit note or support ticket.

## Deployment

Apply the additive migrations `20260813130000_claimable_restaurants.sql` and `20260813141006_platform_restaurant_import_updates.sql` before deploying the application code. Keep `SUPABASE_SERVICE_ROLE_KEY`, email provider credentials, and application URL configuration server-only. The existing email provider configuration is required for delivery; local development can inspect the generated messages through the repository's email preview and local mail tooling.
