# Permissions

The default workspace roles are owner, admin, manager, member and viewer.
Permission checks use named capabilities such as `members:invite` and support
product-defined maps. Owner protection is enforced separately from the role
table: admins cannot administer owners and only an owner can archive a
workspace or manage billing.

Platform roles are separate from workspace roles. A support user can inspect a
workspace through a read-only support view but cannot mutate customer data.
