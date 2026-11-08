import { signOut } from "@/app/auth/actions";
// 招待のないアカウント・停止中のアカウント向けの案内
const TEXT: Record<string, { title: string; body: string }> = {
  not_invited: {
    title: "このアカウントには招待がありません",
    body: "inner-chat は招待制です。届いた招待リンクから、招待されたメールアドレスか電話番号で登録してください。",
  },
  suspended: {
    title: "このアカウントは利用が停止されています",
    body: "心当たりがない場合は、招待してくれた人や管理者に連絡してください。",
  },
  unknown: {
    title: "アカウントの情報を読み込めませんでした",
    body: "時間をおいてもう一度開いてください。",
  },
};

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const t = TEXT[reason ?? ""] ?? TEXT.unknown;
  return (
    <main className="page">
      <div className="panel center">
        <p className="logo">inner-chat</p>
        <h2>{t.title}</h2>
        <p className="muted">{t.body}</p>
        <form action={signOut}>
          <button type="submit" className="btn plain">
            ログアウト
          </button>
        </form>
      </div>
    </main>
  );
}
