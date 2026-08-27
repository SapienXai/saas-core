import { ImageResponse } from "next/og"
import type { PublicRestaurantProfile } from "@/lib/restaurant-profile"
import { RESTAURANT_OG_IMAGE_SIZE } from "@/lib/restaurant-seo"

const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024

async function loadImageDataUrl(value: string | null | undefined) {
  if (!value) return null

  let imageUrl: URL
  try {
    imageUrl = new URL(value)
  } catch {
    return null
  }

  if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:") return null

  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return null

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || ""
    if (!contentType.startsWith("image/")) return null

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) return null
    return `data:${contentType};base64,${bytes.toString("base64")}`
  } catch {
    return null
  }
}

function getRestaurantImageMarkup(imageDataUrl: string | null) {
  if (!imageDataUrl) return null

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageDataUrl}
      alt=""
      width={RESTAURANT_OG_IMAGE_SIZE.width}
      height={RESTAURANT_OG_IMAGE_SIZE.height}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: 0.38,
      }}
    />
  )
}

export async function createRestaurantOgImage(restaurant: PublicRestaurantProfile) {
  const imageDataUrl = await loadImageDataUrl(restaurant.primaryImageUrl || restaurant.logoUrl)
  const eyebrow = restaurant.showReserveviaBranding ? "RESERVEVIA" : "RESTAURANT"
  const details = [restaurant.cuisine, restaurant.location].filter(Boolean).join("  •  ") || "Restaurant reservations"

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#17151f",
          color: "#ffffff",
          fontFamily: "Arial",
        }}
      >
        {getRestaurantImageMarkup(imageDataUrl)}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background: "linear-gradient(90deg, rgba(18, 15, 28, 0.96) 0%, rgba(18, 15, 28, 0.72) 54%, rgba(18, 15, 28, 0.28) 100%)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: "100%",
            padding: "72px 88px",
          }}
        >
          <div style={{ display: "flex", fontSize: 24, letterSpacing: 5, color: "#d8b4fe", fontWeight: 700 }}>{eyebrow}</div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 68, lineHeight: 1.08, fontWeight: 700, maxWidth: 930 }}>{restaurant.name}</div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 28, color: "#e9e4f2" }}>{details}</div>
          <div style={{ display: "flex", marginTop: 34, fontSize: 22, color: "#cfc5dc" }}>Book your table online</div>
        </div>
      </div>
    ),
    RESTAURANT_OG_IMAGE_SIZE,
  )
}

export function createReserveviaOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 92px",
          background: "linear-gradient(135deg, #17151f 0%, #35284a 100%)",
          color: "#ffffff",
          fontFamily: "Arial",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, color: "#d8b4fe", fontWeight: 700 }}>RESERVEVIA</div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 68, lineHeight: 1.08, fontWeight: 700 }}>Restaurant reservations, made simple.</div>
      </div>
    ),
    RESTAURANT_OG_IMAGE_SIZE,
  )
}
