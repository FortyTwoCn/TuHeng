import type {
  Role,
  QuestionInput,
  GeometryDocument,
  AssetArchiveContext,
  AssetPurpose,
  AssetUploadTarget,
  AnswerStorageContext,
  NotificationCategory,
  NotificationKind,
  NotificationResource,
  NotificationPreferences,
  AnnouncementAudience,
  TermRange,
} from '@tuheng/contracts';
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
  siteConfigurationVersion: Row & {
    version: number;
    filingNumber: string;
    createdAt: Date;
  };
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
    avatarAssetId?: string | null;
    avatarRevision?: number;
    notificationPreferences?: NotificationPreferences | null;
    notificationConsent?: Partial<Record<NotificationCategory, number>> | null;
  };
  userNotification: Row & {
    userId: string;
    sequence: number;
    eventKey: string;
    kind: NotificationKind;
    category: NotificationCategory;
    title: string;
    summary: string;
    resourceType: NotificationResource;
    resourceId: string;
    schoolId: string | null;
    revision: number | null;
    deadlineAt: Date | null;
    readAt: Date | null;
    createdAt: Date;
  };
  notificationDelivery: Row & {
    notificationId: string;
    consentVersion: number;
    expiresAt: Date;
  };
  announcement: Row & {
    creatorId: string;
    schoolId: string | null;
    title: string;
    body: string;
    audience: AnnouncementAudience;
    revision: number;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  announcementRecipient: Row & {
    announcementId: string;
    userId: string;
    schoolId: string;
    revision: number;
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
    activeSince: Date;
  };
  course: Row & { title: string; code: string; schoolId?: string | null; archived?: boolean };
  courseOffering: Row & TermRange & { courseId: string; term: string; archived?: boolean };
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
    schoolId: string | null;
    selfTest: boolean;
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
    storageContext?: AnswerStorageContext;
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
    purpose: AssetPurpose;
    parentId: string | null;
    transform: unknown | null;
    storageSchoolId: string | null;
    storageSubjectUserId: string | null;
    storageContext: AssetArchiveContext | null;
    checksum: string;
    state: 'WRITING' | 'STAGED' | 'ARCHIVING' | 'ARCHIVED' | 'DELETING';
    uploadSessionId: string | null;
    discardAfter: Date | null;
    createdAt: Date;
  };
  assetUploadSession: Row & {
    ownerId: string;
    schoolId: string | null;
    targetSchoolId: string | null;
    target: AssetUploadTarget;
    expiresAt: Date;
    cancelledAt: Date | null;
    createdAt: Date;
  };
  assetArchiveTask: Row & {
    assetId: string;
    sourceKey: string;
    sourceChecksum: string;
    targetKey: string;
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
export type AnnouncementDirectory = {
  schoolId: string | null;
  permittedClassIds?: string[];
  classId?: string;
  q?: string;
  after?: string;
  kind?: 'STUDENT' | 'TEACHER';
  selection?: AnnouncementAudience;
};
export type AnnouncementPerson = {
  id: string;
  name: string;
  kind: string;
  schoolId: string;
  schoolName: string;
};
export type DeadlineCandidate = {
  recipientId: string;
  studentId: string;
  id: string;
  schoolId: string;
  title: string;
  dueAt: Date;
  missing: number;
};
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
  createMany<K extends Table>(table: K, rows: Partial<Entities[K]>[]): Promise<void>;
  lockNotificationRecipients(ids: string[]): Promise<void>;
  questionVersionsUsingAsset(id: string): Promise<Entities['questionVersion'][]>;
  announcementPeople(directory: AnnouncementDirectory, take: number): Promise<AnnouncementPerson[]>;
  deadlineCandidates(now: Date, after: string, take: number): Promise<DeadlineCandidate[]>;
  update<K extends Table>(table: K, id: string, data: Partial<Entities[K]>): Promise<Entities[K]>;
  transaction<T>(work: (tx: DataPort) => Promise<T>): Promise<T>;
}
