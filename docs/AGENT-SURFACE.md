# Agent Surface

Agent Surface is the generic infrastructure that makes a SaaS Core consumer
ready to expose page capabilities to browser agents. It does not expose any
product capability by itself.

Agent Surface is included in the current `2.2.0` Core runtime/package release.
Core schema compatibility coordinate remains `2.0`. The release carries the
additive, Core-managed source
`supabase/migrations/20260909094344_reusable_billing_persistence.sql`; Agent
Surface itself has no schema-specific SQL. Package packing and CLI
`init`/`update` deliver the source but never execute SQL, and each consumer
owns its controlled apply and verification.

The boundary is deliberately small:

```text
Product capability
        |
        v
AgentToolDefinition[]
        |
        v
CoreWebMcpTools
        |
        v
document.modelContext.registerTool()
```

WebMCP is a browser/page transport. MCP is a separate protocol for future
remote or server transports. This version implements only the WebMCP adapter;
it does not add an MCP server, client, discovery service, registry, SSE,
Streamable HTTP, or OAuth flow.

## Ownership

Core owns the contract, validation, browser feature detection, registration
lifecycle, cancellation forwarding, conservative annotations, generic
confirmation boundary, and same-origin helper.

Products own tool names, descriptions, schemas, page placement, domain
execution, authentication, Workspace authorization, and decisions about
whether returned data is untrusted. Product routes remain the owners of any
HTTP endpoint used by a tool. Core has no universal agent endpoint and no
automatic product tool registry.

A fresh consumer therefore has the infrastructure available and zero
registered tools. A product opts in on the page where its capability makes
sense:

```tsx
<CoreWebMcpTools tools={tools} />
```

The component renders no UI and does not register tools when
`document.modelContext` is unavailable.

## Tool contract

Define a capability once with one canonical JSON Schema input contract:

```ts
import { defineAgentTool } from "@sapienx/saas-core"

const tools = [
  defineAgentTool({
    name: "search_projects",
    title: "Search projects",
    description: "Find projects visible in the current Workspace.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    kind: "read",
    returnsUntrustedContent: true,
    requiresConfirmation: false,
    execute: async (input, { signal }) => {
      // Product-owned, authenticated and Workspace-authorized operation.
      return searchProjects(input, signal)
    },
  }),
]
```

Every definition must explicitly provide a non-empty name and description,
valid JSON Schema input, `read` or `mutation` kind, both boolean security
declarations, and an execute function. Tool names must be unique in one
registration scope. Validation fails before registration; it does not silently
drop malformed capabilities.

`returnsUntrustedContent` is intentionally explicit. Core does not infer
trust from a type or from the tool name. Use `true` for user-generated or
externally sourced data and handle that data as untrusted in the consuming
agent.

`kind: "read"` maps to the standard WebMCP annotation
`readOnlyHint: true`; mutations map to `false`. The explicit untrusted flag
maps to `untrustedContentHint`. Core does not invent additional WebMCP
annotations.

## Confirmation and cancellation

Tools with `requiresConfirmation: true` pass through Core’s confirmation
boundary before `execute()` is called. The default confirmation uses a
browser-native confirmation prompt with static text. A product can provide a
custom confirmation function for its own UI, but the function receives tool
metadata only. It must not derive confirmation copy from model-controlled
input, and tool input cannot contain a confirmation bypass field.

Rejected confirmation returns the normalized result:

```ts
{
  ok: false,
  error: {
    code: "confirmation_rejected",
    message: "The action was not confirmed.",
    retryable: false,
  },
}
```

The product execute function is never called in that case. If confirmation is
unavailable, Core fails closed with `confirmation_unavailable`.

WebMCP supplies an `AbortSignal` to execute. Core forwards that exact signal
to the product as `{ signal }`; product fetches and other cancellable work can
use it directly. Unmounting the page aborts the registration signal, which
removes the page’s tools according to the WebMCP lifecycle. In-flight product
abort errors are not swallowed.

