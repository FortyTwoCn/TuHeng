'use client';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FormDrawer, FormFeedback } from '../identity/FormDrawer';
import { identityRequest, IdentityRequestError } from '../identity/client';
import { Reauthentication, type ReauthenticationHandle } from '../identity/Reauthentication';
import { OrganizationCreate } from '../identity/OrganizationCreate';
import { SchoolRow, PersonRow } from '../identity/OrganizationRows';
import type {
  OrganizationCommand,
  OrganizationIdentity,
  Person,
  School,
} from '../identity/organization-types';
const Context = createContext<{
  command: OrganizationCommand;
  busy: boolean;
  schoolId: string;
  identity: OrganizationIdentity;
} | null>(null);
function useCommands() {
  const ctx = useContext(Context);
  if (!ctx) throw Error('OrganizationCommands required');
  return ctx;
}
const sensitive = new Set([
  'create-school',
  'create-school-admin',
  'rename-school',
  'reset-password',
  'update-account',
  'set-school-active',
  'update-class',
]);
export function OrganizationCommands({
  identity,
  schoolId,
  children,
}: {
  identity: OrganizationIdentity;
  schoolId: string;
  children: ReactNode;
}) {
  const router = useRouter(),
    auth = useRef<ReauthenticationHandle>(null),
    inFlight = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [delivery, setDelivery] = useState('');
  async function command(operation: string, data: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    setDelivery('');
    try {
      const proof = sensitive.has(operation) ? await auth.current?.request() : undefined;
      if (sensitive.has(operation) && !proof) return;
      const result = await identityRequest(
        '/api/organization/' + operation,
        { schoolId, ...data, proof },
        'STAFF',
      );
      setMessage('操作已保存。');
      if (result.credentialBatchId) {
        const area =
          identity.kind === 'SITE_ADMIN'
            ? 'admin'
            : identity.kind === 'SCHOOL_ADMIN'
              ? 'school'
              : 'teacher';
        setDelivery(
          '/' +
            area +
            '/delivery?' +
            new URLSearchParams({
              schoolId: result.school?.id ?? String(data.schoolId ?? schoolId),
              batchId: result.credentialBatchId,
            }),
        );
      }
      router.refresh();
      return result;
    } catch (e) {
      if (e instanceof IdentityRequestError && e.code === 'RECENT_AUTH_REQUIRED')
        auth.current?.invalidate();
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Context.Provider value={{ command, busy, identity, schoolId }}>
      <FormFeedback.Provider value={{ error, clear: () => setError('') }}>
        {children}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status">
            {message} {delivery && <Link href={delivery}>领取初始凭据</Link>}
          </p>
        )}
        <Reauthentication ref={auth} />
      </FormFeedback.Provider>
    </Context.Provider>
  );
}
export function CreateAccount({ tab }: { tab: 'schools' | 'teachers' | 'students' }) {
  return <OrganizationCreate tab={tab} {...useCommands()} />;
}
export function PersonActions({ person }: { person: Person }) {
  return <PersonRow person={person} student={person.kind === 'STUDENT'} {...useCommands()} />;
}
export function SchoolActions({ school }: { school: School }) {
  const router = useRouter();
  return (
    <SchoolRow
      school={school}
      choose={() => router.push('/admin/users?schoolId=' + school.id)}
      {...useCommands()}
    />
  );
}
export function CommandForm({
  label,
  operation,
  data = {},
  children,
  confirm,
  primary = false,
}: {
  label: string;
  operation: string;
  data?: Record<string, unknown>;
  children?: ReactNode;
  confirm?: string;
  primary?: boolean;
}) {
  const { command, busy } = useCommands();
  return (
    <FormDrawer trigger={label} title={label} busy={busy} primary={primary}>
      {(done) => (
        <form
          className="identity-dialog-form org-command-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const values = Object.fromEntries(new FormData(e.currentTarget));
            if (values.fromTeacherId === '') delete values.fromTeacherId;
            if (await command(operation, { ...data, ...values })) done();
          }}
        >
          {children}
          {confirm && <p>{confirm}</p>}
          <div className="dialog-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={done}>
              取消
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? '正在保存…' : confirm ? '确认' + label : '保存'}
            </button>
          </div>
        </form>
      )}
    </FormDrawer>
  );
}
