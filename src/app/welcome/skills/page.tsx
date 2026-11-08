import { requireMember } from "@/lib/member";
import { SkillsForm } from "./SkillsForm";

// A-05 初回プロフィール設定（2 / 2）：できること
export default async function SkillsPage() {
  const { supabase } = await requireMember();
  const { data } = await supabase.from("tags").select("name, merged_into_id, profile_skills(count)");
  const popular = (data ?? [])
    .filter((t) => !t.merged_into_id)
    .map((t) => ({ name: t.name as string, count: (t.profile_skills as { count: number }[])[0]?.count ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 16)
    .map((t) => t.name);

  return (
    <main className="page">
      <div className="panel">
        <div className="top">
          <h1>プロフィール</h1>
          <span className="step">2 / 2</span>
        </div>
        <div>
          <h2>あなたの「できること」を教えてください</h2>
          <p className="small muted">あとからいつでも追加・変更できます。</p>
        </div>
        <SkillsForm popular={popular} />
      </div>
    </main>
  );
}
