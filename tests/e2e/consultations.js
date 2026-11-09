// 相談一覧・投稿・関係者招待の受信 の通しテスト（seed-consultations.sql を入れた DB で実行）
const { chromium } = require("playwright");
const S = process.env.SHOTS_DIR || ".";
const BASE = "http://127.0.0.1:3100";
let n = 0;
const ok = (c, label) => { if (!c) throw new Error("FAIL: " + label); console.log("OK", ++n, label); };

(async () => {
  const browser = await chromium.launch();
  const shot = (page, name) => page.screenshot({ path: `${S}/${name}.png`, fullPage: true });
  async function login(email, viewport = { width: 390, height: 844 }) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "ja-JP" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/login");
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByRole("button", { name: "確認コードを送る" }).click();
    await page.waitForURL("**/verify");
    await page.getByLabel("確認コード（6桁）").fill("123456");
    await page.getByRole("button", { name: "確認する" }).click();
    await page.waitForURL(BASE + "/");
    return { ctx, page };
  }

  // 佐藤：最初は空 → 全体公開で投稿
  let { ctx, page } = await login("sato@example.com");
  ok(await page.getByText("まだ相談はありません").isVisible(), "empty state");
  await page.getByRole("link", { name: "＋ 相談する" }).click();
  await page.waitForURL("**/consultations/new");
  await page.getByLabel("タイトル").fill("店のWebサイトをなんとかしたい");
  await page.getByLabel("内容（ふわっとで大丈夫です）").fill("小さな飲食店をやっています。\n今のサイトが古くて、スマホで見づらいと言われます。");
  await page.getByLabel("タグ（任意）").fill("Web制作");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByLabel("タグ（任意）").fill("マーケ");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "投稿する" }).click();
  await page.waitForURL(/\/consultations\/[0-9a-f-]{36}$/);
  ok(await page.getByRole("heading", { name: "店のWebサイトをなんとかしたい" }).isVisible(), "redirected to detail");
  ok(await page.getByText("🌐 全体公開").isVisible(), "public chip");
  ok(await page.getByText("このような項目があれば").isVisible(), "map shows checklist while collecting");
  ok(await page.getByText("#マーケ").isVisible(), "tags shown");
  await shot(page, "c03-detail");

  // 関係者のみ：関係者を選ばずに投稿 → エラー
  await page.goto(BASE + "/consultations/new");
  await page.getByLabel("タイトル").fill("家族のことで相談");
  await page.getByText("🔒 関係者のみ").click();
  ok(await page.getByText("調整や仲裁が必要になった場合に備えて").isVisible(), "admin-view text appears for restricted");
  ok(await page.getByLabel(/管理者の閲覧を許可する/).isChecked(), "admin view checked by default");
  await page.getByRole("button", { name: "投稿する" }).click();
  await page.getByText("関係者を1人以上選んでください").waitFor();
  ok(true, "restricted without members rejected");
  ok((await page.getByLabel("タイトル").inputValue()) === "家族のことで相談", "title kept after validation error");
  // 中村をタグ検索で選ぶ、管理者閲覧オフ、AI オフ
  await page.getByLabel("関係者を選ぶ（0人選択中）").fill("デザイン");
  ok(!(await page.getByText("高橋").isVisible()), "search filters by tag");
  await page.getByLabel(/中村/).check();
  await page.getByLabel(/管理者の閲覧を許可する/).uncheck();
  await page.getByLabel(/AI を使う/).uncheck();
  ok(await page.getByText("この相談は AI に送られません").isVisible(), "AI-off text switches");
  await shot(page, "c02-new-restricted");
  await page.getByRole("button", { name: "投稿する" }).click();
  await page.waitForURL(/\/consultations\/[0-9a-f-]{36}$/);
  const restrictedUrl = page.url();
  ok(await page.getByText("🔒 関係者のみ 1人").isVisible(), "restricted chip with author only");
  ok(await page.getByText("承認待ち：中村").isVisible(), "pending invitee listed");
  ok(await page.getByText("管理者閲覧：不可").isVisible(), "admin view off");
  ok(await page.getByText("この相談は AI を使わない設定です").isVisible(), "map disabled when AI off");

  await page.goto(BASE + "/");
  ok((await page.locator(".consult-card").count()) === 2, "author sees both in list");
  await page.getByRole("link", { name: "自分の" }).click();
  await page.waitForURL("**/?f=mine");
  ok((await page.locator(".consult-card").count()) === 2, "mine filter");
  await page.goto(BASE + "/");
  await shot(page, "c01-list");
  await ctx.close();

  // 高橋：全体公開だけ見える
  ({ ctx, page } = await login("takahashi@example.com"));
  ok(await page.getByText("店のWebサイトをなんとかしたい").isVisible(), "other member sees public post");
  ok(!(await page.getByText("家族のことで相談").isVisible()), "other member does not see restricted post");
  await page.goto(restrictedUrl);
  ok(await page.getByText("相談が見つかりません").isVisible(), "restricted detail blocked for non-member");
  await page.goto(BASE + "/?s=resolved");
  ok(await page.getByText("条件に合う相談はありません").isVisible(), "status filter");
  await ctx.close();

  // 中村：招待のバナー → 参加
  ({ ctx, page } = await login("nakamura@example.com"));
  ok(await page.getByText("関係者招待が1件届いています").isVisible(), "invitation banner");
  await page.getByText("関係者招待が1件届いています").click();
  await page.waitForURL("**/invitations/**");
  ok(await page.getByText("佐藤さんから招待が届いています").isVisible(), "invitation preview");
  ok(await page.getByText("本文とスレッドは参加後に見られます").isVisible(), "body hidden before accept");
  ok(!(await page.getByText("少し込み入った").isVisible()), "no body text in preview");
  await shot(page, "c04-invitation");
  await page.getByRole("button", { name: "参加する" }).click();
  await page.waitForURL("**/?f=member");
  ok(await page.getByText("家族のことで相談").isVisible(), "restricted post listed after accept");
  await page.getByText("家族のことで相談").click();
  await page.waitForURL(restrictedUrl);
  ok(await page.getByText("関係者：佐藤・中村").isVisible(), "member list after accept");
  ok(!(await page.getByText("関係者招待が").isVisible()), "banner gone");
  await ctx.close();

  // 山田（管理者）：管理者閲覧オフの相談は一覧にも詳細にも出ない
  ({ ctx, page } = await login("yamada@example.com", { width: 1280, height: 800 }));
  ok(!(await page.getByText("家族のことで相談").isVisible()), "admin feed excludes restricted");
  await shot(page, "c05-list-desktop");
  await page.goto(restrictedUrl);
  ok(await page.getByText("相談が見つかりません").isVisible(), "admin blocked when admin view off");
  await ctx.close();

  await browser.close();
  console.log("E2E PASSED", n);
})().catch((e) => { console.error(e.message); process.exit(1); });
