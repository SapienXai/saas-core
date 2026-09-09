# Consumer migration follow-ups

These checklists are the remaining work for the audited consumers. They are
separate from the Core packaging checkpoint. Each item must be completed in
the consumer's own checkout with a dry run, reviewable evidence, and an
explicit rollback plan.

## ReserveVia

- [ ] Start from the audited reference commit
  `92ffa98dd22e785d90959b292c341de1e57e6873` and record the migration commit;
  keep the checkout and production data changes separately reviewable.
- [ ] Run `saas-core doctor`, `diff`, and `update --dry-run`; inventory every
  managed conflict and resolve it before applying an update.
- [ ] Preserve provider customer IDs, subscription IDs, provider price IDs,
  event IDs, transaction history, current period dates, and effective
  entitlements. Reject conflicting backfills rather than overwriting history.
- [ ] Map legacy custom-data keys to the generic workspace, provider, and
  environment association; retain the original values for audit and recovery.
- [ ] Define the product plan and price catalog, comparison rows, recovery
  copy, and provider mappings in product-owned configuration. Keep restaurant,
  reservation, and history limits and usage metrics in product-owned writes.
- [ ] Route checkout, upgrade, deferred downgrade and undo, cancel/resume,
  payment recovery, webhook projection, reconciliation, and transition
  consumption through the managed Core paths.
- [ ] Run a sandbox lifecycle matrix covering free checkout, upgrade with
  preview/proration, scheduled downgrade, cancellation/resume, renewal,
  past-due grace and recovery, terminal state, and canceled-subscription
  replacement.
- [ ] Deliver duplicate, stale, equal-time, out-of-order, cross-environment,
  unexpected-price, and unknown-outcome webhook fixtures; show durable retry
  and reconcile behavior.
- [ ] Verify persistence lease/reclaim, mutation journal, and exactly-once
  transition consumption across duplicate requests and repeated browser
  callbacks.
- [ ] Capture recovery and rollback evidence for schema/data migration,
  managed-file update, package installation, and consumer relocation.
- [ ] Do not add a second provider client, webhook handler, checkout engine,
  entitlement projection, or competing transition journal.

## PlaceDJ

- [ ] Start from the audited reference commit
  `5fd2765bf3b36dd2be8e6c9105e40d410f4bc995` and record the migration commit;
  keep the existing product-owned working tree intact while preparing the
  change.
- [ ] Run `saas-core doctor`, `diff`, and `update --dry-run` against the
  manifest. Resolve managed conflicts explicitly and review the backup and
  rollback plan before applying anything.
- [ ] Preserve provider customer/subscription/price IDs, webhook event order,
  transaction history, period dates, and effective entitlements. Keep legacy
  custom-data values and map them to the generic workspace/environment
  association without destructive replacement.
- [ ] Define paid plans, prices, intervals, presentation copy, and provider
  mappings in product-owned catalog/configuration. Keep venue, device, music,
  catalog, and usage limits and counters in product-owned code.
- [ ] Move authorized domain writes to generic Core entitlement and usage
  assertions while retaining product tables, routes, styles, and migrations.
- [ ] Run the sandbox lifecycle matrix for checkout, upgrade, deferred
  downgrade/undo, cancel/resume, renewal, past-due recovery, terminal state,
  and canceled-subscription replacement.
- [ ] Deliver duplicate, stale, equal-time, out-of-order,
  cross-environment, unknown-price, and unknown-outcome webhook fixtures and
  verify durable retry/reconcile behavior.
- [ ] Verify persistence account/event uniqueness, lease/reclaim, mutation
  journal, transition consumption, and rollback after an injected update
  failure.
- [ ] Capture desktop/mobile plan and status UI evidence, then relocate the
  consumer and repeat install, typecheck, tests, and build checks.
- [ ] Do not add a second provider client, webhook handler, checkout engine,
  entitlement projection, or competing transition journal.

## Shared acceptance boundary

Both migrations must show that product-owned catalogs, styles, routes,
migrations, and domain files survive Core updates; modified managed files block
the update; and a failed apply restores the independent backup. Neither
checklist authorizes live payments, production mutations, deployment, push,
merge, secret changes, or edits to the other consumer.
