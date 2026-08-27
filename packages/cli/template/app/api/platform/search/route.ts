import { NextResponse } from "next/server"
import { AuthorizationError } from "@/lib/authorization"
import { searchPlatformEntities } from "@/lib/platform-admin"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") || ""
  try {
    return NextResponse.json(await searchPlatformEntities(query))
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ groups: [], message: "Authentication required." }, { status: error.code === "UNAUTHENTICATED" ? 401 : 403 })
    console.error("Platform search failed", error instanceof Error ? error.message : error)
    return NextResponse.json({ groups: [], message: "Search is temporarily unavailable." }, { status: 500 })
  }
}
