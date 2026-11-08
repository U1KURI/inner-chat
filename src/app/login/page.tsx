import { redirect } from "next/navigation";
import { ContactForm } from "@/components/ContactForm";
import { createClient } from "@/lib/supabase/server";

// A-06 ログイン
export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <main className="page">
      <div className="panel">
        <p className="logo">inner-chat</p>
        <div className="top">
          <h1>ログイン</h1>
        </div>
        <p className="muted small">登録したメールアドレスか電話番号に、確認コードを送ります。</p>
        <ContactForm purpose="login" />
        <p className="small muted">はじめての方は、届いた招待リンクから登録してください。</p>
      </div>
    </main>
  );
}
