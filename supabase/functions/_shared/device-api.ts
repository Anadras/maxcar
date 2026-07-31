// Shared helpers for the MAXCAR device API (device-enroll, device-heartbeat,
// device-config). These functions run only in the Edge Function's own
// Deno runtime, never on the Android tablet: SUPABASE_SERVICE_ROLE_KEY is
// injected automatically by the platform and is never bundled, logged, or
// echoed back in a response.

import { createClient } from 'jsr:@supabase/supabase-js@2';

export function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function preflightResponse() {
  return new Response('ok', { headers: corsHeaders });
}

export function bearerToken(req: Request): string | null {
  const header =
    req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Maps a Postgres error (from a device-facing RPC) to an HTTP response,
 * without ever forwarding the raw Postgres error object. */
export function errorResponse(error: { code?: string; message?: string }) {
  const message = error.message ?? 'Unexpected error.';
  switch (error.code) {
    case '42501':
      return jsonResponse({ error: 'unauthorized', message }, 401);
    case '23514':
      return jsonResponse({ error: 'rate_limited', message }, 429);
    case '22023':
      return jsonResponse({ error: 'invalid_request', message }, 400);
    default:
      // Never leak the underlying SQLSTATE/detail to the client.
      console.error('device api error', error.code);
      return jsonResponse(
        { error: 'server_error', message: 'Unexpected error.' },
        500,
      );
  }
}
