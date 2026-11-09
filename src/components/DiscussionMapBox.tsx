import { DEFAULT_MISSING_ITEMS, PHASE_SHORT, relativeTime, type DiscussionMap } from "@/lib/consultations";

function PhaseBar({ phase }: { phase: number | null }) {
  return (
    <ol className={`phase${phase ? "" : " unknown"}`} aria-label={phase ? `現在地：${PHASE_SHORT[phase - 1]}` : "現在地：未判定"}>
      {PHASE_SHORT.map((label, i) => {
        const n = i + 1;
        const cls = phase ? (n < phase ? "done" : n === phase ? "now" : "") : "";
        return (
          <li key={label} className={cls} aria-current={n === phase ? "step" : undefined}>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "text" in v) return String((v as { text: unknown }).text);
  return "";
}

// 議論マップ（材料集め中 / 生成済み / AI オフ）
export function DiscussionMapBox({ map }: { map: DiscussionMap | null }) {
  if (!map || map.state === "disabled") {
    return (
      <section className="map" aria-label="議論マップ">
        <div className="map-head">
          <span>📍 議論マップ</span>
          <span className="chip">AI オフ</span>
        </div>
        <p className="small muted">この相談は AI を使わない設定です。投稿者・関係者による手入力は、今後追加します。</p>
      </section>
    );
  }

  if (map.state === "collecting") {
    const items = map.missing_items.length > 0 ? map.missing_items : DEFAULT_MISSING_ITEMS;
    return (
      <section className="map empty" aria-label="議論マップ">
        <div className="map-head">
          <span>📍 議論マップ</span>
        </div>
        <p className="small">このような項目があれば、議論の流れや全体感と現在位置を出せます</p>
        <ul className="checklist">
          {items.map((it) => (
            <li key={it.key} className={it.ok ? "ok" : ""}>
              <span aria-hidden>{it.ok ? "☑" : "☐"}</span> {it.label}
            </li>
          ))}
        </ul>
        <PhaseBar phase={null} />
      </section>
    );
  }

  return (
    <section className="map" aria-label="議論マップ">
      <div className="map-head">
        <span>📍 議論マップ</span>
        <span className="small muted">{relativeTime(map.updated_at)}に更新</span>
      </div>
      {map.goal && (
        <dl className="map-dl">
          <dt>ゴール</dt>
          <dd>{map.goal}</dd>
        </dl>
      )}
      <PhaseBar phase={map.phase} />
      <dl className="map-dl">
        {map.flow.length > 0 && (
          <>
            <dt>流れ</dt>
            <dd>
              <ol>{map.flow.map((f, i) => <li key={i}>{asText(f)}</li>)}</ol>
            </dd>
          </>
        )}
        {map.decided.length > 0 && (
          <>
            <dt>決まった</dt>
            <dd>{map.decided.map(asText).join("／")}</dd>
          </>
        )}
        {map.open_issues.length > 0 && (
          <>
            <dt>未決</dt>
            <dd>{map.open_issues.map(asText).join("／")}</dd>
          </>
        )}
        {map.next_steps.length > 0 && (
          <>
            <dt>次の一歩</dt>
            <dd>{map.next_steps.map(asText).join("／")}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
