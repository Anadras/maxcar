// MAX-010.6: verifies a v2 signed device request (Android Keystore-backed
// EC key, never a static bearer token) and, once verified, mints a
// single-use ~60s bridge token so the caller can hand off to the
// *existing*, unmodified v1 RPCs unchanged — see the migration's header
// comment (20260812090000_device_key_authentication.sql) for why that
// bridge exists instead of teaching every RPC a second auth scheme.
//
// Canonical request (exactly these 6 lines, "\n"-joined, UTF-8 bytes):
//   MAXCAR1
//   <METHOD>
//   <PATH>              e.g. "/device-heartbeat" — function name only,
//                        never the full https://…supabase.co/functions/v1/…
//                        URL, so a project's hostname is never part of
//                        what gets signed.
//   <TIMESTAMP>          ISO-8601, e.g. 2026-08-04T19:00:00.000Z
//   <NONCE>
//   <BODY_SHA256>         lowercase hex, sha256 of the *raw* request body
//                          bytes (sha256("") for an empty body)
//
// Signed with ECDSA P-256 / SHA-256, in the IEEE P1363 "raw" r||s format
// (64 bytes for P-256: 32-byte r, 32-byte s) — Android signs with
// "SHA256withECDSAinP1363Format" specifically so neither side has to
// parse ASN.1 DER. Base64-encoded for the header.
//
// Public keys are stored and imported as raw X.509 SubjectPublicKeyInfo
// DER bytes — exactly what Android's KeyPair.public.encoded already
// produces for a Keystore EC key, and exactly what
// crypto.subtle.importKey('spki', …) expects; no conversion needed there
// either.

import { bearerToken, jsonResponse, serviceClient } from './device-api.ts';

const SIGNATURE_VERSION = 'MAXCAR1';
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export interface SignedDeviceHeaders {
  keyId: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
  signature: string;
  signatureVersion: string;
}

function readSignedHeaders(req: Request): SignedDeviceHeaders | null {
  const keyId = req.headers.get('x-maxcar-key-id');
  const timestamp = req.headers.get('x-maxcar-timestamp');
  const nonce = req.headers.get('x-maxcar-nonce');
  const bodySha256 = req.headers.get('x-maxcar-body-sha256');
  const signature = req.headers.get('x-maxcar-signature');
  const signatureVersion = req.headers.get('x-maxcar-signature-version');
  if (!keyId || !timestamp || !nonce || !bodySha256 || !signature || !signatureVersion) {
    return null;
  }
  return { keyId, timestamp, nonce, bodySha256, signature, signatureVersion };
}

/** True if this request carries the full v2 signed-header set — the
 * caller uses this to decide between the v2 and legacy v1 Bearer path;
 * a request with neither is simply unauthenticated. */
