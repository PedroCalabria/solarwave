import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const LOGIN_PATH = "/portal/login";

/**
 * Employee-auth spec: every `/portal/*` route except the login page requires a
 * Supabase session. The proxy refreshes the session cookie and redirects
 * anonymous requests; the role check happens in the Data Access Layer.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request });

  // Without Supabase configured there is no way to sign in; fail closed.
  if (!url || !anonKey) {
    if (pathname === LOGIN_PATH) return response;
    const redirect = new URL(LOGIN_PATH, request.url);
    redirect.searchParams.set("error", "auth_not_configured");
    return NextResponse.redirect(redirect);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Refreshes the token when needed and tells us whether a session exists.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && pathname !== LOGIN_PATH) {
    const redirect = new URL(LOGIN_PATH, request.url);
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  if (user && pathname === LOGIN_PATH) {
    return NextResponse.redirect(new URL("/portal/leads", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/portal/:path*"],
};
