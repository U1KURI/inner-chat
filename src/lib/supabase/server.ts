import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

// サーバーコンポーネント・サーバーアクション用の Supabase クライアント（ログイン状態は Cookie）
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // サーバーコンポーネントからは Cookie を書けない。セッション更新はミドルウェアが行う
        }
      },
    },
  });
}
