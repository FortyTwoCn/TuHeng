import type { Role, QuestionInput } from '@tuheng/contracts';
export interface Actor {
  id: string;
  roles: Role[];
  name: string;
}
export interface Row {
  id: string;
}
export interface Entities {
  user: Row & {
    email: string;
    name: string;
    passwordHash: string;
    roles: Role[];
    active: boolean;
    tokenVersion: number;
    createdAt: Date;
  };
  course: Row & { title: string; code: string };
  courseOffering: Row & { courseId: string; term: string };
  teachingClass: Row & { offeringId: string; name: string };
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
    classId: string;
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
  submission: Row & { userId: string; itemId: string; draftAssetIds: string[] };
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
    configId: string;
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
