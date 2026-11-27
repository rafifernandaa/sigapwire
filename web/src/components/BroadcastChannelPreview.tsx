import type { SynthesizedBroadcastResult } from "../lib/hybridAi";
import { VerdictBadge } from "./StatusBadges";
import { handleTabListKeyDown } from "./ui";

export type AudienceTab = "community" | "media" | "global" | "debunk";

const AUDIENCE_TABS: readonly AudienceTab[] = [
  "community",
  "media",
  "global",
  "debunk",
];

const AUDIENCE_LABELS: Record<AudienceTab, string> = {
  community: "Community Alert (ID)",
  media: "Media Release (ID)",
  global: "Global SitRep (EN)",
  debunk: "Debunk Card (ID/EN)",
};

interface BroadcastChannelPreviewProps {
  draft: SynthesizedBroadcastResult;
  activeTab: AudienceTab;
  copiedKey: string | null;
  onSelectTab: (tab: AudienceTab) => void;
  onCopy: (key: string, text: string) => void;
}

export function BroadcastChannelPreview({
  draft,
  activeTab,
  copiedKey,
  onSelectTab,
  onCopy,
}: BroadcastChannelPreviewProps) {
  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Broadcast audience channels"
        className="flex flex-wrap gap-1.5 border-b pb-3"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {AUDIENCE_TABS.map((id) => {
          const selected = activeTab === id;
          return (
            <button
              key={id}
              id={`studio-audience-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="studio-audience-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectTab(id)}
              onKeyDown={(e) =>
                handleTabListKeyDown(
                  e,
                  AUDIENCE_TABS,
                  activeTab,
                  onSelectTab,
                  "studio-audience",
                )
              }
              className="sw-tab min-h-[44px] px-3 py-1.5 text-xs font-semibold"
            >
              {AUDIENCE_LABELS[id]}
            </button>
          );
        })}
      </div>

      <div
        id="studio-audience-panel"
        role="tabpanel"
        aria-labelledby={`studio-audience-tab-${activeTab}`}
      >
        {activeTab === "community" ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-editorial text-lg font-bold">
                {draft.communityAlertId.title}
              </h3>
              <button
                type="button"
                onClick={() =>
                  onCopy("wa", draft.communityAlertId.whatsappShortText)
                }
                className="sw-btn-secondary min-h-[44px] shrink-0 px-3 text-xs font-semibold"
              >
                {copiedKey === "wa" ? "Copied" : "Copy WhatsApp Alert"}
              </button>
            </div>
            <p className="leading-relaxed">
              {draft.communityAlertId.whatHappened}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                className="rounded-md border p-3"
                style={{
                  backgroundColor: "var(--state-ondevice-bg)",
                  borderColor: "var(--state-ondevice-border)",
                  color: "var(--state-ondevice-ink)",
                }}
              >
                <strong className="block text-xs mb-1.5">
                  LAKUKAN SEKARANG (DO NOW)
                </strong>
                <ul className="list-disc pl-4 space-y-1 text-xs">
                  {draft.communityAlertId.doNow.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
              <div
                className="rounded-md border p-3"
                style={{
                  backgroundColor: "var(--state-critical-bg)",
                  borderColor: "var(--state-critical-border)",
                  color: "var(--state-critical-ink)",
                }}
              >
                <strong className="block text-xs mb-1.5">
                  HINDARI (AVOID)
                </strong>
                <ul className="list-disc pl-4 space-y-1 text-xs">
                  {draft.communityAlertId.avoid.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "media" ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p
                  className="font-mono-telemetry text-xs"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {draft.mediaPressReleaseId.dateline}
                </p>
                <h3 className="font-editorial text-lg font-bold mt-1">
                  {draft.mediaPressReleaseId.headline}
                </h3>
              </div>
              <button
                type="button"
                onClick={() =>
                  onCopy(
                    "pr",
                    `${draft.mediaPressReleaseId.headline}\n${draft.mediaPressReleaseId.dateline}\n\n${draft.mediaPressReleaseId.body}`,
                  )
                }
                className="sw-btn-secondary min-h-[44px] shrink-0 px-3 text-xs font-semibold"
              >
                {copiedKey === "pr" ? "Copied" : "Copy Press Release"}
              </button>
            </div>
            <p className="leading-relaxed whitespace-pre-wrap">
              {draft.mediaPressReleaseId.body}
            </p>
            {draft.mediaPressReleaseId.keyMetrics.length > 0 ? (
              <ul className="list-disc pl-5 text-xs space-y-1">
                {draft.mediaPressReleaseId.keyMetrics.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {activeTab === "global" ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-editorial text-lg font-bold">
                {draft.globalSitrepEn.headline}
              </h3>
              <button
                type="button"
                onClick={() =>
                  onCopy(
                    "sitrep",
                    `${draft.globalSitrepEn.headline}\n\n${draft.globalSitrepEn.executiveSummary}\n\nPriority Needs:\n- ${draft.globalSitrepEn.priorityNeeds.join("\n- ")}`,
                  )
                }
                className="sw-btn-secondary min-h-[44px] shrink-0 px-3 text-xs font-semibold"
              >
                {copiedKey === "sitrep" ? "Copied" : "Copy Global SitRep"}
              </button>
            </div>
            <p className="leading-relaxed">
              {draft.globalSitrepEn.executiveSummary}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <strong className="block mb-1">Impact Overview</strong>
                <ul className="list-disc pl-4 space-y-1">
                  {draft.globalSitrepEn.impactOverview.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong className="block mb-1">Priority Needs</strong>
                <ul className="list-disc pl-4 space-y-1">
                  {draft.globalSitrepEn.priorityNeeds.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong className="block mb-1">Information Gaps</strong>
                <ul className="list-disc pl-4 space-y-1">
                  {draft.globalSitrepEn.informationGaps.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "debunk" ? (
          <div className="space-y-3 text-sm">
            {!draft.debunkCard.hasRumorAlert ? (
              <p style={{ color: "var(--ink-muted)" }}>
                No rumor-check intakes were included in this selection. Select a Rumor Check intake to generate a bilingual Debunk Card.
              </p>
            ) : (
              <>
                <VerdictBadge verdict={draft.debunkCard.verdict} />
                <p className="font-semibold">Claim: {draft.debunkCard.claim}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="sw-card-ground p-3">
                    <strong className="block mb-1">Klarifikasi (ID)</strong>
                    <p>{draft.debunkCard.factId}</p>
                  </div>
                  <div className="sw-card-ground p-3">
                    <strong className="block mb-1">Clarification (EN)</strong>
                    <p>{draft.debunkCard.factEn}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
