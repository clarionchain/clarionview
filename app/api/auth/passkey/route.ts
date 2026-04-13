/**
 * Passkey (WebAuthn) API
 *
 * GET  /api/auth/passkey          → list passkeys for logged-in user
 * POST /api/auth/passkey          → register-options | register | login-options | login
 * DELETE /api/auth/passkey?id=X   → remove a passkey
 *
 * action is sent in the JSON body: { action: "register-options" | "register" | "login-options" | "login" }
 */

import { NextRequest, NextResponse } from "next/server"
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server"
import type { AuthenticatorTransportFuture, CredentialDeviceType } from "@simplewebauthn/server"
import {
  listPasskeysForUser,
  getPasskeyById,
  savePasskey,
  updatePasskeySignCount,
  deletePasskey,
  getUserById,
} from "@/lib/db"
import { requireUser } from "@/lib/api-auth"
import { signSessionToken, setSessionCookie } from "@/lib/auth-session"

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID || "localhost"
}

function getRpName(): string {
  return process.env.WEBAUTHN_RP_NAME || "ClarionView"
}

function getOrigin(): string {
  if (process.env.WEBAUTHN_ORIGIN) return process.env.WEBAUTHN_ORIGIN
  const rpId = getRpId()
  return rpId === "localhost" ? "http://localhost:3002" : `https://${rpId}`
}

// ---------------------------------------------------------------------------
// In-memory challenge store (single-server, short TTL)
// ---------------------------------------------------------------------------

interface ChallengeEntry { challenge: string; userId: number | null; expiresAt: number }
const _challenges = new Map<string, ChallengeEntry>()
const CHALLENGE_TTL = 5 * 60 * 1000 // 5 minutes

function storeChallenge(key: string, challenge: string, userId: number | null) {
  // Prune expired
  const now = Date.now()
  for (const [k, v] of _challenges) {
    if (v.expiresAt < now) _challenges.delete(k)
  }
  _challenges.set(key, { challenge, userId, expiresAt: now + CHALLENGE_TTL })
}

function consumeChallenge(key: string): ChallengeEntry | null {
  const entry = _challenges.get(key)
  if (!entry) return null
  _challenges.delete(key)
  if (entry.expiresAt < Date.now()) return null
  return entry
}

// ---------------------------------------------------------------------------
// GET — list passkeys
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const passkeys = listPasskeysForUser(auth.userId)
  return NextResponse.json(
    passkeys.map((p) => ({
      id: p.id,
      name: p.name,
      deviceType: p.deviceType,
      backedUp: p.backedUp,
      createdAt: p.createdAt,
    }))
  )
}

// ---------------------------------------------------------------------------
// POST — actions
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = body.action as string

  // ── register-options (requires auth) ──
  if (action === "register-options") {
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth

    const user = getUserById(auth.userId)
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    const existingPasskeys = listPasskeysForUser(auth.userId)

    const options = await generateRegistrationOptions({
      rpName: getRpName(),
      rpID: getRpId(),
      userName: user.username,
      userDisplayName: user.username,
      attestationType: "none",
      excludeCredentials: existingPasskeys.map((p) => ({
        id: p.id,
        transports: (p.transports ?? []) as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    })

    storeChallenge(`reg:${auth.userId}`, options.challenge, auth.userId)
    return NextResponse.json(options)
  }

  // ── register (requires auth) ──
  if (action === "register") {
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth

    const entry = consumeChallenge(`reg:${auth.userId}`)
    if (!entry) return NextResponse.json({ error: "Challenge expired — try again" }, { status: 400 })

    const passkeyName = typeof body.name === "string" ? body.name.trim().slice(0, 80) || null : null

    try {
      const verification = await verifyRegistrationResponse({
        response: body.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
        expectedChallenge: entry.challenge,
        expectedOrigin: getOrigin(),
        expectedRPID: getRpId(),
        requireUserVerification: false,
      })

      if (!verification.verified || !verification.registrationInfo) {
        return NextResponse.json({ error: "Verification failed" }, { status: 400 })
      }

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

      savePasskey({
        id: credential.id,
        userId: auth.userId,
        publicKey: Buffer.from(credential.publicKey).toString("base64"),
        signCount: credential.counter,
        transports: (credential.transports ?? []) as string[],
        deviceType: credentialDeviceType as CredentialDeviceType,
        backedUp: credentialBackedUp,
        name: passkeyName,
      })

      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 400 })
    }
  }

  // ── login-options (no auth needed) ──
  if (action === "login-options") {
    const options = await generateAuthenticationOptions({
      rpID: getRpId(),
      userVerification: "preferred",
      // Empty allowCredentials = any discoverable credential for this RP
    })
    // Key by a random session id sent back to client
    const sessionKey = crypto.randomUUID()
    storeChallenge(`auth:${sessionKey}`, options.challenge, null)
    return NextResponse.json({ ...options, _sessionKey: sessionKey })
  }

  // ── login (no auth needed) ──
  if (action === "login") {
    const sessionKey = typeof body.sessionKey === "string" ? body.sessionKey : ""
    const entry = consumeChallenge(`auth:${sessionKey}`)
    if (!entry) return NextResponse.json({ error: "Challenge expired — try again" }, { status: 400 })

    const credentialId = (body.response as { id?: string })?.id
    if (!credentialId) return NextResponse.json({ error: "Missing credential id" }, { status: 400 })

    const stored = getPasskeyById(credentialId)
    if (!stored) return NextResponse.json({ error: "Passkey not recognized" }, { status: 401 })

    try {
      const verification = await verifyAuthenticationResponse({
        response: body.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
        expectedChallenge: entry.challenge,
        expectedOrigin: getOrigin(),
        expectedRPID: getRpId(),
        credential: {
          id: stored.id,
          publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64")),
          counter: stored.signCount,
          transports: (stored.transports ?? []) as AuthenticatorTransportFuture[],
        },
        requireUserVerification: false,
      })

      if (!verification.verified) {
        return NextResponse.json({ error: "Authentication failed" }, { status: 401 })
      }

      updatePasskeySignCount(stored.id, verification.authenticationInfo.newCounter)

      const token = await signSessionToken(stored.userId)
      const res = NextResponse.json({ ok: true })
      setSessionCookie(res, token)
      return res
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 401 })
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}

// ---------------------------------------------------------------------------
// DELETE — remove a passkey
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const deleted = deletePasskey(id, auth.userId)
  if (!deleted) return NextResponse.json({ error: "Passkey not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
