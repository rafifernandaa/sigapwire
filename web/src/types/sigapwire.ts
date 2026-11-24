export type HazardType =
  | "EARTHQUAKE"
  | "FLOOD"
  | "VOLCANO"
  | "LANDSLIDE"
  | "TSUNAMI"
  | "OTHER";

export type SeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type IncidentStatus = "ACTIVE" | "MONITORING" | "RESOLVED";

export type IntakeMode = "FIELD_REPORT" | "RUMOR_CHECK";

export type SourcePlatform = "WEB" | "ANDROID" | "APPLE";

export type InferenceSourceLabel = "ON_DEVICE" | "IN_CLOUD";

export type RequestedInferenceMode =
  | "ONLY_ON_DEVICE"
  | "PREFER_ON_DEVICE"
  | "ONLY_IN_CLOUD"
  | "PREFER_IN_CLOUD";

export type RumorVerdict =
  | "VERIFIED"
  | "MISLEADING"
  | "UNVERIFIED_DEVELOPING"
  | "NOT_APPLICABLE";

export type IntakeStatus = "TRIAGED" | "VERIFIED" | "INCLUDED_IN_DISPATCH";

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface RedactionItem {
  category: "PERSON_NAME" | "PHONE_NUMBER" | "CHAT_HANDLE" | "ADDRESS_DETAIL" | "OTHER_PII";
  placeholder: string;
  reason: string;
}

export interface LocalPrivacyResult {
  sanitizedText: string;
  redactions: RedactionItem[];
  inferenceSource: InferenceSourceLabel;
  latencyMs: number;
  usedRegexFallback: boolean;
}

export interface StructuredIntakeData {
  headline: string;
  hazardType: HazardType;
  location: string;
  severity: SeverityLevel;
  summaryId: string;
  summaryEn: string;
  keyFacts: string[];
  urgentNeeds: string[];
  verificationGaps: string[];
  rumorVerdict: RumorVerdict;
  panicSignals: string[];
  groundingSources: GroundingSource[];
  searchEntryPointHtml: string | null;
}

export interface IncidentDoc {
  id: string;
  title: string;
  hazardType: HazardType;
  region: string;
  severity: SeverityLevel;
  status: IncidentStatus;
  isSyntheticDemo: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntakeDoc {
  id: string;
  incidentId: string;
  mode: IntakeMode;
  sourcePlatform: SourcePlatform;
  inferenceSource: InferenceSourceLabel;
  inferenceModeRequested: RequestedInferenceMode;
  latencyMs: number;
  piiRedactedLocally: boolean;
  redactionCount: number;
  sanitizedText: string;
  hasAttachment: boolean;
  structured: StructuredIntakeData;
  status: IntakeStatus;
  createdBy: string;
  createdAt: Date;
  pendingSync?: boolean; // client-only Firestore metadata, never written
}

export interface CommunityAlertPayload {
  title: string;
  whatHappened: string;
  doNow: string[];
  avoid: string[];
  whatsappShortText: string;
}

export interface MediaPressReleasePayload {
  headline: string;
  dateline: string;
  body: string;
  keyMetrics: string[];
}

export interface GlobalSitrepPayload {
  headline: string;
  executiveSummary: string;
  impactOverview: string[];
  priorityNeeds: string[];
  informationGaps: string[];
}

export interface DebunkCardPayload {
  hasRumorAlert: boolean;
  verdict: RumorVerdict;
  claim: string;
  factId: string;
  factEn: string;
  sources: GroundingSource[];
}

export interface DispatchDoc {
  id: string;
  incidentId: string;
  dispatchNumber: number;
  severity: SeverityLevel;
  sourceIntakeIds: string[];
  inferenceSource: InferenceSourceLabel;
  communityAlertId: CommunityAlertPayload;
  mediaPressReleaseId: MediaPressReleasePayload;
  globalSitrepEn: GlobalSitrepPayload;
  debunkCard: DebunkCardPayload;
  groundingSearchHtml: string | null;
  publishedBy: string;
  publishedAt: Date;
}

export interface OnDeviceDiagnostics {
  browserSupported: boolean;
  availability: "available" | "downloadable" | "downloading" | "unavailable" | "unsupported";
  downloadProgress: number | null;
  online: boolean;
}

export type VerificationTaskStatus = "OPEN" | "ANSWERED" | "PROMOTED";

export interface VerificationTaskDoc {
  id: string;
  incidentId: string;
  linkedIntakeId: string | null;
  question: string;
  location: string;
  status: VerificationTaskStatus;
  requestedBy: string;
  requestedPlatform: SourcePlatform;
  answerText: string | null;
  answerPlatform: SourcePlatform | null;
  answerPiiRedactedLocally: boolean;
  answerRedactionCount: number;
  answeredBy: string | null;
  answeredAt: Date | null;
  promotedKnowledgeId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export type AreaKnowledgeCategory =
  | "ROUTE_ACCESS"
  | "EVACUATION_SITE"
  | "INFRASTRUCTURE"
  | "OFFICIAL_SOURCE"
  | "SAFETY_CONSTRAINT";

export type AreaKnowledgeSourceType =
  | "HUMAN_DIRECT"
  | "PROMOTED_FIELD_CHECK";

export interface AreaKnowledgeDoc {
  id: string;
  incidentId: string;
  fact: string;
  category: AreaKnowledgeCategory;
  sourceType: AreaKnowledgeSourceType;
  sourceTaskId: string | null;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionAuditEvent {
  id: string;
  timestamp: Date;
  category: "ON_DEVICE" | "IN_CLOUD" | "HUMAN_GATE";
  eventType: string;
  title: string;
  detail: string;
}
