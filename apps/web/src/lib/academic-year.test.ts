import { describe, expect, it } from "vitest";
import { isAcademicYear } from "./academic-year";

describe("isAcademicYear", () => {
  it("takes two years running and nothing else", () => {
    expect(isAcademicYear("2025-2026")).toBe(true);
    expect(isAcademicYear(" 2025-2026 ")).toBe(true);

    // Each of these built a different, empty cohort before the form was fixed.
    expect(isAcademicYear("2026")).toBe(false);
    expect(isAcademicYear("25-26")).toBe(false);
    expect(isAcademicYear("2025-2027")).toBe(false);
    expect(isAcademicYear("2025/2026")).toBe(false);
    expect(isAcademicYear("")).toBe(false);
  });
});
