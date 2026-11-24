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
  AreaKnowledgeCategory,
  AreaKnowledgeDoc,
  AreaKnowledgeSourceType,
  DispatchDoc,
  GroundingSource,
  HazardType,
  IncidentDoc,
  IntakeDoc,
  RumorVerdict,
  SeverityLevel,
  SourcePlatform,
  StructuredIntakeData,
  VerificationTaskDoc,
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

function sanitizeStructured(s: StructuredIntakeData) {
  return {
    headline: clampString(s.headline, 300, "Crisis Intake"),
    hazardType: s.hazardType,
    location: clampString(s.location, 200, "Indonesia"),
    severity: s.severity,
    summaryId: clampString(s.summaryId, 2000, "Ringkasan sedang diproses."),
    summaryEn: clampString(s.summaryEn, 2000, "Summary in progress."),
    keyFacts: clampStringList(s.keyFacts),
    urgentNeeds: clampStringList(s.urgentNeeds),
    verificationGaps: clampStringList(s.verificationGaps),
    rumorVerdict: s.rumorVerdict,
    panicSignals: clampStringList(s.panicSignals),
    groundingSources: sanitizeSources(s.groundingSources),
    searchEntryPointHtml: sanitizeOptionalHtml(s.searchEntryPointHtml),
  };
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
    structured: sanitizeStructured(intake.structured),
    status: intake.status,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  };

  const ref = doc(collection(db, "intakes"));
  const serverAck = setDoc(ref, payload);
  return { id: ref.id, serverAck };
}

export async function updateIntakeVerification(
  intakeId: string,
  v: {
    verdict: RumorVerdict;
    factId: string;
    factEn: string;
    sources: GroundingSource[];
    searchEntryPointHtml: string | null;
  },
): Promise<void> {
  await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();
  await updateDoc(doc(db, "intakes", intakeId), {
    "structured.rumorVerdict": v.verdict,
    "structured.summaryId": clampString(v.factId, 2000, ""),
    "structured.summaryEn": clampString(v.factEn, 2000, ""),
    "structured.groundingSources": sanitizeSources(v.sources),
    "structured.searchEntryPointHtml": sanitizeOptionalHtml(
      v.searchEntryPointHtml,
    ),
    status: "VERIFIED",
    updatedAt: serverTimestamp(),
  });
}

