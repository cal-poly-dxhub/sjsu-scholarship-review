import { describe, expect, it } from "vitest";

import { runStatus, SETTLE_MS, type Started } from "./run-state";

/**
 * The failure this covers is the one that happened: one cohort took six overlapping runs because
 * the screen read itself as idle in the gap between the press and the worker's first claim.
 */

const AT = 1_760_000_000_000;

function started(fields: Partial<Started> = {}): Started {
  return { at: AT, key: "score:unscored", label: "Score the unscored", work: 10, ...fields };
}

describe("runStatus", () => {
  it("holds the triggers in the gap between the press and the first claim", () => {
    // The POST is back, so this is exactly when a second press used to get through.
    const status = runStatus(started(), 0, AT + 1000);

    expect(status.inFlight).toBe(true);
    expect(status.settling).toBe(true);
    expect(status.activeKey).toBe("score:unscored");
  });

  it("stops settling once claims appear, and stays in flight on them", () => {
    const status = runStatus(started(), 8, AT + 3000);

    expect(status.inFlight).toBe(true);
    expect(status.settling).toBe(false);
  });

  it("frees the triggers when the window passes with nothing ever claimed", () => {
    // A worker that died before claiming. Without this the buttons would stay stuck for good.
    const status = runStatus(started(), 0, AT + SETTLE_MS + 1);

    expect(status.inFlight).toBe(false);
    expect(status.activeKey).toBeNull();
  });

  it("keeps holding a long run whose claims outlive the window", () => {
    // A batch job holds its claims for hours, so the window expiring must not unlock anything.
    const status = runStatus(started(), 500, AT + 4 * 60 * 60 * 1000);

    expect(status.inFlight).toBe(true);
  });

  it("locks on claims this screen did not start, and names no button for them", () => {
    const status = runStatus(null, 4, AT);

    expect(status.inFlight).toBe(true);
    expect(status.activeKey).toBeNull();
  });

  it("is idle with no press and nothing claimed", () => {
    expect(runStatus(null, 0, AT).inFlight).toBe(false);
  });
});
