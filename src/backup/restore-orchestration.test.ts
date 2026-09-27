import { describe, expect, it, vi } from "vitest";
import { restoreAcrossCommitBoundary } from "./restore-orchestration";

describe("restoreAcrossCommitBoundary", () => {
  it("compensates prepared settings when repository restore fails before commit", async () => {
    const events: string[] = [];
    const compensateSettings = vi.fn(async () => {
      events.push("compensate");
    });

    const outcome = await restoreAcrossCommitBoundary({
      prepareSettings: async () => {
        events.push("prepare");
      },
      restoreRepository: async () => {
        events.push("restore");
        throw new Error("transaction failed");
      },
      refreshCommittedState: async () => {
        events.push("refresh");
      },
      compensateSettings,
    });

    expect(outcome).toMatchObject({
      kind: "precommit-failure",
      error: expect.objectContaining({ message: "transaction failed" }),
    });
    expect(events).toEqual(["prepare", "restore", "compensate"]);
    expect(compensateSettings).toHaveBeenCalledTimes(1);
  });

  it("does not enter repository restore or compensate when preparatory settings persistence fails", async () => {
    const restoreRepository = vi.fn(async () => ({ restored: true }));
    const refreshCommittedState = vi.fn(async () => undefined);
    const compensateSettings = vi.fn(async () => undefined);

    const outcome = await restoreAcrossCommitBoundary({
      prepareSettings: async () => {
        throw new Error("settings persistence failed");
      },
      restoreRepository,
      refreshCommittedState,
      compensateSettings,
    });

    expect(outcome).toMatchObject({
      kind: "precommit-failure",
      error: expect.objectContaining({ message: "settings persistence failed" }),
    });
    expect(restoreRepository).not.toHaveBeenCalled();
    expect(refreshCommittedState).not.toHaveBeenCalled();
    expect(compensateSettings).not.toHaveBeenCalled();
  });

  it("treats refresh failure after repository resolution as committed success", async () => {
    const compensateSettings = vi.fn(async () => undefined);
    const restored = { lexicalUnitsAdded: 1 };

    const outcome = await restoreAcrossCommitBoundary({
      prepareSettings: async () => undefined,
      restoreRepository: async () => restored,
      refreshCommittedState: async () => {
        throw new Error("interface refresh failed");
      },
      compensateSettings,
    });

    expect(outcome).toEqual({
      kind: "committed-refresh-warning",
      result: restored,
      error: expect.objectContaining({ message: "interface refresh failed" }),
    });
    expect(compensateSettings).not.toHaveBeenCalled();
  });

  it("surfaces compensation failure without crossing the commit boundary", async () => {
    const outcome = await restoreAcrossCommitBoundary({
      prepareSettings: async () => undefined,
      restoreRepository: async () => {
        throw new Error("restore rejected");
      },
      refreshCommittedState: async () => undefined,
      compensateSettings: async () => {
        throw new Error("rollback rejected");
      },
    });

    expect(outcome).toMatchObject({
      kind: "precommit-failure",
      error: expect.objectContaining({ message: "restore rejected" }),
      compensationError: expect.objectContaining({ message: "rollback rejected" }),
    });
  });
});
