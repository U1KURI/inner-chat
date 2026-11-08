import Link from "next/link";
import { ContactForm } from "@/components/ContactForm";
import { getInviteToken } from "@/lib/flow";

// A-02 連絡先入力（登録）
export default async function SignupPage() {
  const token = await getInviteToken();
  if (!token) {
    return (
      <main className="page">
        <div className="panel center">
          <p className="logo">inner-chat</p>
          <h2>inner-chat は招待制です</h2>
          <p className="muted">届いた招待リンクから開いてください。</p>
          <p className="small">
            すでに登録済みの方は <Link href="/login">ログイン</Link>
          </p>
        </div>
      </main>
    );
  }
  return (
    <main className="page">
      <div className="panel">
        <div className="top">
          <Link href={`/invite/${encodeURIComponent(token)}`} className="back" aria-label="戻る">
            ←
          </Link>
          <h1>登録</h1>
        </div>
        <p className="muted small">確認コードを送ります。パスワードは使いません。</p>
        <ContactForm purpose="signup" />
      </div>
    </main>
  );
}
