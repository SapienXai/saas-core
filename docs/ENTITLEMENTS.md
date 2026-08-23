# Entitlements

Plans are database-owned. Products register feature keys and metrics; Core only
resolves the catalog values. `canFeature`, `getLimit`, `getRemaining`,
`assertFeature` and `assertWithinLimit` are the stable pure helpers.

Manual overrides take precedence over scheduled and current subscription state.
Past-due subscriptions retain the purchased plan until grace expires; paused,
canceled and expired-grace states resolve to Free without deleting data.
