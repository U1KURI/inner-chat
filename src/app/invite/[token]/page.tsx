import Link from "next/link";
import { startSignup } from "@/app/invite/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { inviteProblemMessage } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

type Check = { ok: boolean; reason?: string; inviter?: string };

// A-01 招待ウェルカム ／ A-07 招待リンク無効
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_invite_link", { p_token: token });
  const check: Check = error ? { ok: false, reason: "error" } : (data as Check);

  if (!check.ok) {
    return (
      <main className="page">
        <div className="panel center">
          <p className="logo">inner-chat</p>
          <h2>{error ? "招待リンクを確認できませんでした" : inviteProblemMessage(check.reason)}</h2>
          <p className="muted">
            {error
              ? "時間をおいてもう一度開いてください。"
              : "招待してくれた人に、新しい招待リンクを送ってもらってください。"}
          </p>
          <p className="small">
            すでに登録済みの方は <Link href="/login">ログイン</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="panel center">
        <p className="logo">inner-chat</p>
        <h2>{check.inviter}さんから招待が届いています</h2>
        <p className="muted">知り合い同士で「できること」を持ち寄って、ちょっとした相談を気軽にできる場所です。</p>
        <div className="hint" style={{ textAlign: "left" }}>
          <ul>
            <li>パスワードは不要です</li>
            <li>アプリのインストールも不要です</li>
          </ul>
        </div>
        <form action={startSignup}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton pendingLabel="準備中…">はじめる</SubmitButton>
        </form>
        <p className="small">
          すでに登録済みの方は <Link href="/login">ログイン</Link>
        </p>
      </div>
    </main>
  );
}
