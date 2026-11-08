function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`環境変数 ${name} が設定されていません（.env.example を参照）`);
  return value;
}

// NEXT_PUBLIC_ の値はビルド時に埋め込まれるため、process.env.X を直接書く必要がある
export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const TERMS_VERSION = process.env.NEXT_PUBLIC_TERMS_VERSION ?? "2026-11-08";
