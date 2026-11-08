import { requireJoining } from "@/lib/member";
import { TermsForm } from "./TermsForm";

// A-04 規約・AI 利用の同意
export default async function TermsPage() {
  const { status } = await requireJoining();
  return (
    <main className="page">
      <div className="panel">
        <div className="top">
          <h1>ご利用にあたって</h1>
        </div>
        {status.inviter && <p className="muted small">{status.inviter}さんからの招待で登録します。</p>}

        <section className="card">
          <h2>利用規約</h2>
          <ul className="small">
            <li>inner-chat は、招待されたメンバーだけが使える場所です。</li>
            <li>ここで知った相談内容や個人の情報を、外部に持ち出さないでください。</li>
            <li>お金のやり取りの仲介はしません。具体的な取り決めは当事者同士で行ってください。</li>
            <li>他のメンバーへの攻撃的な言動は禁止です。管理者が利用を停止することがあります。</li>
          </ul>
        </section>

        <section className="card">
          <h2>AI の利用について</h2>
          <p className="small">
            相談の本文とスレッドは、要約・タグ付け・議論の流れの整理のため、AI（Anthropic の Claude）に送られます。
          </p>
          <ul className="small">
            <li>「関係者のみ」の相談も対象です</li>
            <li>DM は送られません</li>
            <li>相談ごとに AI を使わない設定にできます</li>
            <li>送った内容が AI の学習に使われることはありません</li>
          </ul>
        </section>

        <TermsForm />
      </div>
    </main>
  );
}
