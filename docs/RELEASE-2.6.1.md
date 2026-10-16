# SaaS Core 2.6.1 release candidate (not published)

The tag saas-core-v2.6.1 was pushed, but its GitHub Actions release job failed
before starting any workflow step. A local packed-consumer proof then found
that the CLI-generated ProductConfig type omitted publicSitemapPaths, which the
managed sitemap route consumes.

No 2.6.1 packages were published to npm. Do not install or treat this tag as a
coordinated release. The corrected source and package release are tracked in
RELEASE-2.6.2.md.
