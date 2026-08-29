"use client"

import type {
  AgentToolCancellation,
  AgentToolDefinition,
  AgentToolExecutionFailure,
  AgentSurfaceEvent,
  AgentSurfaceObserver,
} from "@sapienx/saas-core"
import { validateAgentToolDefinitions } from "@sapienx/saas-core"

const DEFAULT_CONFIRMATION_MESSAGE = "This action will change data. Continue?"

type WebMcpTool = {
  name: string
  title?: string
  description: string
  inputSchema: AgentToolDefinition["inputSchema"]
  annotations: {
    readOnlyHint: boolean
    untrustedContentHint: boolean
  }
  execute(input: unknown, client?: { signal?: AbortSignal }): Promise<unknown>
}

type WebMcpModelContext = {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<void> | void
}

type AgentToolConfirmationTarget = Pick<
  AgentToolDefinition,
  "name" | "title" | "description" | "kind" | "requiresConfirmation" | "confirmationMessage"
>

export type AgentToolConfirmation = (tool: AgentToolConfirmationTarget) => boolean | Promise<boolean>

export type WebMcpRegistrationOptions = {
  confirmMutation?: AgentToolConfirmation
  observer?: AgentSurfaceObserver
}

export type WebMcpRegistration = {
  ready: Promise<void>
  dispose: () => void
}

const activeToolNames = new WeakMap<object, Map<string, symbol>>()

function getModelContext(): WebMcpModelContext | null {
  if (typeof document === "undefined") return null
  const candidate = (document as unknown as { modelContext?: unknown }).modelContext
  if (!candidate || typeof candidate !== "object" || typeof (candidate as { registerTool?: unknown }).registerTool !== "function") return null
  return candidate as WebMcpModelContext
}

function emit(observer: AgentSurfaceObserver | undefined, event: AgentSurfaceEvent) {
  if (!observer) return
  try {
    observer(event)
  } catch {
    // Observability must never change tool behavior or leak execution details.
  }
}

function cancellation(code: AgentToolCancellation["error"]["code"]): AgentToolCancellation {
  if (code === "confirmation_rejected") return { ok: false, error: { code, message: "The action was not confirmed.", retryable: false } }
  if (code === "confirmation_unavailable") return { ok: false, error: { code, message: "The action could not be confirmed.", retryable: true } }
  return { ok: false, error: { code, message: "The tool execution was cancelled.", retryable: true } }
}

function executionFailure(): AgentToolExecutionFailure {
  return { ok: false, error: { code: "execution_failed", message: "The tool could not be completed." } }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError"
}

export function defaultAgentToolConfirmation(tool: AgentToolConfirmationTarget) {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return false
  return window.confirm(tool.confirmationMessage?.trim() || DEFAULT_CONFIRMATION_MESSAGE)
}

async function executeTool(
  tool: AgentToolDefinition,
  input: unknown,
  client: { signal?: AbortSignal } | undefined,
  options: WebMcpRegistrationOptions,
): Promise<unknown> {
  const signal = client?.signal || new AbortController().signal
  if (signal.aborted) {
    emit(options.observer, { type: "tool_cancelled", toolName: tool.name })
    return cancellation("cancelled")
  }

  if (tool.requiresConfirmation) {
    let approved = false
    try {
      approved = await (options.confirmMutation || defaultAgentToolConfirmation)({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        kind: tool.kind,
        requiresConfirmation: tool.requiresConfirmation,
        confirmationMessage: tool.confirmationMessage,
      })
    } catch {
      return cancellation("confirmation_unavailable")
    }
    if (signal.aborted) {
      emit(options.observer, { type: "tool_cancelled", toolName: tool.name })
      return cancellation("cancelled")
    }
    if (approved !== true) {
      emit(options.observer, { type: "tool_confirmation_rejected", toolName: tool.name })
      return cancellation("confirmation_rejected")
    }
  }

  const startedAt = Date.now()
  emit(options.observer, { type: "tool_execution_started", toolName: tool.name })
  try {
    const result = await tool.execute(input, { signal })
    emit(options.observer, { type: "tool_execution_succeeded", toolName: tool.name, durationMs: Date.now() - startedAt })
    return result
  } catch (error) {
    const durationMs = Date.now() - startedAt
    if (signal.aborted || isAbortError(error)) {
      emit(options.observer, { type: "tool_cancelled", toolName: tool.name, durationMs })
    } else {
      emit(options.observer, { type: "tool_execution_failed", toolName: tool.name, durationMs, errorCode: "execution_failed" })
      return executionFailure()
    }
    throw error
  }
}

function toWebMcpTool(tool: AgentToolDefinition, options: WebMcpRegistrationOptions): WebMcpTool {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: tool.kind === "read",
      untrustedContentHint: tool.returnsUntrustedContent,
    },
    execute: (input, client) => executeTool(tool, input, client, options),
  }
}

export function registerWebMcpTools(tools: readonly AgentToolDefinition[], options: WebMcpRegistrationOptions = {}): WebMcpRegistration {
  validateAgentToolDefinitions(tools)
  const modelContext = getModelContext()
  if (!modelContext) return { ready: Promise.resolve(), dispose: () => undefined }

  const names = tools.map((tool) => tool.name)
  const existing = activeToolNames.get(modelContext) || new Map<string, symbol>()
  for (const name of names) {
    if (existing.has(name)) throw new Error(`WebMCP tool name is already registered: ${name}.`)
  }
  const registrationToken = Symbol("webmcp-registration")
  for (const name of names) existing.set(name, registrationToken)
  activeToolNames.set(modelContext, existing)

  const controller = new AbortController()
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    controller.abort()
    for (const name of names) {
      if (existing.get(name) === registrationToken) existing.delete(name)
    }
    if (!existing.size) activeToolNames.delete(modelContext)
  }

  const ready = (async () => {
    let currentTool = tools[0]
    try {
      for (const tool of tools) {
        currentTool = tool
        if (disposed) return
        await modelContext.registerTool(toWebMcpTool(tool, options), { signal: controller.signal })
        if (!disposed) emit(options.observer, { type: "tool_registered", toolName: tool.name })
      }
    } catch {
      if (!disposed) {
        emit(options.observer, { type: "tool_registration_failed", toolName: currentTool.name, errorCode: "registration_failed" })
        dispose()
        throw new Error(`WebMCP tool registration failed for ${currentTool.name}.`)
      }
      return undefined
    }
  })()

  return { ready, dispose }
}
