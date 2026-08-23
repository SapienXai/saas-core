# Workspaces

Workspace is the primary customer/account boundary. Every product-owned row
should carry or derive `workspace_id`. Users can belong to multiple workspaces;
the current workspace is a preference, never a permission grant. Every read and
write re-checks membership on the server.

Workspace lifecycle is `active`, `suspended`, or `archived`. Archiving should be
an audited owner/platform operation and should not delete product data.
