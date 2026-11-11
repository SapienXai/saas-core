import "server-only"

import { neonPool } from "./auth"

const pathPattern = /^[a-f0-9-]{36}\/pwa\/icon\/[a-zA-Z0-9._-]{1,180}$/
const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"])
export function isNeonAssetPath(path: string) {
  return pathPattern.test(path)
}

function publicAssetUrl(path: string) {
  return "/api/core-data/icon?path=" + encodeURIComponent(path)
}

async function readAsset(path: string, publishedOnly = false) {
  if (!isNeonAssetPath(path)) return null
  const condition = publishedOnly
    ? " AND EXISTS (SELECT 1 FROM public.workspace_pwa_settings WHERE icon_url = $2)"
    : ""
  const { rows: [asset] } = await neonPool().query<{ bytes: Buffer; content_type: string }>(
    "SELECT bytes, content_type FROM auth.workspace_assets asset WHERE path = $1" + condition, publishedOnly ? [path, publicAssetUrl(path)] : [path],
  )
  return asset && acceptedTypes.has(asset.content_type) ? asset : null
}

export async function getPublishedNeonAsset(path: string) {
  return readAsset(path, true)
}

export const neonStorage = {
  from(bucket: string) {
    if (bucket !== "workspace-assets") throw new Error("Unknown Core asset bucket.")
    return {
      async upload(path: string, bytes: Buffer, options: { contentType: string }) {
        if (!isNeonAssetPath(path) || !acceptedTypes.has(options.contentType) || !bytes.length || bytes.length > 2 * 1024 * 1024) {
          return { data: null, error: new Error("Invalid workspace asset.") }
        }
        try {
          await neonPool().query("INSERT INTO auth.workspace_assets (path, bytes, content_type) VALUES ($1, $2, $3)", [path, bytes, options.contentType])
          return { data: { path }, error: null }
        } catch {
          return { data: null, error: new Error("Could not store workspace asset.") }
        }
      },
      async remove(paths: string[]) {
        try {
          await neonPool().query("DELETE FROM auth.workspace_assets WHERE path = ANY($1::text[])", [paths.filter(isNeonAssetPath)])
          return { data: [], error: null }
        } catch {
          return { data: null, error: new Error("Could not remove workspace asset.") }
        }
      },
      getPublicUrl(path: string) {
        return { data: { publicUrl: publicAssetUrl(path) } }
      },
      async download(path: string) {
        const asset = await readAsset(path)
        return { data: asset ? new Blob([new Uint8Array(asset.bytes)], { type: asset.content_type }) : null, error: null }
      },
    }
  },
}
