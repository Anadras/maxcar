import type { Database } from '@maxcar/shared/database-types';
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { getPublicSupabaseConfig } from './env';

const PUBLIC_PATHS = ['/login'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = getPublicSupabaseConfig();
  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
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
    urlToLogin.pathname = '/login';
    urlToLogin.searchParams.set(
      'next',
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(urlToLogin);
  }
  if (authenticated && request.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return response;
}
