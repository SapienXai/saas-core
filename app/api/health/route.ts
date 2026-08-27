import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "saas-core",
      version: process.env.VERCEL_GIT_COMMIT_SHA || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
