import { describe, expect, it } from "vitest"
import { getReserveviaPhysicsIconSeeds, RESERVEVIA_PHYSICS_ICON_COUNT } from "../components/reservevia-physics-cover"

describe("Reservevia physics cover", () => {
  it("creates a stable set of varied restaurant icons for each slug", () => {
    const first = getReserveviaPhysicsIconSeeds("ciya-sofrasi")
    const second = getReserveviaPhysicsIconSeeds("ciya-sofrasi")

    expect(first).toHaveLength(RESERVEVIA_PHYSICS_ICON_COUNT)
    expect(first.map((seed) => seed.iconKey)).toEqual(second.map((seed) => seed.iconKey))
    expect(first.map((seed) => seed.startX)).toEqual(second.map((seed) => seed.startX))
    expect(new Set(first.map((seed) => seed.iconKey)).size).toBe(RESERVEVIA_PHYSICS_ICON_COUNT)
  })

  it("keeps the initial motion values within the intended premium banner range", () => {
    const seeds = getReserveviaPhysicsIconSeeds("anadolu-mutfaklari-laboratuvari")

    for (const seed of seeds) {
      expect(seed.scale).toBeGreaterThanOrEqual(0.48)
      expect(seed.scale).toBeLessThanOrEqual(1.53)
      expect(seed.startX).toBeGreaterThanOrEqual(0.06)
      expect(seed.startX).toBeLessThanOrEqual(0.94)
      expect(seed.delay).toBeGreaterThanOrEqual(0)
      expect(seed.delay).toBeLessThanOrEqual(2)
      expect(Math.abs(seed.angle)).toBeLessThanOrEqual(0.4)
    }

    expect(Math.max(...seeds.map((seed) => seed.delay))).toBeGreaterThan(1.85)
  })
})
