/**
 * Whether a run is in flight, worked out on the screen because nothing about a run is stored.
 *
 * The gap this closes: `/run` invokes the worker and returns without waiting, so the POST is done
 * a second after the press while the worker has not claimed anything yet. Read claims alone and
 * the screen unlocks itself in that gap, which is how one cohort took six overlapping runs. So a
 * press counts as in flight on its own, but only for a window — a worker that died before
 * claiming must not leave every button stuck.
 *
 * What this cannot do is tell our own run's claims from another screen's: the claim carries a run
 * id the worker makes up, so the browser never learns it. Both lock the triggers, which is the
 * part that matters; only the label can end up naming the wrong press.
 */

/** A run this screen started and has not seen finish. */
export interface Started {
  /** When the press came back started, as epoch milliseconds. */
  at: number;
  /** Which trigger it was, so that button is the one that says it is running. */
  key: string;
  label: string;
  work: number;
}

export interface RunStatus {
  inFlight: boolean;
  /** Started, and no claim has appeared yet. */
  settling: boolean;
  /** The trigger to mark as running, or null when this screen did not start anything. */
  activeKey: string | null;
}

// Long enough for a cold start, short enough that a worker that never claims frees the buttons.
export const SETTLE_MS = 20_000;

/** Is a press too recent for its first claim to have shown up? */
export function settling(started: Started | null, now: number): boolean {
  return started !== null && now - started.at < SETTLE_MS;
}

/**
 * What the triggers should do. `claimed` is how many applications the cohort read shows held by
 * an unexpired claim — claims with no press of ours behind them still lock the screen, because a
 * run someone else started is just as much a reason not to start another.
 */
export function runStatus(
  started: Started | null,
  claimed: number,
  now: number = Date.now(),
): RunStatus {
  const waiting = settling(started, now);
  const inFlight = claimed > 0 || waiting;
  return {
    inFlight,
    settling: waiting && claimed === 0,
    activeKey: inFlight && started !== null ? started.key : null,
  };
}
