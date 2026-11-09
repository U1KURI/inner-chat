import { signOut } from "@/app/auth/actions";
import { AppShell } from "@/components/AppShell";
import { requireMember } from "@/lib/member";

// F-01 マイページ（簡易版）
export default async function MePage() {
  const { profile } = await requireMember();
  return (
    <AppShell active="me">
      <div className="page-head">
        <h1>マイページ</h1>
      </div>
      <div className="card">
        <strong>{profile.display_name}</strong>
        {profile.bio && <p className="small muted">{profile.bio}</p>}
        {profile.role === "admin" && <span className="small muted">管理者</span>}
      </div>
      <p className="small muted">プロフィールや通知の設定は、今後追加します。</p>
      <form action={signOut}>
        <button type="submit" className="btn plain">
          ログアウト
        </button>
      </form>
    </AppShell>
  );
}
