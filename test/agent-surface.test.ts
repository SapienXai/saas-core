import { afterEach, describe, expect, it, vi } from "vitest"
import { defineAgentTool, type AgentToolDefinition } from "../packages/core/src/index"
import { isSameOriginAgentRequest } from "../lib/agent-surface/server"
import { registerWebMcpTools } from "../lib/agent-surface/webmcp"

type StubTool = {
  name: string
  title?: string
  description: string
  inputSchema: object
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
  execute(input: unknown, client?: { signal?: AbortSignal }): Promise<unknown>
}

function tool(overrides: Partial<AgentToolDefinition> = {}): AgentToolDefinition {
  return defineAgentTool({
    name: "read_projects",
    description: "Read the projects visible on the current page.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    kind: "read",
    returnsUntrustedContent: true,
    requiresConfirmation: false,
    execute: async () => ({ projects: [] }),
    ...overrides,
  })
}

function modelContext() {
  const calls: Array<{ tool: StubTool; options?: { signal?: AbortSignal } }> = []
  const context = {
    calls,
    registerTool(registeredTool: StubTool, options?: { signal?: AbortSignal }) {
      calls.push({ tool: registeredTool, options })
    },
  }
  vi.stubGlobal("document", { modelContext: context })
  return context
}

function request(headers: Record<string, string> = {}, url = "https://app.example.test/api/agent") {
  return new Request(url, { method: "POST", headers: { host: "app.example.test", ...headers } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Agent Surface contract", () => {
  it("rejects missing explicit metadata and malformed input schemas", () => {
    expect(() => defineAgentTool({
      ...tool(),
      returnsUntrustedContent: undefined,
    } as unknown as AgentToolDefinition)).toThrow("returnsUntrustedContent")
    expect(() => defineAgentTool({
      ...tool(),
      inputSchema: { type: 42 },
    } as unknown as AgentToolDefinition)).toThrow("inputSchema.type")
  })

  it("does not register duplicate names", () => {
    const context = modelContext()
    expect(() => registerWebMcpTools([tool(), tool({ name: "read_projects" })])).toThrow("Duplicate agent tool name")
    expect(context.calls).toHaveLength(0)
  })
})

describe("WebMCP adapter", () => {
  it("is a safe no-op when document.modelContext is unavailable", async () => {
    const registration = registerWebMcpTools([tool()])
    await registration.ready
    registration.dispose()
  })

  it("registers once with current annotations and aborts on cleanup", async () => {
    const context = modelContext()
    const registration = registerWebMcpTools([
      tool(),
      tool({ name: "update_project", kind: "mutation", returnsUntrustedContent: false, requiresConfirmation: true }),
    ])
    await registration.ready

    expect(context.calls).toHaveLength(2)
    expect(context.calls[0].tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true })
    expect(context.calls[1].tool.annotations).toEqual({ readOnlyHint: false, untrustedContentHint: false })
    expect(context.calls[0].options?.signal?.aborted).toBe(false)
    registration.dispose()
    expect(context.calls[0].options?.signal?.aborted).toBe(true)
    expect(context.calls[1].options?.signal?.aborted).toBe(true)
  })

  it("prevents duplicate registrations in one model context", async () => {
    modelContext()
    const first = registerWebMcpTools([tool({ name: "read_projects" })])
    await first.ready
    expect(() => registerWebMcpTools([tool({ name: "read_projects" })])).toThrow("already registered")
    first.dispose()
    const second = registerWebMcpTools([tool({ name: "read_projects" })])
    await second.ready
    second.dispose()
  })

  it("forwards the WebMCP execution signal to product code", async () => {
    const context = modelContext()
    let receivedSignal: AbortSignal | undefined
    const registration = registerWebMcpTools([tool({ execute: async (_input, { signal }) => { receivedSignal = signal; return "ok" } })])
    await registration.ready
    const controller = new AbortController()
    await context.calls[0].tool.execute({}, { signal: controller.signal })
    expect(receivedSignal).toBe(controller.signal)
    registration.dispose()
  })

  it("requires confirmation before a mutation and cannot be spoofed by input", async () => {
    const context = modelContext()
    let executeCount = 0
    let confirmationInput: object | null = null
    const registration = registerWebMcpTools([tool({
      name: "update_project",
      kind: "mutation",
      requiresConfirmation: true,
      execute: async () => { executeCount += 1; return "changed" },
    })], {
      confirmMutation: (metadata) => {
        confirmationInput = metadata
        return false
      },
    })
    await registration.ready

    const result = await context.calls[0].tool.execute({ approved: true }, { signal: new AbortController().signal })
    expect(result).toEqual({ ok: false, error: { code: "confirmation_rejected", message: "The action was not confirmed.", retryable: false } })
    expect(executeCount).toBe(0)
    expect(confirmationInput).not.toHaveProperty("approved")
    registration.dispose()
  })

  it("executes an approved mutation exactly once", async () => {
    const context = modelContext()
    let executeCount = 0
    const registration = registerWebMcpTools([tool({
      name: "update_project",
      kind: "mutation",
      requiresConfirmation: true,
      execute: async () => { executeCount += 1; return "changed" },
    })], { confirmMutation: () => true })
    await registration.ready
    await expect(context.calls[0].tool.execute({})).resolves.toBe("changed")
    expect(executeCount).toBe(1)
    registration.dispose()
  })

  it("does not expose product execution errors to the agent", async () => {
    const context = modelContext()
    const registration = registerWebMcpTools([tool({ execute: async () => { throw new Error("database secret") } })])
    await registration.ready
    await expect(context.calls[0].tool.execute({})).resolves.toEqual({
      ok: false,
      error: { code: "execution_failed", message: "The tool could not be completed." },
    })
    registration.dispose()
  })
})

describe("same-origin agent endpoint boundary", () => {
  it("accepts a matching Origin and rejects foreign or malformed origins", () => {
    expect(isSameOriginAgentRequest(request({ origin: "https://app.example.test" }))).toBe(true)
    expect(isSameOriginAgentRequest(request({ origin: "https://other.example.test" }))).toBe(false)
    expect(isSameOriginAgentRequest(request({ origin: "https://app.example.test/path" }))).toBe(false)
    expect(isSameOriginAgentRequest(request({ origin: "not an origin" }))).toBe(false)
  })

  it("fails closed for cross-site and context-free requests", () => {
    expect(isSameOriginAgentRequest(request({ "sec-fetch-site": "cross-site" }))).toBe(false)
    expect(isSameOriginAgentRequest(request())).toBe(false)
  })

  it("allows trusted same-origin fallback signals and respects forwarded origin", () => {
    expect(isSameOriginAgentRequest(request({ referer: "https://app.example.test/workspace/projects" }))).toBe(true)
    expect(isSameOriginAgentRequest(request({ "sec-fetch-site": "same-origin" }))).toBe(true)
    vi.stubEnv("SAAS_CORE_TRUST_FORWARDED_HOST", "true")
    expect(isSameOriginAgentRequest(request({
      host: "internal.invalid",
      "x-forwarded-host": "app.example.test",
      "x-forwarded-proto": "https:",
      origin: "https://app.example.test",
    }, "http://internal.invalid:3000/api/agent"))).toBe(true)
    vi.unstubAllEnvs()
  })

  it("does not accept a foreign referer even when the request has a same-origin fetch hint", () => {
    expect(isSameOriginAgentRequest(request({ "sec-fetch-site": "same-origin", referer: "https://other.example.test/page" }))).toBe(false)
  })
})
