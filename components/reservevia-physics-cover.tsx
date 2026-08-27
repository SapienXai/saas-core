"use client"

import { useEffect, useMemo, useRef } from "react"
import {
  Apple,
  CakeSlice,
  ChefHat,
  Coffee,
  CookingPot,
  Croissant,
  Drumstick,
  Fish,
  ForkKnife,
  GlassWater,
  IceCreamBowl,
  Leaf,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  Utensils,
  Wine,
  type LucideIcon,
} from "lucide-react"

const GRAVITY = 920
const RESTITUTION = 0.28
const FRICTION = 0.78
const PHYSICS_ICON_BASE_SIZE = 16
const PHYSICS_ICON_SCALE_SIZE = 21
const PHYSICS_DROP_DURATION = 2
const PHYSICS_DROP_JITTER = 0.15

const PHYSICS_ICON_SET: ReadonlyArray<{ key: string; Icon: LucideIcon }> = [
  { key: "utensils", Icon: Utensils },
  { key: "fork-knife", Icon: ForkKnife },
  { key: "coffee", Icon: Coffee },
  { key: "chef-hat", Icon: ChefHat },
  { key: "leaf", Icon: Leaf },
  { key: "pizza", Icon: Pizza },
  { key: "soup", Icon: Soup },
  { key: "wine", Icon: Wine },
  { key: "cake", Icon: CakeSlice },
  { key: "salad", Icon: Salad },
  { key: "pot", Icon: CookingPot },
  { key: "croissant", Icon: Croissant },
  { key: "ice-cream", Icon: IceCreamBowl },
  { key: "water", Icon: GlassWater },
  { key: "drumstick", Icon: Drumstick },
  { key: "sandwich", Icon: Sandwich },
  { key: "apple", Icon: Apple },
  { key: "fish", Icon: Fish },
]

export const RESERVEVIA_PHYSICS_ICON_COUNT = 18

export type ReserveviaPhysicsIconSeed = {
  id: string
  iconKey: string
  Icon: LucideIcon
  scale: number
  startX: number
  delay: number
  angle: number
}