export function hasSignedDeviceHeaders(req: Request): boolean {
  return readSignedHeaders(req) !== null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Verifies an ECDSA P-256/SHA-256 signature in IEEE P1363 raw r||s
 * format (Android: "SHA256withECDSAinP1363Format") over arbitrary bytes,
 * given the signer's public key as base64 X.509 SubjectPublicKeyInfo
 * DER. Shared between per-request signature checks and the enrollment
 * challenge-response proof of possession — both verify the same way,
 * just over different payloads (a canonical request vs. a raw
 * challenge). Never throws; a malformed key or signature just verifies
 * false, same as a wrong one. */
export async function verifyEcdsaP256Signature(
  publicKeyDerBase64: string,
  signatureBase64: string,
  signedBytes: Uint8Array,
): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey(
      'spki',
      base64ToBytes(publicKeyDerBase64),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64ToBytes(signatureBase64),
      signedBytes,
    );
  } catch (err) {
    console.error('signature verification threw', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Result of a successful verification: a session token ready to hand to
 * the existing v1 RPC for this endpoint. On failure, an HTTP Response
 * the caller should return as-is (never leaks *why* signature
 * verification failed beyond a generic category, matching errorResponse
 * in device-api.ts). */
export type SignedDeviceAuthResult =
  | { ok: true; sessionToken: string; deviceId: string }
  | { ok: false; response: Response };

export async function verifySignedDeviceRequest(
  req: Request,
  rawBody: Uint8Array,
  functionPath: string,
): Promise<SignedDeviceAuthResult> {
  const headers = readSignedHeaders(req);
  if (!headers) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'unauthorized', message: 'Missing signed request headers.' },
        401,
      ),
    };
  }
  if (headers.signatureVersion !== SIGNATURE_VERSION) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'unauthorized', message: 'Unsupported signature version.' },
        401,
      ),
    };
  }

  const requestTimeMs = Date.parse(headers.timestamp);
  const nowMs = Date.now();
  if (!Number.isFinite(requestTimeMs) || Math.abs(nowMs - requestTimeMs) > TIMESTAMP_TOLERANCE_MS) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error: 'clock_skew',
          message: 'Request timestamp outside the accepted tolerance.',
          serverTime: new Date(nowMs).toISOString(),
        },
        401,
      ),
    };
  }

  const actualBodyHash = await sha256Hex(rawBody);
  if (actualBodyHash !== headers.bodySha256.toLowerCase()) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'unauthorized', message: 'Body hash does not match signed value.' },
        401,
      ),
    };
  }

  const supabase = serviceClient();
  const { data: keyRows, error: keyError } = await supabase.rpc(
    'get_device_key_for_verification',
    { p_key_id: headers.keyId },
  );
  if (keyError || !keyRows || keyRows.length === 0) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'unauthorized', message: 'Unknown device key.' },
        401,
      ),
    };
  }
  const keyRow = keyRows[0] as {
    device_id: string;
    public_key_der: string;
    revoked_at: string | null;
  };
  if (keyRow.revoked_at) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'key_revoked', message: 'This device key has been revoked.' },
        401,
      ),
    };
  }

  const canonicalRequest = [
    SIGNATURE_VERSION,
    req.method,
    functionPath,
    headers.timestamp,
    headers.nonce,
    actualBodyHash,
  ].join('\n');

  const signatureValid = await verifyEcdsaP256Signature(
    keyRow.public_key_der,
    headers.signature,
    new TextEncoder().encode(canonicalRequest),
  );
  if (!signatureValid) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'unauthorized', message: 'Invalid signature.' },
        401,
      ),
    };
  }

  const { data: nonceOk, error: nonceError } = await supabase.rpc(
    'check_and_record_device_nonce',
    { p_key_id: headers.keyId, p_nonce: headers.nonce },
  );
  if (nonceError) {
    return {
      ok: false,
      response: jsonResponse({ error: 'server_error', message: 'Unexpected error.' }, 500),
    };
  }
  if (!nonceOk) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'replay_detected', message: 'This request nonce has already been used.' },
        401,
      ),
    };
  }

  const { data: sessionToken, error: mintError } = await supabase.rpc(
    'mint_device_session_token',
    { p_key_id: headers.keyId },
  );
  if (mintError || !sessionToken) {
    return {
      ok: false,
      response: jsonResponse({ error: 'server_error', message: 'Unexpected error.' }, 500),
    };
  }

  return { ok: true, sessionToken, deviceId: keyRow.device_id };
}

export type ResolvedDeviceToken =
  | { ok: true; token: string }
  | { ok: false; response: Response };

/** The one call every v1/v2-aware device endpoint makes: try the v2
 * signed-request headers first, fall back to the legacy v1 Bearer token
 * only if none are present, and otherwise fail closed. Per MAX-010.6
 * section 15, a device that has already migrated to a key never falls
 * back to Bearer again (its device_credentials row was revoked the
 * moment the key activated) — this function doesn't need to special-case
 * that itself, since a revoked v1 token is already rejected downstream
 * by the exact same private.device_id_for_token every v1 call always
 * went through. */
export async function resolveDeviceApiToken(
  req: Request,
  rawBody: Uint8Array,
  functionPath: string,
): Promise<ResolvedDeviceToken> {
  if (hasSignedDeviceHeaders(req)) {
    const result = await verifySignedDeviceRequest(req, rawBody, functionPath);
    if (!result.ok) return { ok: false, response: result.response };
    return { ok: true, token: result.sessionToken };
  }
  const legacyToken = bearerToken(req);
  if (!legacyToken) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'unauthorized', message: 'Missing device credential.' },
        401,
      ),
    };
  }
  return { ok: true, token: legacyToken };
}
