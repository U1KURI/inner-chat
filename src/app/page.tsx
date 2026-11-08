import { signOut } from "@/app/auth/actions";
import { requireMember } from "@/lib/member";

// 相談一覧（B-01）を作るまでの仮のホーム
export default async function Home() {
  const { profile } = await requireMember();
  return (
    <main className="page">
      <div className="panel">
        <div className="top">
          <h1>相談</h1>
        </div>
        <div className="card">
          <h2>ようこそ、{profile.display_name}さん</h2>
          <p className="muted">登録とログインが完了しました。相談一覧はこれから作ります。</p>
          {profile.role === "admin" && <p className="small muted">あなたは管理者です。</p>}
        </div>
        <form action={signOut}>
          <button type="submit" className="btn plain">
            ログアウト
          </button>
        </form>
      </div>
    </main>
  );
}
