# Custom domain setup

Reservevia currently accepts customer subdomains only, for example
`booking.felixsmile.com`. The customer DNS record is:

```text
Type:   CNAME
Host:   booking
Target: cname.reservevia.com
TTL:    Auto
```

`cname.reservevia.com` is not a magic Vercel value. Before enabling the
feature in an environment:

1. Add `cname.reservevia.com` to the Reservevia Vercel project without force
   reassignment.
2. In the DNS provider for `reservevia.com`, point `cname` to the exact Vercel
   target shown by the project domain inspection screen.
3. Verify the alias resolves correctly, then set the server-only variable
   `RESERVEVIA_CUSTOM_DOMAIN_TARGET=cname.reservevia.com`.
4. Redeploy the project so the server runtime receives the new environment
   variable.

Until that variable is present and valid, the application does not show a
customer-facing CNAME target and does not allow a new domain to be connected.
This prevents users from copying a DNS record that has not been backed by
Reservevia DNS yet.

The customer hostname is added to the configured Vercel project first, then
the server persists the normalized mapping in `restaurant_domains`. Public
requests resolve the exact hostname through that table and are served only
when the restaurant, workspace, entitlement, provider verification, and DNS
state are all valid.
