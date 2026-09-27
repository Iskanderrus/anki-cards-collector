export type RestoreBoundaryOutcome<T> =
  | { kind: "complete"; result: T }
  | { kind: "committed-refresh-warning"; result: T; error: unknown }
  | { kind: "precommit-failure"; error: unknown; compensationError?: unknown };

export interface RestoreBoundaryOperations<T> {
  prepareSettings?: () => Promise<void>;
  restoreRepository: () => Promise<T>;
  refreshCommittedState: () => Promise<void>;
  compensateSettings?: () => Promise<void>;
}

export async function restoreAcrossCommitBoundary<T>(
  operations: RestoreBoundaryOperations<T>,
): Promise<RestoreBoundaryOutcome<T>> {
  let settingsPrepared = false;
  let result: T;

  try {
    if (operations.prepareSettings) {
      await operations.prepareSettings();
      settingsPrepared = true;
    }

    // Successful resolution is the irreversible durable-success boundary.
    result = await operations.restoreRepository();
  } catch (error) {
    if (!settingsPrepared || !operations.compensateSettings) {
      return { kind: "precommit-failure", error };
    }

    try {
      await operations.compensateSettings();
      return { kind: "precommit-failure", error };
    } catch (compensationError) {
      return { kind: "precommit-failure", error, compensationError };
    }
  }

  try {
    await operations.refreshCommittedState();
    return { kind: "complete", result };
  } catch (error) {
    // Repository restore is already durable. Compensation is forbidden here.
    return { kind: "committed-refresh-warning", result, error };
  }
}
