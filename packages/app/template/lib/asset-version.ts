export function getAssetVersion(value: string, version?: string | null) {
  const source = `${value}|${version || ""}`
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function withAssetVersion(value: string | null | undefined, version?: string | null) {
  if (!value) return null

  try {
    const url = new URL(value)
    url.searchParams.set("v", getAssetVersion(value, version))
    return url.toString()
  } catch {
    return value
  }
}
