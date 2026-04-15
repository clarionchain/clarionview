import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000"

export async function GET(_req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/quant`, { cache: "no-store" })
    if (!res.ok) return new NextResponse(null, { status: res.status })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return new NextResponse("Analytics service unavailable", { status: 503 })
  }
}

export async function POST(_req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/quant/refresh`, {
      method: "POST",
      cache: "no-store",
    })
    if (!res.ok) return new NextResponse(null, { status: res.status })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return new NextResponse("Analytics service unavailable", { status: 503 })
  }
}
