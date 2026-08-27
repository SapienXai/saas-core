"use server"

import { respondToReservationViaToken } from "@/lib/reservation-management"

export async function respondToReservationAction(token: string, decision: "confirmed" | "cancelled") {
  return respondToReservationViaToken(token, decision)
}
