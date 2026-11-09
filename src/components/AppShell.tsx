import Link from "next/link";

type Tab = "consult" | "members" | "dm" | "me";

const TABS: { key: Tab; label: string; href: string | null }[] = [
  { key: "consult", label: "相談", href: "/" },
  { key: "members", label: "メンバー", href: null },
  { key: "dm", label: "DM", href: null },
  { key: "me", label: "マイ", href: "/me" },
];

// メンバー用画面の共通の枠：スマホは下部タブ、PC は左のメニュー
export function AppShell({ active, children }: { active: Tab; children: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="tabs" aria-label="メインメニュー">
        <span className="tabs-logo">inner-chat</span>
        {TABS.map((t) =>
          t.href ? (
            <Link key={t.key} href={t.href} className="tab" aria-current={active === t.key ? "page" : undefined}>
              {t.label}
            </Link>
          ) : (
            <span key={t.key} className="tab disabled" title="準備中">
              {t.label}
            </span>
          ),
        )}
      </nav>
      <main className="shell-main">{children}</main>
    </div>
  );
}
