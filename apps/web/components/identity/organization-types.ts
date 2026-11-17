import type { AccountKind } from '@tuheng/contracts';
export type OrganizationIdentity = { id: string; kind: AccountKind; schoolId?: string | null };
export type Person = {
  id: string;
  name: string;
  loginId?: string;
  studentNumber?: string;
  active: boolean;
  mustChangePassword: boolean;
  emailVerifiedAt?: string;
  kind: string;
  lastLoginAt?: string;
  enrollments?: { classId: string; teachingClass: { name: string } }[];
  grants?: { classId: string; teachingClass: { name: string } }[];
};
export type ClassRow = {
  id: string;
  name: string;
  archived: boolean;
  offering: { term: string; course: { title: string } };
  grants: { user: Person }[];
  _count: { enrollments: number };
};
export type School = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  _count: { users: number };
  counts: { teachers: number; students: number };
  administrators: { name: string; loginId: string | null; active: boolean }[];
};
export type Offering = { id: string; term: string; course: { title: string } };
export type OrganizationCommand = (
  operation: string,
  data: Record<string, unknown>,
) => Promise<unknown>;
