import type { AitiProfile, DashboardLabels, StorageApi } from "../types";
import { SendToMenu } from "./SendToMenu";
import { buildAitiMarkdown } from "../lib/exploreMarkdown";

// AITI (个人内向探索): renders the locally-computed "thinking fingerprint" — a
// type code, four evidence-backed axis sliders, and the user's top obsessions.
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
  };

  if (!profile || !profile.available) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-10 text-center">
        <h3 className="text-[15px] font-medium text-text-primary">{labels.title}</h3>
        <p className="mt-2 max-w-md text-[13px] text-text-tertiary">{labels.insufficient}</p>
      </div>
    );
  }

  const typeCode = profile.axes
    .map((a) => {
      const meta = axisMeta[a.key];
      if (!meta) return null;
      return a.score >= 50 ? meta.right : meta.left;
    })
    .filter(Boolean)
    .join(labels.typeSeparator);

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-medium text-text-primary">{labels.title}</h3>
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
            {typeCode}
          </div>
          <div className="mt-1 text-[11.5px] text-text-tertiary">
            {labels.sample.replace("{n}", String(profile.sampleSize))}
          </div>
        </div>

        {/* Empowering strengths — the dominant pole of each axis, framed positively */}
        <div className="mt-5">
          <div className="text-[13px] font-medium text-text-primary">{labels.strengthsTitle}</div>
          <p className="mt-1 text-[12px] text-text-tertiary">{labels.empoweringIntro}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {profile.axes.map((axis) => {
              const meta = axisMeta[axis.key];
              if (!meta) return null;
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
            return (
              <div key={axis.key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[12px] font-medium text-text-secondary">{meta.label}</span>
                  <span className="text-[11px] text-text-tertiary">
                    {labels.evidence.replace("{n}", String(axis.evidenceConversationIds.length))}
                  </span>
                </div>
                <div className="relative h-1.5 rounded-full bg-bg-tertiary">
                  <div
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-primary"
                    style={{ left: `${axis.score}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-text-tertiary">
                  <span className={axis.score < 50 ? "font-medium text-text-secondary" : ""}>
                    {meta.left}
                  </span>
                  <span className={axis.score >= 50 ? "font-medium text-text-secondary" : ""}>
                    {meta.right}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

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
