/**
 * The one form of an academic year. It is part of a cohort's key, so a year typed another way
 * addresses a partition nothing was ever written to — an empty screen with nothing to explain it.
 * The same rule is enforced by the API in `lambdas/shared/table.py`; this only saves the trip.
 */

export const YEAR_FORM = "2025-2026";

export const YEAR_HINT = `An academic year is written as two years in a row, like ${YEAR_FORM}.`;

const CANON = /^(\d{4})-(\d{4})$/;

export function isAcademicYear(value: string): boolean {
  const found = CANON.exec(value.trim());
  return found !== null && Number(found[2]) === Number(found[1]) + 1;
}
