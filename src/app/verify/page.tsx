import Link from "next/link";
import { redirect } from "next/navigation";
import { CodeForm } from "@/components/CodeForm";
import { contactLabel } from "@/lib/contact";
import { getOtpState } from "@/lib/flow";

// A-03 確認コード入力
export default async function VerifyPage() {
  const otp = await getOtpState();
  if (!otp) redirect("/login");
  const via = otp.contact.kind === "email" ? "メール" : "SMS";

  return (
    <main className="page">
      <div className="panel">
        <div className="top">
          <Link href={otp.purpose === "signup" ? "/signup" : "/login"} className="back" aria-label="戻る">
            ←
          </Link>
          <h1>確認コード</h1>
        </div>
        <p>
          <strong>{contactLabel(otp.contact)}</strong> に{via}で6桁のコードを送りました。
        </p>
        <CodeForm sentAt={otp.sentAt} />
      </div>
    </main>
  );
}
