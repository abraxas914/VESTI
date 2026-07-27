import type { AitiAxisScore, AitiProfile, DashboardLabels, StorageApi } from "../types";
import { SendToMenu } from "./SendToMenu";
import { buildAitiMarkdown } from "../lib/exploreMarkdown";

// Lightweight, dependency-free SVG radar of the AITI axes — a consistent
// accent-styled overview to complement the per-axis sliders. Supports any
// number of axes (3+) by computing vertex angles dynamically.
function AitiRadar({
  axes,
  axisMeta,
}: {
  axes: AitiAxisScore[];
  axisMeta: Record<string, { label: string; left: string; right: string }>;
}) {
  if (axes.length < 3) return null;
  const cx = 100;
  const cy = 100;
  const maxR = 60;
  const labelR = maxR * 1.22;
  const count = axes.length;
  const angleFor = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / count;
  const at = (frac: number, i: number) => {
    const a = angleFor(i);
    return {
      x: cx + frac * maxR * Math.cos(a),
      y: cy + frac * maxR * Math.sin(a),
    };
  };
  const labelAt = (i: number) => {
    const a = angleFor(i);
    return {
      x: cx + labelR * Math.cos(a),
      y: cy + labelR * Math.sin(a),
    };
  };
  const ring = (frac: number) =>
    axes.map((_, i) => { const p = at(frac, i); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(" ");
  const clampFrac = (score: number) => Math.max(0.04, Math.min(1, (score ?? 0) / 100));
  // No-signal axes sit at the neutral mid-ring (and carry no pole label) so the
  // shape doesn't assert a lean the data doesn't support.
  const fracFor = (a: AitiAxisScore) => (a.hasSignal === false ? 0.5 : clampFrac(a.score));
  const scorePts = axes
    .map((a, i) => { const p = at(fracFor(a), i); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; })
    .join(" ");
  const dots = axes.map((a, i) => at(fracFor(a), i));
  const labelsArr = axes.map((a, i) => {
    const meta = axisMeta[a.key];
    const p = labelAt(i);
    const dx = p.x - cx;
    const eps = 0.5;
    const anchor = dx > eps ? "start" : dx < -eps ? "end" : "middle";
    const dy = p.y - cy;
    const yOffset = dy < -eps ? -2 : dy > eps ? 7 : 3;
    return {
      x: p.x,
      y: p.y + yOffset,
      text: meta && a.hasSignal !== false ? (a.score >= 50 ? meta.right : meta.left) : "",
      anchor,
    };
  });
  return (
    <svg viewBox="-30 0 260 200" className="h-44 w-52" aria-hidden="true">
      {[0.33, 0.66, 1].map((f, gi) => (
        <polygon key={gi} points={ring(f)} fill="none" stroke="currentColor" strokeWidth={0.6} className="text-border-subtle" />
      ))}
      {axes.map((_, i) => {
        const p = at(1, i);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth={0.6} className="text-border-subtle" />;
      })}
      <polygon points={scorePts} fill="currentColor" fillOpacity={0.18} stroke="currentColor" strokeWidth={1.5} className="text-accent-primary" />
      {dots.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="currentColor" className="text-accent-primary" />
      ))}
      {labelsArr.map((l, i) => (
        l.text ? (
          <text key={i} x={l.x} y={l.y} fontSize={8.5} textAnchor={l.anchor} fill="currentColor" className="text-text-secondary">
            {l.text}
          </text>
        ) : null
      ))}
    </svg>
  );
}

// AITI (个人内向探索): renders the locally-computed "thinking fingerprint" — a
// type code, evidence-backed axis sliders, and the user's top obsessions.
// Presentational: the host computes the profile + passes localized labels.

interface AitiCardProps {
  profile?: AitiProfile;
  labels: DashboardLabels["aiti"];
  storage?: StorageApi;
  sendToLabels?: DashboardLabels["library"];
}

