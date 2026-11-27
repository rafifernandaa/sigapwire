import type { FormEvent } from "react";
import { MAX_INJECTED_AREA_FACTS } from "../lib/areaKnowledgeContext";
import type {
  AreaKnowledgeCategory,
  AreaKnowledgeDoc,
} from "../types/sigapwire";
import { CardListSkeleton } from "./ui";

interface AreaKnowledgePanelProps {
  areaKnowledge: AreaKnowledgeDoc[];
  knowledgeLoading: boolean;
  includedCount: number;
  estimatedTokens: number;
  injectedRankById: Map<string, number>;
  factInput: string;
  factCategory: AreaKnowledgeCategory;
  isAddingFact: boolean;
  factBusy: Record<string, boolean>;
  online: boolean;
  areaCategories: Array<{ value: AreaKnowledgeCategory; label: string }>;
  onChangeFactInput: (value: string) => void;
  onChangeFactCategory: (category: AreaKnowledgeCategory) => void;
  onAddDirectFact: (e: FormEvent) => void;
  onToggleFactActive: (fact: AreaKnowledgeDoc) => void;
}

export function AreaKnowledgePanel({
  areaKnowledge,
  knowledgeLoading,
  includedCount,
  estimatedTokens,
  injectedRankById,
  factInput,
  factCategory,
  isAddingFact,
  factBusy,
  online,
  areaCategories,
  onChangeFactInput,
  onChangeFactCategory,
  onAddDirectFact,
  onToggleFactActive,
}: AreaKnowledgePanelProps) {
  return (
    <div className="sw-card p-5 space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h2 className="text-base font-bold">
            Verified Area Knowledge ([AK-N] Prompt Memory)
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            Only human-confirmed facts enter prompt memory; unverified rumors and AI guesses are excluded.
          </p>
        </div>
        <span
          className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
          style={{
            backgroundColor: "var(--state-ondevice-bg)",
            color: "var(--state-ondevice-ink)",
            borderColor: "var(--state-ondevice-border)",
          }}
        >
          {includedCount}/{MAX_INJECTED_AREA_FACTS} active (~{estimatedTokens}{" "}
          est. tok)
        </span>
      </div>

      <form onSubmit={onAddDirectFact} className="space-y-3">
        <div>
          <label
            htmlFor="area-fact-input"
            className="block text-xs font-semibold mb-1"
          >
            Add Human-Verified Ground Truth
          </label>
          <input
            id="area-fact-input"
            type="text"
            value={factInput}
            onChange={(e) => onChangeFactInput(e.target.value)}
            placeholder="e.g. Sukamaju northern ring bridge max load is 3 tons for 4x4 vehicles"
            className="sw-input w-full min-h-[44px] px-3 text-sm"
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1">
            <label
              htmlFor="area-fact-category"
              className="block text-xs font-semibold mb-1"
            >
              Fact Category
            </label>
            <select
              id="area-fact-category"
              value={factCategory}
              onChange={(e) =>
                onChangeFactCategory(e.target.value as AreaKnowledgeCategory)
              }
              className="sw-input w-full min-h-[44px] px-3 text-xs"
            >
              {areaCategories.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={isAddingFact || !factInput.trim() || !online}
            className="sw-btn-cloud min-h-[44px] shrink-0 px-4 text-xs font-semibold"
          >
            {isAddingFact ? "Saving..." : "Save Ground Truth"}
          </button>
        </div>
      </form>

      {knowledgeLoading ? (
        <CardListSkeleton label="Loading verified area knowledge" rows={2} />
      ) : areaKnowledge.length === 0 ? (
        <p className="text-xs py-2" style={{ color: "var(--ink-muted)" }}>
          No Area Knowledge saved yet. Promote an answered Field Check or record a verified operational constraint above.
        </p>
      ) : (
        <ul className="space-y-2">
          {areaKnowledge.map((fact) => {
            const akRank = injectedRankById.get(fact.id);
            return (
              <li
                key={fact.id}
                className="sw-card-ground p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="font-mono-telemetry rounded px-1.5 py-0.5 text-xs font-bold border"
                      style={
                        fact.active
                          ? {
                              backgroundColor: "var(--state-ondevice-bg)",
                              color: "var(--state-ondevice-ink)",
                              borderColor: "var(--state-ondevice-border)",
                            }
                          : {
                              backgroundColor: "var(--bg-subtle)",
                              color: "var(--ink-muted)",
                              borderColor: "var(--border-subtle)",
                            }
                      }
                    >
                      {akRank
                        ? `[AK-${akRank}]`
                        : fact.active
                          ? "QUEUED"
                          : "PAUSED"}
                    </span>
                    <span
                      className="font-mono-telemetry text-xs"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      {fact.category} | {fact.sourceType}
                    </span>
                  </div>
                  <p className="text-sm leading-snug">{fact.fact}</p>
                </div>

                <button
                  type="button"
                  onClick={() => onToggleFactActive(fact)}
                  disabled={Boolean(factBusy[fact.id])}
                  className="sw-btn-secondary min-h-[44px] shrink-0 px-3 text-xs font-semibold"
                >
                  {fact.active ? "Pause" : "Activate"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
