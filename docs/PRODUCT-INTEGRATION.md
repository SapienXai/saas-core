# Product integration

Products define their own entities, migrations, routes, UI and domain policies.
Register feature definitions and usage metrics in `defineSaaSCore()` and use
workspace membership plus a product scope adapter when finer-grained access is
required.

The Projects example demonstrates the intended shape without creating a Core
resource table:

```ts
type Project = { id: string; workspaceId: string; name: string }
```
