import { NextResponse } from "next/server"
import { requirePlatformRole } from "@/lib/platform-authorization"
import { buildRestaurantImportTemplate } from "@/lib/platform-restaurant-import"

export const runtime = "nodejs"

export async function GET() {
  try {
    await requirePlatformRole()
    const workbook = await buildRestaurantImportTemplate()
    return new NextResponse(workbook as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="reservevia-restaurant-import-template.xlsx"',
        "Cache-Control": "private, no-store",
      },
    })
  } catch {
    return NextResponse.json({ error: "You do not have permission to download this template." }, { status: 403 })
  }
}
