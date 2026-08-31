import { describe, it, expect } from 'vitest';
import {
  applyCompletion,
  applyFailure,
  computeProgressCounts,
  emptyProgressState,
  armIntegrityAttempt,
  confirmIntegrityAttempt,
  emptyIntegrityState,
  failIntegrityAttempt,
  isIntegrityClean,
  recoverAmbiguousIntegrityAttempt,
  PIPELINE_PROOF_VERSION,
  type CountersDODayProofSnapshot,
} from '../src/features/stats/pipeline-progress';
import {
  isLiveProgressExact,
  type LiveProgressSnapshot,
} from '../src/features/stats/d1-coverage';

function matchingDaySnapshot(version = PIPELINE_PROOF_VERSION): CountersDODayProofSnapshot {
  const category = { accepted: 1, completed: 1, pending: 0, failed: 0, clean: true };
  return {
    day: '2026-08-26',
    version,
    initialized: true,
    accepted: 1,
    categories: { base: category, profanity: category, criminal: category },
  };
}

function matchingD1Snapshot(): LiveProgressSnapshot {
  const category = { accepted: 1, completed: 1, pending: 0, failed: 0 };
  return {
    day: '2026-08-26',
    pendingAnalysis: 0,
    failedCount: 0,
    categories: { base: category, profanity: category, criminal: category },
  };
}

describe('pipeline progress contiguous completion', () => {
  it('advances the prefix only for contiguous completion and stores gaps', () => {
    let state = emptyProgressState();
    state = applyCompletion(state, 2);
    // Out-of-order: prefix stays 0, gap recorded.
    expect(state.completedPrefix).toBe(0);
    expect(state.gaps).toEqual([2]);
    expect(computeProgressCounts(state, 2)).toEqual({
      completedSeq: 0,
      pendingCount: 1,
      failedCount: 0,
    });

    state = applyCompletion(state, 1);
    // Now contiguous: prefix advances to 2, gap consumed.
    expect(state.completedPrefix).toBe(2);
    expect(state.gaps).toEqual([]);
    expect(computeProgressCounts(state, 2)).toEqual({
      completedSeq: 2,
      pendingCount: 0,
      failedCount: 0,
    });
  });

  it('is idempotent for duplicate completions and out-of-order duplicates', () => {
    let state = emptyProgressState();
    state = applyCompletion(state, 1);
    state = applyCompletion(state, 1);
    state = applyCompletion(state, 3);
    state = applyCompletion(state, 3);
    expect(state.completedPrefix).toBe(1);
    expect(state.gaps).toEqual([3]);
    expect(computeProgressCounts(state, 3).pendingCount).toBe(1);
  });

  it('tracks failures without ever representing them as zero', () => {
    let state = emptyProgressState();
    state = applyFailure(state, 2);
    expect(state.failed).toEqual([2]);
    expect(computeProgressCounts(state, 3)).toEqual({
      completedSeq: 0,
      pendingCount: 2,
      failedCount: 1,
    });
    // Duplicate failure is idempotent.
    state = applyFailure(state, 2);
    expect(state.failed).toEqual([2]);
  });

  it('a failed sequence is not treated as completed', () => {
    let state = emptyProgressState();
    state = applyFailure(state, 1);
    state = applyCompletion(state, 2);
    expect(state.completedPrefix).toBe(0);
    expect(state.failed).toEqual([1]);
    expect(computeProgressCounts(state, 2).failedCount).toBe(1);
  });
});

