# Core Lab

Core Lab is an internal verification application, not a product landing page.
It uses deterministic fixture labels and scenario outcomes for tenant
isolation, seats, invitations, billing lifecycle, entitlements, domains,
platform roles and usage. Expected authorization blocks are shown as `BLOCKED
AS EXPECTED`; unexpected behavior is `FAIL`.

Run it with `pnpm lab:dev`. Production deployments should not seed its fixtures
or expose its operator surface to customers.
