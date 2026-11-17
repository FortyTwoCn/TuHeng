import { describe, expect, it } from 'vitest';
import { gradingJobActions } from '@tuheng/domain';
describe('grading operation policy shared by commands and job records', () => {
  it.each(['QUEUED', 'RUNNING', 'RETRYING'])(
    'does not enqueue a second active %s run',
    (status) => {
      const actions = gradingJobActions({ status, originalError: null, currentError: null });
      expect(actions.retryOriginal.allowed).toBe(false);
      expect(actions.newCurrent.allowed).toBe(false);
    },
  );
  it.each(['FAILED', 'BLOCKED_CONFIG'])('requires an original snapshot to retry %s', (status) => {
    const actions = gradingJobActions({
      status,
      originalError: 'AI_SNAPSHOT_REQUIRED',
      currentError: null,
    });
    expect(actions.retryOriginal).toEqual({ allowed: false, reason: 'AI_SNAPSHOT_REQUIRED' });
    expect(actions.newCurrent.allowed).toBe(true);
  });
  it('allows a valid original snapshot without silently choosing an unavailable current binding', () => {
    const actions = gradingJobActions({
      status: 'FAILED',
      originalError: null,
      currentError: 'AI_BINDING_NOT_CONFIGURED',
    });
    expect(actions.retryOriginal.allowed).toBe(true);
    expect(actions.newCurrent.allowed).toBe(false);
  });
  it('keeps legacy operators read-only even when a configuration is usable', () => {
    const actions = gradingJobActions({
      status: 'FAILED',
      originalError: null,
      currentError: null,
      manageable: false,
    });
    expect(actions.retryOriginal).toEqual({ allowed: false, reason: 'FORBIDDEN' });
    expect(actions.newCurrent).toEqual({ allowed: false, reason: 'FORBIDDEN' });
  });
  it('never overwrites a successful run and blocks revoked credentials', () => {
    const actions = gradingJobActions({
      status: 'SUCCEEDED',
      originalError: null,
      currentError: 'AI_CREDENTIAL_UNAVAILABLE',
    });
    expect(actions.retryOriginal.allowed).toBe(false);
    expect(actions.newCurrent.allowed).toBe(false);
  });
});