describe('D1 write integrity state', () => {
  it('starts clean, arming makes it not readable, confirm restores clean', () => {
    let state = emptyIntegrityState();
    expect(isIntegrityClean(state)).toBe(true);

    state = armIntegrityAttempt(state, 7);
    expect(state.activeAttemptSeq).toBe(7);
    expect(state.poisoned).toBe(false);
    expect(isIntegrityClean(state)).toBe(false);

    state = confirmIntegrityAttempt(state, 7);
    expect(state.activeAttemptSeq).toBeNull();
    expect(state.poisoned).toBe(false);
    expect(isIntegrityClean(state)).toBe(true);
  });

  it('failure poisons permanently; later success stays poisoned with fixed reason', () => {
    let state = emptyIntegrityState();
    state = armIntegrityAttempt(state, 3);
    state = failIntegrityAttempt(state, 3);
    expect(state.activeAttemptSeq).toBeNull();
    expect(state.poisoned).toBe(true);
    expect(state.firstPoisonedSeq).toBe(3);
    expect(state.reason).toBe('d1_write_failed');
    expect(isIntegrityClean(state)).toBe(false);

    // Later unrelated attempts succeeding must never erase the poison.
    state = armIntegrityAttempt(state, 4);
    state = confirmIntegrityAttempt(state, 4);
    expect(state.poisoned).toBe(true);
    expect(state.firstPoisonedSeq).toBe(3);
    expect(state.reason).toBe('d1_write_failed');
    expect(isIntegrityClean(state)).toBe(false);
  });

  it('restart recovery poisons a pre-existing active attempt as ambiguous', () => {
    let state = emptyIntegrityState();
    state = armIntegrityAttempt(state, 5);
    state = recoverAmbiguousIntegrityAttempt(state);
    expect(state.activeAttemptSeq).toBeNull();
    expect(state.poisoned).toBe(true);
    expect(state.firstPoisonedSeq).toBe(5);
    expect(state.reason).toBe('ambiguous_attempt');
    expect(isIntegrityClean(state)).toBe(false);

    // Idempotent: recovery on an already-recovered state changes nothing.
    const again = recoverAmbiguousIntegrityAttempt(state);
    expect(again).toEqual(state);
  });

  it('arming while an active attempt exists conservatively poisons the prior attempt', () => {
    let state = emptyIntegrityState();
    state = armIntegrityAttempt(state, 2);
    state = armIntegrityAttempt(state, 4);
    expect(state.activeAttemptSeq).toBe(4);
    expect(state.poisoned).toBe(true);
    expect(state.firstPoisonedSeq).toBe(2);
    expect(state.reason).toBe('ambiguous_attempt');
    expect(isIntegrityClean(state)).toBe(false);
  });

  it('confirms only the matching active attempt; stale confirm is a no-op', () => {
    let state = emptyIntegrityState();
    state = armIntegrityAttempt(state, 2);
    state = armIntegrityAttempt(state, 4);
    // Stale confirmation of the replaced attempt must not clear the newer one.
    state = confirmIntegrityAttempt(state, 2);
    expect(state.activeAttemptSeq).toBe(4);
    expect(state.poisoned).toBe(true);
    expect(state.firstPoisonedSeq).toBe(2);
    expect(state.reason).toBe('ambiguous_attempt');

    state = confirmIntegrityAttempt(state, 4);
    expect(state.activeAttemptSeq).toBeNull();
    // Poison from the replaced attempt is preserved.
    expect(state.poisoned).toBe(true);
    expect(state.firstPoisonedSeq).toBe(2);
  });

  it('failure on a replaced attempt never clears the current active attempt', () => {
    let state = emptyIntegrityState();
    state = armIntegrityAttempt(state, 1);
    state = armIntegrityAttempt(state, 2);
    // Late failure for the replaced attempt is a no-op for the active marker.
    state = failIntegrityAttempt(state, 1);
    expect(state.activeAttemptSeq).toBe(2);
    expect(state.poisoned).toBe(true);
    expect(state.firstPoisonedSeq).toBe(1);
    expect(state.reason).toBe('ambiguous_attempt');
    // Earliest poison sequence is preserved once set.
    state = failIntegrityAttempt(state, 2);
    expect(state.firstPoisonedSeq).toBe(1);
    expect(state.reason).toBe('ambiguous_attempt');
  });

  it('is idempotent for duplicate operations', () => {
    let state = emptyIntegrityState();
    state = armIntegrityAttempt(state, 3);
    expect(armIntegrityAttempt(state, 3)).toEqual(state);
    state = confirmIntegrityAttempt(state, 3);
    expect(confirmIntegrityAttempt(state, 3)).toEqual(state);
    state = failIntegrityAttempt(state, 3);
    expect(failIntegrityAttempt(state, 3)).toEqual(state);
    expect(recoverAmbiguousIntegrityAttempt(state)).toEqual(state);
  });

  it('treats invalid and nonpositive sequences as no-ops', () => {
    const state = emptyIntegrityState();
    expect(armIntegrityAttempt(state, 0)).toBe(state);
    expect(armIntegrityAttempt(state, -1)).toBe(state);
    expect(armIntegrityAttempt(state, 1.5)).toBe(state);
    expect(armIntegrityAttempt(state, NaN)).toBe(state);
    expect(confirmIntegrityAttempt(state, 0)).toBe(state);
    expect(confirmIntegrityAttempt(state, -1)).toBe(state);
    expect(failIntegrityAttempt(state, 0)).toBe(state);
    expect(failIntegrityAttempt(state, -1)).toBe(state);

    const armed = armIntegrityAttempt(state, 4);
    expect(confirmIntegrityAttempt(armed, 0)).toBe(armed);
    expect(failIntegrityAttempt(armed, 0)).toBe(armed);
  });

  it('helpers never mutate their inputs', () => {
    const state = emptyIntegrityState();
    const armed = armIntegrityAttempt(state, 1);
    expect(state).toEqual(emptyIntegrityState());

    const failed = failIntegrityAttempt(armed, 1);
    expect(armed).toEqual({ activeAttemptSeq: 1, poisoned: false, firstPoisonedSeq: null, reason: null });

    const confirmed = confirmIntegrityAttempt(armed, 1);
    expect(armed).toEqual({ activeAttemptSeq: 1, poisoned: false, firstPoisonedSeq: null, reason: null });
    expect(confirmed).toEqual(emptyIntegrityState());
    expect(failed.activeAttemptSeq).toBeNull();
  });
});

describe('isLiveProgressExact proof version gate', () => {
  it('validates a matching-version live proof', () => {
    expect(isLiveProgressExact(matchingD1Snapshot(), matchingDaySnapshot())).toBe(true);
  });

  it('rejects a live proof with a stale per-day proof-contract version', () => {
    expect(isLiveProgressExact(matchingD1Snapshot(), matchingDaySnapshot(PIPELINE_PROOF_VERSION - 1))).toBe(false);
  });
});