function createRandom(seed: string) {
  let state = 2166136261
  for (const character of seed.trim().toLowerCase()) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 16777619)
  }

  return () => {
    state = Math.imul(state + 0x6d2b79f5, 1) | 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function getReserveviaPhysicsIconSeeds(slug: string): ReserveviaPhysicsIconSeed[] {
  const random = createRandom(slug)

  return Array.from({ length: RESERVEVIA_PHYSICS_ICON_COUNT }, (_, index) => {
    const icon = PHYSICS_ICON_SET[index % PHYSICS_ICON_SET.length]
    return {
      id: `${slug}-${icon.key}-${index}`,
      iconKey: icon.key,
      Icon: icon.Icon,
      scale: 0.48 + random() * 1.05,
      startX: 0.06 + random() * 0.88,
      delay: (index / (RESERVEVIA_PHYSICS_ICON_COUNT - 1)) * (PHYSICS_DROP_DURATION - PHYSICS_DROP_JITTER) + random() * PHYSICS_DROP_JITTER,
      angle: (random() - 0.5) * 0.8,
    }
  })
}

type PhysicsBody = ReserveviaPhysicsIconSeed & {
  element: HTMLSpanElement | null
  size: number
  radius: number
  mass: number
  x: number
  y: number
  vx: number
  vy: number
  angularVelocity: number
  dragged: boolean
  spawned: boolean
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function createBodies(seeds: ReserveviaPhysicsIconSeed[], width: number): PhysicsBody[] {
  return seeds.map((seed, index) => {
    const size = PHYSICS_ICON_BASE_SIZE + seed.scale * PHYSICS_ICON_SCALE_SIZE
    const radius = size * 0.76
    return {
      ...seed,
      element: null,
      size,
      radius,
      mass: radius * radius,
      x: clamp(seed.startX * width, radius, Math.max(radius, width - radius)),
      y: -radius - index * 1.5,
      vx: (seed.startX - 0.5) * 35,
      vy: 0,
      angularVelocity: seed.angle * 0.18,
      dragged: false,
      spawned: false,
    }
  })
}

function resolveWallCollision(body: PhysicsBody, width: number, height: number) {
  const floor = Math.max(body.radius, height - body.radius)
  const right = Math.max(body.radius, width - body.radius)

  if (body.x < body.radius) {
    body.x = body.radius
    if (body.vx < 0) body.vx = -body.vx * RESTITUTION
    body.vy *= FRICTION
  } else if (body.x > right) {
    body.x = right
    if (body.vx > 0) body.vx = -body.vx * RESTITUTION
    body.vy *= FRICTION
  }

  if (body.y < body.radius) {
    body.y = body.radius
    if (body.vy < 0) body.vy = -body.vy * RESTITUTION
    body.vx *= FRICTION
  } else if (body.y > floor) {
    body.y = floor
    if (body.vy > 0) body.vy = -body.vy * RESTITUTION
    body.vx *= FRICTION
    body.angularVelocity += body.vx * 0.00005
  }
}

function resolveBodyCollision(first: PhysicsBody, second: PhysicsBody) {
  if (!first.spawned || !second.spawned || first.dragged || second.dragged) return

  const deltaX = second.x - first.x
  const deltaY = second.y - first.y
  const distance = Math.hypot(deltaX, deltaY)
  const minimumDistance = first.radius + second.radius
  if (distance >= minimumDistance) return

  const safeDistance = distance || 0.001
  const normalX = distance ? deltaX / safeDistance : 1
  const normalY = distance ? deltaY / safeDistance : 0
  const overlap = minimumDistance - safeDistance
  const inverseFirstMass = 1 / first.mass
  const inverseSecondMass = 1 / second.mass
  const inverseMassTotal = inverseFirstMass + inverseSecondMass

  first.x -= normalX * overlap * (inverseFirstMass / inverseMassTotal)
  first.y -= normalY * overlap * (inverseFirstMass / inverseMassTotal)
  second.x += normalX * overlap * (inverseSecondMass / inverseMassTotal)
  second.y += normalY * overlap * (inverseSecondMass / inverseMassTotal)

  const relativeVelocityX = second.vx - first.vx
  const relativeVelocityY = second.vy - first.vy
  const normalVelocity = relativeVelocityX * normalX + relativeVelocityY * normalY
  if (normalVelocity > 0) return

  const impulse = -(1 + RESTITUTION) * normalVelocity / inverseMassTotal
  const impulseX = impulse * normalX
  const impulseY = impulse * normalY
  first.vx -= impulseX * inverseFirstMass
  first.vy -= impulseY * inverseFirstMass
  second.vx += impulseX * inverseSecondMass
  second.vy += impulseY * inverseSecondMass

  const tangentX = -normalY
  const tangentY = normalX
  const tangentVelocity = relativeVelocityX * tangentX + relativeVelocityY * tangentY
  const tangentImpulse = clamp(-tangentVelocity / inverseMassTotal, -impulse * FRICTION, impulse * FRICTION)
  const tangentImpulseX = tangentImpulse * tangentX
  const tangentImpulseY = tangentImpulse * tangentY
  first.vx -= tangentImpulseX * inverseFirstMass
  first.vy -= tangentImpulseY * inverseFirstMass
  second.vx += tangentImpulseX * inverseSecondMass
  second.vy += tangentImpulseY * inverseSecondMass
  first.angularVelocity -= tangentImpulse * 0.00003
  second.angularVelocity += tangentImpulse * 0.00003
}

export function ReserveviaPhysicsCover({ slug }: { slug: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const iconRefs = useRef<Array<HTMLSpanElement | null>>([])
  const seeds = useMemo(() => getReserveviaPhysicsIconSeeds(slug), [slug])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const bodies = createBodies(seeds, container.clientWidth)
    bodies.forEach((body, index) => {
      body.element = iconRefs.current[index]
    })

    let width = container.clientWidth
    let height = container.clientHeight
    let frameId = 0
    let lastTime = performance.now()
    let startTime = lastTime
    let running = false
    let visible = true
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let targetGravityX = 0
    let targetGravityY = GRAVITY
    let gravityX = 0
    let gravityY = GRAVITY
    let orientationPermissionRequested = false
    let dragState: {
      body: PhysicsBody
      pointerId: number
      offsetX: number
      offsetY: number
      startClientX: number
      startClientY: number
      lastTime: number
      moved: boolean
    } | null = null

    const renderBodies = () => {
      for (const body of bodies) {
        if (!body.element) continue
        body.element.style.visibility = "visible"
        body.element.style.transform = `translate3d(${body.x - body.size / 2}px, ${body.y - body.size / 2}px, 0) rotate(${body.angle}rad)`
      }
    }

    const settleBodies = () => {
      const columns = 6
      bodies.forEach((body, index) => {
        body.spawned = true
        body.x = clamp(((index % columns) + 0.65) / columns * width, body.radius, Math.max(body.radius, width - body.radius))
        body.y = clamp(height * (0.2 + Math.floor(index / columns) * 0.14), body.radius, Math.max(body.radius, height - body.radius))
        body.vx = 0
        body.vy = 0
        body.angularVelocity = 0
      })
      renderBodies()
    }

    const measure = () => {
      width = container.clientWidth
      height = container.clientHeight
      for (const body of bodies) {
        body.x = clamp(body.x, body.radius, Math.max(body.radius, width - body.radius))
        if (body.spawned) body.y = clamp(body.y, body.radius, Math.max(body.radius, height - body.radius))
      }
      if (reducedMotion) settleBodies()
      else renderBodies()
    }

    const stop = () => {
      running = false
      if (frameId) cancelAnimationFrame(frameId)
      frameId = 0
    }

    const tick = (time: number) => {
      if (!running || reducedMotion || !visible) return
      const deltaTime = clamp((time - lastTime) / 1000, 0.001, 0.032)
      lastTime = time
      const elapsed = (time - startTime) / 1000
      gravityX += (targetGravityX - gravityX) * Math.min(1, deltaTime * 4)
      gravityY += (targetGravityY - gravityY) * Math.min(1, deltaTime * 4)

      for (const body of bodies) {
        if (elapsed < body.delay) continue
        if (body.dragged) continue
        body.spawned = true
        body.vx += gravityX * deltaTime
        body.vy += gravityY * deltaTime
        body.vx *= Math.pow(0.997, deltaTime * 60)
        body.vy *= Math.pow(0.999, deltaTime * 60)
        body.angularVelocity *= Math.pow(0.9, deltaTime * 60)
        body.angularVelocity = clamp(body.angularVelocity, -0.4, 0.4)
        body.x += body.vx * deltaTime
        body.y += body.vy * deltaTime
        body.angle += body.angularVelocity * deltaTime
        resolveWallCollision(body, width, height)
      }

      for (let pass = 0; pass < 2; pass += 1) {
        for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
          for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
            resolveBodyCollision(bodies[firstIndex], bodies[secondIndex])
          }
        }
      }

      for (const body of bodies) resolveWallCollision(body, width, height)
      for (const body of bodies) {
        body.angularVelocity *= 0.22
        body.angularVelocity = clamp(body.angularVelocity, -0.035, 0.035)
      }

      renderBodies()
      frameId = requestAnimationFrame(tick)
    }

    const start = () => {
      if (running || reducedMotion || !visible) return
      running = true
      lastTime = performance.now()
      if (!startTime) startTime = lastTime
      frameId = requestAnimationFrame(tick)
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (typeof event.gamma !== "number" || typeof event.beta !== "number") return
      targetGravityX = clamp(event.gamma / 38, -1, 1) * GRAVITY * 0.9
      targetGravityY = GRAVITY + clamp((event.beta - 90) / 45, -1, 1) * GRAVITY * 0.72
    }

    const requestOrientationPermission = () => {
      if (orientationPermissionRequested) return
      orientationPermissionRequested = true
      const orientationApi = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
      if (typeof orientationApi.requestPermission !== "function") return
      void orientationApi.requestPermission().catch(() => undefined)
    }

    const getLocalPoint = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect()
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }

    const handlePointerDown = (body: PhysicsBody, event: PointerEvent) => {
      if (dragState || (event.pointerType === "mouse" && event.button !== 0)) return
      event.preventDefault()
      event.stopPropagation()
      requestOrientationPermission()

      const point = getLocalPoint(event)
      body.spawned = true
      body.dragged = true
      body.vx = 0
      body.vy = 0
      body.angularVelocity = 0
      dragState = {
        body,
        pointerId: event.pointerId,
        offsetX: point.x - body.x,
        offsetY: point.y - body.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastTime: performance.now(),
        moved: false,
      }
      body.element?.classList.add("reservevia-physics-icon-dragging")
      body.element?.setPointerCapture(event.pointerId)
      renderBodies()
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return
      event.preventDefault()

      const body = dragState.body
      const point = getLocalPoint(event)
      const now = performance.now()
      const deltaTime = clamp((now - dragState.lastTime) / 1000, 0.008, 0.05)
      const nextX = clamp(point.x - dragState.offsetX, body.radius, Math.max(body.radius, width - body.radius))
      const nextY = clamp(point.y - dragState.offsetY, body.radius, Math.max(body.radius, height - body.radius))
      body.vx = clamp((nextX - body.x) / deltaTime, -820, 820)
      body.vy = clamp((nextY - body.y) / deltaTime, -820, 820)
      body.x = nextX
      body.y = nextY
      dragState.lastTime = now
      dragState.moved = dragState.moved || Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY) > 6
      renderBodies()
    }

    const finishPointerInteraction = (event: PointerEvent, cancelled = false) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return

      const { body } = dragState
      const isClick = !dragState.moved && Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY) <= 6
      body.dragged = false
      body.element?.classList.remove("reservevia-physics-icon-dragging")
      if (cancelled) {
        body.vx = 0
        body.vy = 0
      } else if (isClick) {
        body.vx = 0
        body.vy = -220
        body.angularVelocity = body.x < width / 2 ? -0.02 : 0.02
      } else {
        body.vx = clamp(body.vx, -820, 820)
        body.vy = clamp(body.vy, -820, 820)
      }
      if (body.element?.hasPointerCapture(event.pointerId)) body.element.releasePointerCapture(event.pointerId)
      dragState = null
      renderBodies()
      start()
    }

    const handleMotionPreference = () => {
      reducedMotion = motionPreference.matches
      if (reducedMotion) {
        stop()
        settleBodies()
      } else {
        startTime = performance.now()
        start()
      }
    }

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    resizeObserver?.observe(container)
    const intersectionObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true
      if (visible) start()
      else stop()
    })
    intersectionObserver?.observe(container)
    window.addEventListener("deviceorientation", handleOrientation, { passive: true })
    container.addEventListener("pointerdown", requestOrientationPermission, { passive: true, once: true })
    motionPreference.addEventListener("change", handleMotionPreference)
    const pointerCleanups = bodies.map((body) => {
      const element = body.element
      if (!element) return () => undefined
      const pointerDown = (event: PointerEvent) => handlePointerDown(body, event)
      element.addEventListener("pointerdown", pointerDown, { passive: false })
      return () => {
        element.removeEventListener("pointerdown", pointerDown)
      }
    })
    const handlePointerCancel = (event: PointerEvent) => finishPointerInteraction(event, true)
    window.addEventListener("pointermove", handlePointerMove, { passive: false })
    window.addEventListener("pointerup", finishPointerInteraction)
    window.addEventListener("pointercancel", handlePointerCancel)
    measure()
    if (reducedMotion) settleBodies()
    else start()

    return () => {
      stop()
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      pointerCleanups.forEach((cleanup) => cleanup())
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", finishPointerInteraction)
      window.removeEventListener("pointercancel", handlePointerCancel)
      window.removeEventListener("deviceorientation", handleOrientation)
      container.removeEventListener("pointerdown", requestOrientationPermission)
      motionPreference.removeEventListener("change", handleMotionPreference)
    }
  }, [seeds])

  return (
    <div ref={containerRef} className="reservevia-physics-cover" aria-hidden="true">
      <div className="reservevia-physics-atmosphere" />
      {seeds.map((seed, index) => {
        const Icon = seed.Icon
        return (
          <span
            key={seed.id}
            ref={(element) => { iconRefs.current[index] = element }}
            className={`reservevia-physics-icon reservevia-physics-icon-tone-${index % 4}`}
            style={{
              width: `${PHYSICS_ICON_BASE_SIZE + seed.scale * PHYSICS_ICON_SCALE_SIZE}px`,
              height: `${PHYSICS_ICON_BASE_SIZE + seed.scale * PHYSICS_ICON_SCALE_SIZE}px`,
            }}
          >
            <Icon aria-hidden="true" strokeWidth={1.65} />
          </span>
        )
      })}
    </div>
  )
}
