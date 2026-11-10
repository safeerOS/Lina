import { describe, expect, it } from "vitest";
import { redactPhone, takeoverDenied } from "../src/redact.js";

describe("redactPhone", () => {
  it("writes only the last two digits", () => {
    const full = "+38640111222";
    expect(redactPhone(full)).toBe("**22");
    expect(redactPhone(full)).not.toContain("38640");
    const listed = takeoverDenied(full, "seznamu");
    const allowed = takeoverDenied(full, "dovoljena");
    expect(listed).toBe("prevzem zavrnjen, **22 ni na seznamu");
    expect(allowed).toBe("prevzem zavrnjen, **22 ni dovoljena");
    expect(listed).not.toContain(full);
    expect(allowed).not.toContain("40111");
    expect(redactPhone(null)).toBe("neznana");
    expect(redactPhone("")).toBe("neznana");
    expect(redactPhone("7")).toBe("neznana");
    expect(takeoverDenied(undefined, "seznamu")).toBe("prevzem zavrnjen, neznana ni na seznamu");
  });
});
