import type { Database } from '@maxcar/shared/database-types';
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { getPublicSupabaseConfig } from './env';

const PUBLIC_PATHS = ['/login'];

function redirectWithSession(url: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  ['cache-control', 'expires', 'pragma'].forEach((header) => {
    const value = response.headers.get(header);
    if (value) redirectResponse.headers.set(header, value);
  });
  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = getPublicSupabaseConfig();
  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const authenticated = Boolean(data?.claims?.sub);
  const isPublic = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (!authenticated && !isPublic) {
    const urlToLogin = request.nextUrl.clone();
    const intendedDestination = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    urlToLogin.pathname = '/login';
    urlToLogin.search = '';
    urlToLogin.searchParams.set('next', intendedDestination);
    return redirectWithSession(urlToLogin, response);
  }
  if (authenticated && request.nextUrl.pathname === '/login') {
    return redirectWithSession(new URL('/', request.url), response);
  }
  return response;
}
