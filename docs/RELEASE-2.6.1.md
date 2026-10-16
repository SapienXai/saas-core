# SaaS Core 2.6.1

The coordinated runtime and package release is 2.6.1. The Core schema
compatibility coordinate remains 2.0. This patch release delivers the current
canonical billing and entitlement runtime sources to registry consumers.

## Changes

- Safely expire an unpaid, open Checkout Session before replacing its pending
  plan mutation. Session, Workspace, mutation, and environment bindings are
  verified before closure; completed or otherwise ambiguous sessions remain
  blocked for reconciliation.
- Normalize Stripe's incomplete_expired subscription status to the terminal
  Core expired state so a new Checkout can be attempted.
- Preserve the active entitlement limit until a scheduled downgrade reaches
  its effective timestamp, consistently across the TypeScript runtime and the
  already-delivered SQL contract.
- Add contract coverage for Checkout expiry, terminal-status handling, and
  scheduled-downgrade boundaries.

No new database migration is introduced. The CLI continues to deliver
migration source only and does not apply SQL. Existing payment records,
subscriptions, webhook receipts, and entitlement projections are unchanged by
package installation.

## Coordinated package versions

| Package | Version |
| --- | --- |
| @sapienx/saas-core | 2.6.1 |
| @sapienx/saas-core-config | 2.6.1 |
| @sapienx/saas-core-ui | 2.6.1 |
| @sapienx/saas-core-app | 2.6.1 |
| @sapienx/saas-core-cli | 2.6.1 |

## Compatibility and release boundary

The schema coordinate remains 2.0. Consumers should use the standard
ownership-aware Core update flow, review its managed-file diff, reinstall the
coordinated packages, and run their product checks. This release does not
change provider credentials, Stripe account configuration, prices, customer
subscriptions, or production data.

The tag and the release workflow are the publication authority. A local pack
or successful source check alone is not evidence that the registry contains
these artifacts.
