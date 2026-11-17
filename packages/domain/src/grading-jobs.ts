/** Shared operation policy: read-only UI diagnostics and server commands use the same gates. */
export function gradingJobActions(input: {
  status: string;
  manageable?: boolean;
  originalError: string | null;
  currentError: string | null;
}) {
  if (input.manageable === false)
    return {
      retryOriginal: { allowed: false, reason: 'FORBIDDEN' },
      newCurrent: { allowed: false, reason: 'FORBIDDEN' },
    };
  const retryReason = !['FAILED', 'BLOCKED_CONFIG'].includes(input.status)
    ? 'RUN_NOT_RETRYABLE'
    : input.originalError;
  const currentReason = !['FAILED', 'BLOCKED_CONFIG', 'SUCCEEDED'].includes(input.status)
    ? 'RUN_NOT_TERMINAL'
    : input.currentError;
  return {
    retryOriginal: { allowed: !retryReason, reason: retryReason },
    newCurrent: { allowed: !currentReason, reason: currentReason },
  };
}
