'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { isValidTermRange } from '@tuheng/contracts';

const beijingOffset = 8 * 60 * 60 * 1000;
function localTime(instant?: string) {
  return instant ? new Date(Date.parse(instant) + beijingOffset).toISOString().slice(0, 16) : '';
}

function timestamp(value: string, initial?: string) {
  // Keep seconds and milliseconds if the displayed minute was not edited.
  return value === localTime(initial) ? (initial ?? '') : value && value + ':00+08:00';
}

export function TermFields({ startsAt, endsAt }: { startsAt?: string; endsAt?: string }) {
  const [start, setStart] = useState(() => localTime(startsAt));
  const [end, setEnd] = useState(() => localTime(endsAt));
  const endInput = useRef<HTMLInputElement>(null);
  const hintId = useId(),
    errorId = useId();
  const startTime = timestamp(start, startsAt),
    endTime = timestamp(end, endsAt);
  const error =
    startTime && endTime && !isValidTermRange(new Date(startTime), new Date(endTime))
      ? '截止时间必须晚于开启时间。'
      : '';

  useEffect(() => {
    endInput.current?.setCustomValidity(error);
  }, [error]);

  return (
    <div className="org-term-fields">
      <label>
        开启时间
        <input
          type="datetime-local"
          required
          value={start}
          onChange={(e) => setStart(e.target.value)}
          aria-describedby={hintId}
        />
      </label>
      <label>
        截止时间
        <input
          ref={endInput}
          type="datetime-local"
          required
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? hintId + ' ' + errorId : hintId}
        />
      </label>
      <input type="hidden" name="startsAt" value={startTime} />
      <input type="hidden" name="endsAt" value={endTime} />
      <small id={hintId} className="muted">
        北京时间（UTC+8）
      </small>
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
