export type CoreEventMetadata = Record<string, string | number | boolean | null | undefined>
export type CoreEvent = { name: string; metadata?: CoreEventMetadata; at: string }

const SECRET_KEY = /(password|token|secret|api.?key|authorization|cookie|invitation)/i

export function redactCoreMetadata(metadata: CoreEventMetadata = {}): CoreEventMetadata {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : value]))
}

function createCoreEvent(name: string, metadata: CoreEventMetadata = {}): CoreEvent { return { name, metadata: redactCoreMetadata(metadata), at: new Date().toISOString() } }
export function recordCoreEvent(name: string, metadata: CoreEventMetadata = {}): CoreEvent {
  const event = createCoreEvent(name, metadata)
  if (process.env.SAAS_CORE_LOG_SILENT !== "1") process.stdout.write(`${JSON.stringify({ level: "info", ...event })}\n`)
  return event
}

export const coreLogger = {
  info(name: string, metadata?: CoreEventMetadata) { return recordCoreEvent(name, metadata) },
  warn(name: string, metadata?: CoreEventMetadata) { const event = { ...createCoreEvent(name, metadata), level: "warn" }; if (process.env.SAAS_CORE_LOG_SILENT !== "1") process.stdout.write(`${JSON.stringify(event)}\n`); return event },
  error(name: string, metadata?: CoreEventMetadata) { const event = { ...createCoreEvent(name, metadata), level: "error" }; if (process.env.SAAS_CORE_LOG_SILENT !== "1") process.stdout.write(`${JSON.stringify(event)}\n`); return event },
}