export function AitiCard({ profile, labels, storage, sendToLabels }: AitiCardProps) {
  type AxisMeta = {
    label: string;
    left: string;
    right: string;
    leftStrength: string;
    rightStrength: string;
  };
  const axisMeta: Record<string, AxisMeta> = {
    depth: {
      label: labels.axisDepthLabel,
      left: labels.axisDepthLeft,
      right: labels.axisDepthRight,
      leftStrength: labels.axisDepthLeftStrength,
      rightStrength: labels.axisDepthRightStrength,
    },
    maker: {
      label: labels.axisMakerLabel,
      left: labels.axisMakerLeft,
      right: labels.axisMakerRight,
      leftStrength: labels.axisMakerLeftStrength,
      rightStrength: labels.axisMakerRightStrength,
    },
    focus: {
      label: labels.axisFocusLabel,
      left: labels.axisFocusLeft,
      right: labels.axisFocusRight,
      leftStrength: labels.axisFocusLeftStrength,
      rightStrength: labels.axisFocusRightStrength,
    },
    affect: {
      label: labels.axisAffectLabel,
      left: labels.axisAffectLeft,
      right: labels.axisAffectRight,
      leftStrength: labels.axisAffectLeftStrength,
      rightStrength: labels.axisAffectRightStrength,
    },
    curiosity: {
      label: labels.axisCuriosityLabel,
      left: labels.axisCuriosityLeft,
      right: labels.axisCuriosityRight,
      leftStrength: labels.axisCuriosityLeftStrength,
      rightStrength: labels.axisCuriosityRightStrength,
    },
    interdisciplinary: {
      label: labels.axisInterdisciplinaryLabel,
      left: labels.axisInterdisciplinaryLeft,
      right: labels.axisInterdisciplinaryRight,
      leftStrength: labels.axisInterdisciplinaryLeftStrength,
      rightStrength: labels.axisInterdisciplinaryRightStrength,
    },
  };

  const confidenceLabel: Record<string, string> = {
    low: labels.confidenceLow,
    medium: labels.confidenceMedium,
    high: labels.confidenceHigh,
  };

  if (!profile || !profile.available) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-10 text-center">
        <h3
          data-onboarding-target="aiti-card"
          className="text-[15px] font-medium text-text-primary">{labels.title}</h3>
        <p className="mt-2 max-w-md text-[13px] text-text-tertiary">{labels.insufficient}</p>
        {labels.insufficientHint ? (
          <p className="mt-3 max-w-sm text-[12px] text-text-tertiary/70">{labels.insufficientHint}</p>
        ) : null}
      </div>
    );
  }

  const typeCode = profile.axes
    .map((a) => {
      const meta = axisMeta[a.key];
      // Don't fold an unsupported axis into the "type" — it would read as a
      // confident trait drawn from zero evidence.
      if (!meta || a.hasSignal === false) return null;
      return a.score >= 50 ? meta.right : meta.left;
    })
    .filter(Boolean)
    .join(labels.typeSeparator);

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div
          data-onboarding-target="aiti-card"
          className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-medium text-text-primary">{labels.title}</h3>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-text-tertiary">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 ${
                  profile.confidence === "low"
                    ? "bg-bg-tertiary text-text-tertiary"
                    : profile.confidence === "medium"
                      ? "bg-accent-primary-light text-accent-primary"
                      : "bg-green-500/10 text-green-600"
                }`}
              >
                {labels.confidenceLabel}: {confidenceLabel[profile.confidence] || profile.confidence}
              </span>
              <span>{labels.sample.replace("{n}", String(profile.sampleSize))}</span>
            </div>
          </div>
          {storage && sendToLabels ? (
            <SendToMenu
              storage={storage}
              labels={sendToLabels}
              payload={{ title: labels.title, markdown: buildAitiMarkdown(profile, labels) }}
            />
          ) : null}
        </div>

        <p className="mt-1 text-[12px] text-text-tertiary">{labels.subtitle}</p>

        {/* Type code */}
        <div className="mt-5 rounded-2xl border border-border-subtle bg-bg-surface-card p-5">
          <div className="text-[20px] font-semibold leading-snug tracking-tight text-text-primary">
            {typeCode || labels.axisNeedsSignal}
          </div>
          {profile.confidence === "low" ? (
            <div className="mt-2 text-[11.5px] text-text-tertiary">
              {labels.insufficientHint}
            </div>
          ) : null}
        </div>

        {/* Radar overview of the four axes */}
        <div className="mt-5 flex justify-center rounded-2xl border border-border-subtle bg-bg-surface-card py-4">
          <AitiRadar axes={profile.axes} axisMeta={axisMeta} />
        </div>

        {/* Empowering strengths — the dominant pole of each axis, framed positively */}
        <div className="mt-5">
          <div className="text-[13px] font-medium text-text-primary">{labels.strengthsTitle}</div>
          <p className="mt-1 text-[12px] text-text-tertiary">{labels.empoweringIntro}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {profile.axes.map((axis) => {
              const meta = axisMeta[axis.key];
              if (!meta) return null;
              if (axis.hasSignal === false) {
                return (
                  <li key={axis.key} className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary/40" />
                    <span className="text-[13px] leading-relaxed text-text-tertiary">
                      {meta.label} — {labels.axisNeedsSignal}
                    </span>
                  </li>
                );
              }
              const strength = axis.score >= 50 ? meta.rightStrength : meta.leftStrength;
              return (
                <li key={axis.key} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary" />
                  <span className="text-[13px] leading-relaxed text-text-primary">{strength}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Axes */}
        <div className="mt-5 flex flex-col gap-4">
          {profile.axes.map((axis) => {
            const meta = axisMeta[axis.key];
            if (!meta) return null;
            const muted = axis.hasSignal === false;
            return (
              <div key={axis.key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[12px] font-medium text-text-secondary">{meta.label}</span>
                  <span className="text-[11px] text-text-tertiary">
                    {muted
                      ? labels.axisNeedsSignal
                      : labels.evidence.replace("{n}", String(axis.evidenceConversationIds.length))}
                  </span>
                </div>
                <div className="relative h-1.5 rounded-full bg-bg-tertiary">
                  <div
                    className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                      muted ? "bg-text-tertiary/40" : "bg-accent-primary"
                    }`}
                    style={{ left: `${muted ? 50 : axis.score}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-text-tertiary">
                  <span className={!muted && axis.score < 50 ? "font-medium text-text-secondary" : ""}>
                    {meta.left}
                  </span>
                  <span className={!muted && axis.score >= 50 ? "font-medium text-text-secondary" : ""}>
                    {meta.right}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Trends */}
        {profile.trends && profile.trends.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[12px] font-medium text-text-secondary">{labels.trendsTitle}</div>
            <div className="flex flex-wrap gap-2">
              {profile.trends.map((t) => {
                const isRising = t.direction === "rising";
                const isFalling = t.direction === "falling";
                const label = isRising ? labels.trendRising : isFalling ? labels.trendFalling : labels.trendStable;
                return (
                  <span
                    key={t.key}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${
                      isRising
                        ? "border-green-500/20 bg-green-500/10 text-green-600"
                        : isFalling
                          ? "border-amber-500/20 bg-amber-500/10 text-amber-600"
                          : "border-border-subtle bg-bg-surface-card text-text-secondary"
                    }`}
                  >
                    <span className={isRising ? "rotate-0" : isFalling ? "rotate-180" : ""}>
                      {isRising || isFalling ? "↑" : "→"}
                    </span>
                    {axisMeta[t.key]?.label || t.key}: {label}
                    {t.delta > 0 ? ` +${t.delta}` : null}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Obsessions */}
        {profile.obsessions.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[12px] font-medium text-text-secondary">
              {labels.obsessionsTitle}
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.obsessions.map((o) => (
                <span
                  key={o.term}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface-card px-3 py-1 text-[12px] text-text-primary"
                >
                  {o.term}
                  <span className="text-[10.5px] text-text-tertiary">{o.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
