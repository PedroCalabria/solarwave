"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client (only needed for optional client-side auth UX). */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
