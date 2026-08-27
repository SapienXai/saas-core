import type { ReactNode } from "react"

export function PublicRestaurantDeviceFrame({ children }: { children: ReactNode }) {
  return (
    <div className="public-restaurant-device-frame">
      <span className="public-restaurant-device-speaker" aria-hidden="true" />
      <div className="public-restaurant-device-screen">{children}</div>
    </div>
  )
}
