import { redirect } from "next/navigation";
import { TERMS_VERSION } from "@/lib/env";
import { getTermsAccepted } from "@/lib/flow";
import { requireJoining } from "@/lib/member";
import { ProfileForm } from "./ProfileForm";

// A-05 初回プロフィール設定（1 / 2）
export default async function ProfilePage() {
  await requireJoining();
  if ((await getTermsAccepted()) !== TERMS_VERSION) redirect("/welcome/terms");
  return (
    <main className="page">
      <div className="panel">
        <div className="top">
          <h1>プロフィール</h1>
          <span className="step">1 / 2</span>
        </div>
        <ProfileForm />
      </div>
    </main>
  );
}
