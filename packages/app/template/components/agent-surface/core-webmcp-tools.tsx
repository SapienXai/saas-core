"use client"

import { useEffect } from "react"
import type { AgentToolDefinition } from "@sapienx/saas-core"
import {
  registerWebMcpTools,
  type AgentToolConfirmation,
  type WebMcpRegistrationOptions,
} from "@/lib/agent-surface/webmcp"

export type CoreWebMcpToolsProps = {
  tools: readonly AgentToolDefinition[]
  confirmMutation?: AgentToolConfirmation
  observer?: WebMcpRegistrationOptions["observer"]
}

/** Page-scoped progressive enhancement. It renders no UI and registers no default tools. */
export function CoreWebMcpTools({ tools, confirmMutation, observer }: CoreWebMcpToolsProps) {
  useEffect(() => {
    const registration = registerWebMcpTools(tools, { confirmMutation, observer })
    void registration.ready.catch(() => undefined)
    return registration.dispose
  }, [confirmMutation, observer, tools])

  return null
}