The adapter registers sequentially, reserves names per page context, and
releases the reservations during cleanup. React re-renders therefore do not
leave duplicate registrations or stale page tools. Keep the product’s tool
array and callbacks stable where practical; dependency changes still produce
a clean dispose/register cycle.

## Browser and server boundaries

The adapter is client-only. It reads `document.modelContext` only inside a
client-side feature-detection function and never reads `document`, `window`,
or `navigator` during server rendering. Unsupported browsers continue normal
application behavior without a polyfill, fake API, hydration error, or
console error.

The server helper is:

```ts
import { isSameOriginAgentRequest } from "@/lib/agent-surface/server"
```

It is intended for product-owned agent HTTP endpoints. It validates the
existing trusted request-host boundary and fails closed for:

- foreign or malformed `Origin` values;
- `Sec-Fetch-Site` values other than `same-origin` when present;
- foreign or malformed `Referer` values;
- context-free requests without a trustworthy browser same-origin signal.

It accepts a matching `Origin`, a matching `Referer` fallback, or an explicit
`Sec-Fetch-Site: same-origin` fallback. This check is only a browser
same-origin boundary. It is not authentication and it is not Workspace
authorization. Product endpoints must enforce the authenticated user,
Workspace membership, role, entitlement, input validation, and domain policy
independently.

The helper does not create `/api/agent`, `/api/webmcp`, or `/api/mcp` in Core.
It also does not expose service-role credentials, provider credentials, or
internal configuration to client code.

## Security headers and permissions

The current Core Next configuration does not set `document.domain`, does not
send `Origin-Agent-Cluster: ?0`, and does not disable the WebMCP `tools`
Permissions Policy. The browser standard defaults that policy to `self`, which
supports top-level and same-origin page use while keeping cross-origin iframe
registration disabled unless explicitly delegated by the embedding page.

Core does not weaken CSP, frame policy, cookies, or SameSite behavior to enable
WebMCP. Cross-origin exposure is not enabled by the Core adapter.

## Observability

The adapter accepts an optional no-op-by-default observer for these metadata-
only events:

```text
tool_registered
tool_registration_failed
tool_execution_started
tool_execution_succeeded
tool_execution_failed
tool_cancelled
tool_confirmation_rejected
```

Events contain the tool name, status, error category, and duration where
useful. Core never serializes full tool arguments by default. There is no
database-backed agent log or analytics table.

Unexpected product execution errors are converted to the safe normalized
`execution_failed` result before they reach the browser agent. Abort errors
remain cancellation signals so product code can observe and handle its
`AbortSignal`; Core does not turn an in-flight cancellation into a successful
result.

## Lifecycle and upgrades

Agent Surface browser files and
`supabase/migrations/20260909094344_reusable_billing_persistence.sql` are
Core-managed template files. The normal manifest/update lifecycle delivers
them to existing consumers, preserves product-owned paths including
`supabase/migrations/product/**`, and retains conflict and rollback
protections. The CLI delivers source and metadata only; consumers apply and
verify the migration through their own database process while the schema
compatibility coordinate remains `2.0`.

```bash
node packages/cli/bin/saas-core.mjs diff ../product --source . --json
node packages/cli/bin/saas-core.mjs update ../product --source . --dry-run --json
```

The dry run should show only new or changed Core-managed files and any normal
Core package metadata, including the billing migration source when the
consumer does not have it. It must not overwrite product configuration, product
routes, product capabilities, product styles, or product migrations. A same-
path consumer file at the Core migration path is a conflict and blocks the
update before mutation; a failed update restores metadata and removes newly
added Core files.

Portable pack/fresh-consumer checks must continue to show no checkout paths,
`file:` dependencies, temporary tarball paths, or local registry URLs. A
fresh consumer must typecheck and build with no product tools registered.

## Standard status

WebMCP is a progressive enhancement and an evolving browser proposal. The
adapter targets the current imperative API, `document.modelContext`, with
feature detection. It does not use the deprecated `navigator.modelContext`,
does not require experimental browser flags in normal CI, and does not treat a
normal Chromium browser without the API as a failed application state.

For the current browser contract, see the [Chrome Imperative API
documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api) and
[WebMCP security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools).
