import {
  addDoc,
  collection,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { ensureAnonymousAuth, getFirebaseBundle } from "./firebase";
import type {
  DispatchDoc,
  GroundingSource,
  HazardType,
  IncidentDoc,
  IntakeDoc,
  SeverityLevel,
} from "../types/sigapwire";

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  return new Date();
}

function clampString(val: string | undefined, maxLen: number, fallback = "N/A"): string {
  const cleaned = (val ?? "").trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

function clampStringList(arr: string[] | undefined, maxItems = 20): string[] {
  return (arr ?? [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeSources(sources: GroundingSource[] | undefined): GroundingSource[] {
  return (sources ?? [])
    .filter(
      (s) =>
        s &&
        typeof s.uri === "string" &&
        /^https?:\/\/\S+$/.test(s.uri.trim()) &&
        s.uri.trim().length <= 4096,
    )
    .slice(0, 15)
    .map((s) => ({
      title: clampString(s.title, 300, "Source"),
      uri: s.uri.trim(),
    }));
}

function sanitizeOptionalHtml(html: string | null | undefined): string | null {
  if (!html || typeof html !== "string") return null;
  if (html.length > 32768) return null;
  return html;
}

export const DEFAULT_DEMO_INCIDENT_ID = "inc_westjava_drill_2026";

export async function setFirestoreNetworkEnabled(enabled: boolean): Promise<void> {
  const { db } = getFirebaseBundle();
  await (enabled ? enableNetwork(db) : disableNetwork(db));
}

export async function ensureDemoIncidentExists(): Promise<string> {
  const user = await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();
  const ref = doc(db, "incidents", DEFAULT_DEMO_INCIDENT_ID);

  // Only create if missing so secondary responder sessions never attempt a non-owner update.
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await setDoc(ref, {
      title: "West Java M6.2 Earthquake (Synthetic Drill)",
      hazardType: "EARTHQUAKE" satisfies HazardType,
      region: "Cianjur & Bandung Raya, West Java, Indonesia",
      severity: "HIGH" satisfies SeverityLevel,
      status: "ACTIVE",
      isSyntheticDemo: true,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  return DEFAULT_DEMO_INCIDENT_ID;
}

export function subscribeIncidents(
  onUpdate: (incidents: IncidentDoc[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseBundle();
  const q = query(collection(db, "incidents"), orderBy("updatedAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const items: IncidentDoc[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: String(data.title ?? ""),
          hazardType: (data.hazardType ?? "OTHER") as HazardType,
          region: String(data.region ?? ""),
          severity: (data.severity ?? "MEDIUM") as SeverityLevel,
          status: data.status ?? "ACTIVE",
          isSyntheticDemo: Boolean(data.isSyntheticDemo),
          createdBy: String(data.createdBy ?? ""),
          createdAt: toDate(data.createdAt),
          updatedAt: toDate(data.updatedAt),
        };
      });
      onUpdate(items);
    },
    (err) => onError(err),
  );
}

export function subscribeIntakes(
  incidentId: string,
  onUpdate: (intakes: IntakeDoc[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseBundle();
  // Query by incidentId only (automatic single-field index) and sort client-side
  // so fresh Firebase projects work immediately without waiting for composite indexes.
  const q = query(
    collection(db, "intakes"),
    where("incidentId", "==", incidentId),
  );
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const items: IntakeDoc[] = snap.docs
        .map((d) => {
          const data = d.data({ serverTimestamps: "estimate" });
          return {
            id: d.id,
            incidentId: String(data.incidentId ?? ""),
            mode: data.mode ?? "FIELD_REPORT",
            sourcePlatform: data.sourcePlatform ?? "WEB",
            inferenceSource: data.inferenceSource ?? "IN_CLOUD",
            inferenceModeRequested:
              data.inferenceModeRequested ?? "PREFER_ON_DEVICE",
            latencyMs: Number(data.latencyMs ?? 0),
            piiRedactedLocally: Boolean(data.piiRedactedLocally),
            redactionCount: Number(data.redactionCount ?? 0),
            sanitizedText: String(data.sanitizedText ?? ""),
            hasAttachment: Boolean(data.hasAttachment),
            structured: data.structured,
            status: data.status ?? "TRIAGED",
            createdBy: String(data.createdBy ?? ""),
            createdAt: toDate(data.createdAt),
            pendingSync: d.metadata.hasPendingWrites,
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      onUpdate(items);
    },
    (err) => onError(err),
  );
}

export function subscribeDispatches(
  incidentId: string | null,
  onUpdate: (dispatches: DispatchDoc[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseBundle();
  const q = incidentId
    ? query(
        collection(db, "dispatches"),
        where("incidentId", "==", incidentId),
      )
    : query(collection(db, "dispatches"), orderBy("publishedAt", "desc"));

  return onSnapshot(
    q,
    (snap) => {
      const items: DispatchDoc[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            incidentId: String(data.incidentId ?? ""),
            dispatchNumber: Number(data.dispatchNumber ?? 1),
            severity: (data.severity ?? "HIGH") as SeverityLevel,
            sourceIntakeIds: Array.isArray(data.sourceIntakeIds)
              ? data.sourceIntakeIds
              : [],
            inferenceSource: data.inferenceSource ?? "IN_CLOUD",
            communityAlertId: data.communityAlertId,
            mediaPressReleaseId: data.mediaPressReleaseId,
            globalSitrepEn: data.globalSitrepEn,
            debunkCard: data.debunkCard,
            groundingSearchHtml: data.groundingSearchHtml ?? null,
            publishedBy: String(data.publishedBy ?? ""),
            publishedAt: toDate(data.publishedAt),
          };
        })
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      onUpdate(items);
    },
    (err) => onError(err),
  );
}

export async function saveIntakeToFirestore(
  intake: Omit<IntakeDoc, "id" | "createdBy" | "createdAt" | "pendingSync">,
): Promise<{ id: string; serverAck: Promise<void> }> {
  const user = await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();

  const payload = {
    incidentId: intake.incidentId,
    mode: intake.mode,
    sourcePlatform: intake.sourcePlatform,
    inferenceSource: intake.inferenceSource,
    inferenceModeRequested: intake.inferenceModeRequested,
    latencyMs: Math.max(0, Math.min(600000, Math.round(intake.latencyMs))),
    piiRedactedLocally: Boolean(intake.piiRedactedLocally),
    redactionCount: Math.max(0, Math.min(500, Math.round(intake.redactionCount))),
    sanitizedText: clampString(intake.sanitizedText, 5000, "[Empty intake]"),
    hasAttachment: Boolean(intake.hasAttachment),
    structured: {
      headline: clampString(intake.structured.headline, 300, "Crisis Intake"),
      hazardType: intake.structured.hazardType,
      location: clampString(intake.structured.location, 200, "Indonesia"),
      severity: intake.structured.severity,
      summaryId: clampString(intake.structured.summaryId, 2000, "Ringkasan sedang diproses."),
      summaryEn: clampString(intake.structured.summaryEn, 2000, "Summary in progress."),
      keyFacts: clampStringList(intake.structured.keyFacts),
      urgentNeeds: clampStringList(intake.structured.urgentNeeds),
      verificationGaps: clampStringList(intake.structured.verificationGaps),
      rumorVerdict: intake.structured.rumorVerdict,
      panicSignals: clampStringList(intake.structured.panicSignals),
      groundingSources: sanitizeSources(intake.structured.groundingSources),
      searchEntryPointHtml: sanitizeOptionalHtml(
        intake.structured.searchEntryPointHtml,
      ),
    },
    status: intake.status,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  };

  const ref = doc(collection(db, "intakes"));
  const serverAck = setDoc(ref, payload);
  return { id: ref.id, serverAck };
}

export async function markIntakesIncluded(intakes: IntakeDoc[]): Promise<void> {
  const eligible = intakes.filter((i) => i.status !== "INCLUDED_IN_DISPATCH");
  if (eligible.length === 0) return;

  await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();
  await Promise.all(
    eligible.map((item) =>
      updateDoc(doc(db, "intakes", item.id), {
        status: "INCLUDED_IN_DISPATCH",
        updatedAt: serverTimestamp(),
      }),
    ),
  );
}

export async function publishDispatchToFirestore(
  dispatch: Omit<DispatchDoc, "id" | "publishedBy" | "publishedAt">,
): Promise<string> {
  const user = await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();

  const hasRumor = Boolean(dispatch.debunkCard.hasRumorAlert);
  const payload = {
    incidentId: dispatch.incidentId,
    dispatchNumber: Math.max(1, Math.min(100000, Math.round(dispatch.dispatchNumber))),
    severity: dispatch.severity,
    sourceIntakeIds: dispatch.sourceIntakeIds.slice(0, 30),
    inferenceSource: dispatch.inferenceSource,
    communityAlertId: {
      title: clampString(dispatch.communityAlertId.title, 300),
      whatHappened: clampString(dispatch.communityAlertId.whatHappened, 3000),
      doNow: clampStringList(dispatch.communityAlertId.doNow),
      avoid: clampStringList(dispatch.communityAlertId.avoid),
      whatsappShortText: clampString(dispatch.communityAlertId.whatsappShortText, 2000),
    },
    mediaPressReleaseId: {
      headline: clampString(dispatch.mediaPressReleaseId.headline, 300),
      dateline: clampString(dispatch.mediaPressReleaseId.dateline, 200),
      body: clampString(dispatch.mediaPressReleaseId.body, 10000),
      keyMetrics: clampStringList(dispatch.mediaPressReleaseId.keyMetrics),
    },
    globalSitrepEn: {
      headline: clampString(dispatch.globalSitrepEn.headline, 300),
      executiveSummary: clampString(dispatch.globalSitrepEn.executiveSummary, 5000),
      impactOverview: clampStringList(dispatch.globalSitrepEn.impactOverview),
      priorityNeeds: clampStringList(dispatch.globalSitrepEn.priorityNeeds),
      informationGaps: clampStringList(dispatch.globalSitrepEn.informationGaps),
    },
    debunkCard: {
      hasRumorAlert: hasRumor,
      verdict: hasRumor
        ? dispatch.debunkCard.verdict === "NOT_APPLICABLE"
          ? "UNVERIFIED_DEVELOPING"
          : dispatch.debunkCard.verdict
        : "NOT_APPLICABLE",
      claim: hasRumor
        ? clampString(dispatch.debunkCard.claim, 1000, "Unverified rumor claim")
        : (dispatch.debunkCard.claim ?? "").slice(0, 1000),
      factId: hasRumor
        ? clampString(dispatch.debunkCard.factId, 2000, "Belum terkonfirmasi.")
        : (dispatch.debunkCard.factId ?? "").slice(0, 2000),
      factEn: hasRumor
        ? clampString(dispatch.debunkCard.factEn, 2000, "Unconfirmed.")
        : (dispatch.debunkCard.factEn ?? "").slice(0, 2000),
      sources: sanitizeSources(dispatch.debunkCard.sources),
    },
    groundingSearchHtml: sanitizeOptionalHtml(dispatch.groundingSearchHtml),
    publishedBy: user.uid,
    publishedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "dispatches"), payload);
  return ref.id;
}
