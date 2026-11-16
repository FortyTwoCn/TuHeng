import type { Role, QuestionInput, GeometryDocument } from '@tuheng/contracts';
export interface Actor {
  id: string;
  roles: Role[];
  name: string;
  schoolId?: string | null;
  kind?: import('@tuheng/contracts').AccountKind;
  realm?: import('@tuheng/contracts').AuthRealm;
  tokenVersion?: number;
  onboarding?: boolean;
}
export interface Row {
  id: string;
}
export interface Entities {
  user: Row & {
    email: string;
    kind?: import('@tuheng/contracts').AccountKind;
    realm?: import('@tuheng/contracts').AuthRealm;
    schoolId?: string | null;
    studentNumber?: string | null;
    loginId?: string | null;
    emailNormalized?: string | null;
    emailVerifiedAt?: Date | null;
    mustChangePassword?: boolean;
    name: string;
    passwordHash: string;
    roles: Role[];
    active: boolean;
    tokenVersion: number;
    createdAt: Date;
  };
  userNotification: Row & {
    userId: string;
    assignmentId: string;
    kind: string;
    revision: number;
    readAt: Date | null;
    createdAt: Date;
  };
  school: Row & { code: string; name: string; active: boolean; rosterVersion: number };
  assignmentRecipient: Row & {
    assignmentId: string;
    studentId: string;
    schoolId: string;
    classIds: string[];
    reviewerIds: string[];
    revision: number;
    active: boolean;
    inferred: boolean;
    createdAt: Date;
  };
  course: Row & { title: string; code: string; schoolId?: string | null };
  courseOffering: Row & { courseId: string; term: string };
  teachingClass: Row & {
    offeringId: string;
    name: string;
    schoolId?: string | null;
    archived?: boolean;
  };
  enrollment: Row & { userId: string; classId: string };
  teachingGrant: Row & { userId: string; classId: string };
  knowledgePoint: Row & { title: string; chapter: string };
  question: Row & {
    ownerId: string;
    courseId: string | null;
    visibility: string;
    active: boolean;
    createdAt: Date;
  };
  questionVersion: Row &
    QuestionInput & {
      questionId: string;
      version: number;
      maxPoints: number;
      analysis: unknown | null;
      createdAt: Date;
    };
  assignment: Row & {
    classId: string | null;
    schoolId?: string | null;
    audience?: import('@tuheng/contracts').AudienceSelection & {
      reviewerIds: string[];
      reviewerAssignments?: import('@tuheng/contracts').ReviewerAssignment[];
      rosterVersion: number;
    };
    audienceRevision?: number;
    creatorId: string;
    title: string;
    status: string;
    startsAt: Date;
    dueAt: Date;
    allowLate: boolean;
    maxAttempts: number;
    releaseAnswers: boolean;
    createdAt: Date;
  };
  assignmentItem: Row & { assignmentId: string; questionVersionId: string; position: number };
  submission: Row & {
    userId: string;
    itemId: string;
    draftAssetIds: string[];
    draftGeometry?: GeometryDocument | null;
  };
  submissionAttempt: Row & {
    ownerId: string;
    submissionId: string | null;
    questionVersionId: string;
    selfTestItemId: string | null;
    version: number;
    idempotencyKey: string;
    source: string;
    submittedAt: Date;
    publishedDecisionId: string | null;
    geometryAnswer?: GeometryDocument | null;
    geometrySchemaVersion?: string | null;
  };
  submissionAsset: Row & { attemptId: string; assetId: string; position: number };
  storedAsset: Row & {
    ownerId: string;
    objectKey: string;
    name: string;
    mime: string;
    bytes: number;
    width: number | null;
    height: number | null;
    purpose: string;
    parentId: string | null;
    transform: unknown | null;
    createdAt: Date;
  };
  aIProvider: Row & {
    name: string;
    brand: string;
    enabled: boolean;
    archived: boolean;
    currentVersion: number;
  };
  aIProviderVersion: Row & {
    providerId: string;
    version: number;
    config: unknown;
    secretId: string | null;
  };
  aIModel: Row & {
    providerId: string;
    name: string;
    enabled: boolean;
    archived: boolean;
    currentVersion: number;
  };
  aIModelVersion: Row & { modelId: string; version: number; config: unknown; testStatus: unknown };
  aITaskBindingVersion: Row & {
    taskKey: string;
    version: number;
    modelId: string;
    parameters: unknown;
    enabled: boolean;
  };
  aIInvocation: Row & {
    runId: string | null;
    taskKey: string;
    schoolId: string | null;
    actorId: string;
    resourceId: string;
    snapshot: unknown;
    status: string;
    errorCode: string | null;
    attempts: number;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    billingUncertain: boolean;
    createdAt: Date;
  };
  modelConfigurationVersion: Row & {
    provider: string;
    baseUrl: string;
    model: string;
    outputMode: string;
    timeoutMs: number;
    concurrency: number;
    keyEnv: string;
    active: boolean;
    createdAt: Date;
  };
  gradingRun: Row & {
    attemptId: string;
    configId: string | null;
    status: string;
    strategyVersion: string;
    promptVersion: string;
    request: unknown;
    errorCode: string | null;
    leaseUntil: Date | null;
    leaseToken: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
  };
  gradingSuggestion: Row & {
    runId: string;
    result: unknown;
    rawResponse: unknown;
    processedAssets: unknown;
    createdAt: Date;
  };
  gradeDecision: Row & {
    attemptId: string;
    teacherId: string;
    revision: number;
    points: number;
    items: unknown;
    feedback: string;
    annotations: unknown;
    aiIncorrect: boolean;
    publishedAt: Date | null;
    createdAt: Date;
  };
  appeal: Row & {
    attemptId: string;
    userId: string;
    reason: string;
    status: string;
    response: string | null;
    createdAt: Date;
  };
  selfTestFolder: Row & { ownerId: string; title: string };
  selfTestSet: Row & {
    ownerId: string;
    folderId: string | null;
    title: string;
    mode: string;
    createdAt: Date;
  };
  selfTestItem: Row & { setId: string; questionVersionId: string; position: number };
  errorBookEntry: Row & {
    ownerId: string;
    questionVersionId: string;
    attemptId: string;
    archived: boolean;
    createdAt: Date;
  };
  reviewAttempt: Row & { entryId: string; attemptId: string };
  knowledgeEvidence: Row & {
    ownerId: string;
    knowledgeId: string;
    decisionId: string;
    earned: number;
    possible: number;
    evidence: string;
  };
  backgroundJob: Row & {
    runId: string;
    lane: string;
    status: string;
    attempts: number;
    errorCode: string | null;
    updatedAt: Date;
  };
  outboxEvent: Row & { runId: string; lane: string; deliveredAt: Date | null; createdAt: Date };
  auditLog: Row & {
    actorId: string;
    action: string;
    resourceId: string;
    details: unknown;
    createdAt: Date;
  };
}
export type Table = keyof Entities;
export type Where<T> = {
  [K in keyof T]?: T[K] | { in?: T[K][]; lt?: T[K]; gt?: T[K]; not?: T[K] };
};
export interface DataPort {
  get<K extends Table>(table: K, id: string): Promise<Entities[K] | null>;
  list<K extends Table>(
    table: K,
    where?: Where<Entities[K]>,
    options?: { take?: number; orderBy?: keyof Entities[K]; desc?: boolean },
  ): Promise<Entities[K][]>;
  create<K extends Table>(table: K, data: Partial<Entities[K]>): Promise<Entities[K]>;
  update<K extends Table>(table: K, id: string, data: Partial<Entities[K]>): Promise<Entities[K]>;
  transaction<T>(work: (tx: DataPort) => Promise<T>): Promise<T>;
}
