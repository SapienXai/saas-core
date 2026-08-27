import { describe, expect, it } from "vitest"
import {
  findBlockedIntervalForReservation,
  parseReservationDate,
  parseTimeToMinutes,
  validateReservationAvailability,
  validatePublicReservationContactInput,
  validateReservationInput,
  type ReservationAvailabilitySettings,
} from "../lib/reservation-validation"

const now = new Date(2026, 7, 9, 10, 0, 0)

const restaurant: ReservationAvailabilitySettings = {
  reservation_enabled: true,
  opening_time: "17:00",
  closing_time: "20:45",
  time_slot_duration: 15,
  advance_booking_days: 15,
  min_advance_hours: 0,
  min_party_size: 1,
  max_party_size: 8,
  allowed_days_of_week: [1, 2, 3, 4, 5, 6, 7],
  blocked_dates: [],
  reservation_blocked_intervals: [],
}

describe("reservation input validation", () => {
  it("rejects invalid calendar dates", () => {
    expect(parseReservationDate("2026-02-30")).toBeNull()
    expect(validateReservationInput({
      reservationDate: "2026-02-30",
      reservationTime: "17:00",
      partySize: 2,
    })).toContain("valid reservation date")
  })

  it("accepts valid dates and times and converts times to minutes", () => {
    expect(parseReservationDate("2026-08-10")).toBeInstanceOf(Date)
    expect(parseTimeToMinutes("17:30")).toBe(1050)
    expect(validateReservationInput({
      reservationDate: "2026-08-10",
      reservationTime: "17:30",
      partySize: 2,
      status: "pending",
    })).toBeNull()
  })

  it("rejects invalid party sizes and statuses", () => {
    expect(validateReservationInput({
      reservationDate: "2026-08-10",
      reservationTime: "17:30",
      partySize: 0,
    })).toContain("positive")
    expect(validateReservationInput({
      reservationDate: "2026-08-10",
      reservationTime: "17:30",
      partySize: 2,
      status: "deleted",
    })).toContain("status")
  })

  it("bounds public contact fields and accepts a safe submission key", () => {
    const valid = {
      restaurantId: "00000000-0000-4000-8000-000000000001",
      reservationAreaId: null,
      customerName: "Guest",
      customerPhone: "+90 555 000 0000",
      customerEmail: "guest@example.test",
      submissionId: "rv_submission_123456",
    }
    expect(validatePublicReservationContactInput(valid)).toBeNull()
    expect(validatePublicReservationContactInput({ ...valid, customerName: "x".repeat(121) })).toContain("valid name")
    expect(validatePublicReservationContactInput({ ...valid, specialRequests: "x".repeat(1001) })).toContain("too long")
    expect(validatePublicReservationContactInput({ ...valid, submissionId: "unsafe token" })).toContain("submission")
  })
})

describe("reservation availability", () => {
  it("accepts a valid slot and rejects an off-grid time", () => {
    expect(validateReservationAvailability({
      reservationDate: "2026-08-10",
      reservationTime: "17:15",
      partySize: 4,
    }, restaurant, null, now)).toBeNull()

    expect(validateReservationAvailability({
      reservationDate: "2026-08-10",
      reservationTime: "17:10",
      partySize: 4,
    }, restaurant, null, now)).toContain("between")
  })

  it("enforces configured party-size bounds", () => {
    expect(validateReservationAvailability({
      reservationDate: "2026-08-10",
      reservationTime: "17:15",
      partySize: 9,
    }, restaurant, null, now)).toContain("between 1 and 8")
  })

  it("blocks configured dates and intervals", () => {
    const blockedDateRestaurant = { ...restaurant, blocked_dates: ["2026-08-11"] }
    expect(validateReservationAvailability({
      reservationDate: "2026-08-11",
      reservationTime: "17:15",
      partySize: 2,
    }, blockedDateRestaurant, null, now)).toContain("selected date")

    const blockedIntervalRestaurant = {
      ...restaurant,
      reservation_blocked_intervals: [{
        date: "2026-08-12",
        start_time: "18:00",
        end_time: "19:00",
        message: "Dinner service is full.",
      }],
    }
    expect(findBlockedIntervalForReservation(
      blockedIntervalRestaurant.reservation_blocked_intervals,
      "2026-08-12",
      "18:15",
    )?.message).toBe("Dinner service is full.")
    expect(validateReservationAvailability({
      reservationDate: "2026-08-12",
      reservationTime: "18:15",
      partySize: 2,
    }, blockedIntervalRestaurant, null, now)).toBe("Dinner service is full.")
  })
})