export async function updateIntakeCloudTriage(
  intakeId: string,
  structured: StructuredIntakeData,
  latencyMs: number,
): Promise<void> {
  await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();
  await updateDoc(doc(db, "intakes", intakeId), {
    structured: sanitizeStructured(structured),
    inferenceSource: "IN_CLOUD",
    inferenceModeRequested: "ONLY_IN_CLOUD",
    latencyMs: Math.max(0, Math.min(600000, Math.round(latencyMs))),
    updatedAt: serverTimestamp(),
  });
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

export function subscribeVerificationTasks(
  incidentId: string,
  onUpdate: (tasks: VerificationTaskDoc[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseBundle();
  const q = query(
    collection(db, "verification_tasks"),
    where("incidentId", "==", incidentId),
  );
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const items: VerificationTaskDoc[] = snap.docs
        .map((d) => {
          const data = d.data({ serverTimestamps: "estimate" });
          return {
            id: d.id,
            incidentId: String(data.incidentId ?? ""),
            linkedIntakeId:
              typeof data.linkedIntakeId === "string"
                ? data.linkedIntakeId
                : null,
            question: String(data.question ?? ""),
            location: String(data.location ?? ""),
            status: data.status ?? "OPEN",
            requestedBy: String(data.requestedBy ?? ""),
            requestedPlatform: data.requestedPlatform ?? "WEB",
            answerText:
              typeof data.answerText === "string" ? data.answerText : null,
            answerPlatform: data.answerPlatform ?? null,
            answerPiiRedactedLocally: Boolean(data.answerPiiRedactedLocally),
            answerRedactionCount: Number(data.answerRedactionCount ?? 0),
            answeredBy:
              typeof data.answeredBy === "string" ? data.answeredBy : null,
            answeredAt: data.answeredAt ? toDate(data.answeredAt) : null,
            promotedKnowledgeId:
              typeof data.promotedKnowledgeId === "string"
                ? data.promotedKnowledgeId
                : null,
            createdAt: toDate(data.createdAt),
            updatedAt: data.updatedAt ? toDate(data.updatedAt) : null,
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      onUpdate(items);
    },
    (err) => onError(err),
  );
}

export async function createVerificationTask(params: {
  incidentId: string;
  linkedIntakeId: string | null;
  question: string;
  location: string;
  requestedPlatform?: SourcePlatform;
}): Promise<string> {
  const user = await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();
  const safeLinkedId =
    params.linkedIntakeId && /^[a-zA-Z0-9_-]{1,128}$/.test(params.linkedIntakeId)
      ? params.linkedIntakeId
      : null;

  const payload = {
    incidentId: params.incidentId,
    linkedIntakeId: safeLinkedId,
    question: clampString(params.question, 500, "Verify field condition"),
    location: clampString(params.location, 200, "Indonesia"),
    status: "OPEN" as const,
    requestedBy: user.uid,
    requestedPlatform: params.requestedPlatform ?? ("WEB" as const),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "verification_tasks"), payload);
  return ref.id;
}

export async function submitVerificationTaskAnswer(params: {
  taskId: string;
  sanitizedAnswer: string;
  redactionCount: number;
  answerPlatform?: SourcePlatform;
}): Promise<void> {
  const user = await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();
  await updateDoc(doc(db, "verification_tasks", params.taskId), {
    status: "ANSWERED",
    answerText: clampString(params.sanitizedAnswer, 2000, "Verified by field responder."),
    answerPlatform: params.answerPlatform ?? "WEB",
    answerPiiRedactedLocally: true,
    answerRedactionCount: Math.max(0, Math.min(500, Math.round(params.redactionCount))),
    answeredBy: user.uid,
    answeredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function markVerificationTaskPromoted(params: {
  taskId: string;
  promotedKnowledgeId: string;
}): Promise<void> {
  await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();
  await updateDoc(doc(db, "verification_tasks", params.taskId), {
    status: "PROMOTED",
    promotedKnowledgeId: params.promotedKnowledgeId,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeAreaKnowledge(
  incidentId: string,
  onUpdate: (facts: AreaKnowledgeDoc[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const { db } = getFirebaseBundle();
  const q = query(
    collection(db, "area_knowledge"),
    where("incidentId", "==", incidentId),
  );
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const items: AreaKnowledgeDoc[] = snap.docs
        .map((d) => {
          const data = d.data({ serverTimestamps: "estimate" });
          return {
            id: d.id,
            incidentId: String(data.incidentId ?? ""),
            fact: String(data.fact ?? ""),
            category: data.category ?? "SAFETY_CONSTRAINT",
            sourceType: data.sourceType ?? "HUMAN_DIRECT",
            sourceTaskId:
              typeof data.sourceTaskId === "string" ? data.sourceTaskId : null,
            active: Boolean(data.active),
            createdBy: String(data.createdBy ?? ""),
            createdAt: toDate(data.createdAt),
            updatedAt: toDate(data.updatedAt),
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      onUpdate(items);
    },
    (err) => onError(err),
  );
}

export async function createAreaKnowledge(params: {
  incidentId: string;
  fact: string;
  category: AreaKnowledgeCategory;
  sourceType: AreaKnowledgeSourceType;
  sourceTaskId: string | null;
  active?: boolean;
}): Promise<string> {
  const user = await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();

  const resolvedTaskId =
    params.sourceType === "PROMOTED_FIELD_CHECK" ? params.sourceTaskId : null;

  const payload = {
    incidentId: params.incidentId,
    fact: clampString(params.fact, 500, "Human-verified site constraint"),
    category: params.category,
    sourceType: params.sourceType,
    sourceTaskId: resolvedTaskId,
    active: params.active ?? true,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "area_knowledge"), payload);
  return ref.id;
}

export async function setAreaKnowledgeActive(
  factId: string,
  active: boolean,
): Promise<void> {
  await ensureAnonymousAuth();
  const { db } = getFirebaseBundle();
  await updateDoc(doc(db, "area_knowledge", factId), {
    active: Boolean(active),
    updatedAt: serverTimestamp(),
  });
}
