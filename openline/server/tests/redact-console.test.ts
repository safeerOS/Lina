import { describe, expect, it, vi } from "vitest";
import { StreamManager } from "../src/stream/stream-manager.js";
import { AgentManager } from "../src/agent/agent-manager.js";

describe("redact logs", () => {
  it("does not log full number on takeover denied in stream manager", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    
    const sm = new StreamManager({ 
      allowlistMode: "allowlist", 
      allowlist: [], 
      deviceChannel: {} as any 
    });
    
    (sm as any).command({ id: "c1", remoteNumber: "+38640111222" }, "answer");

    expect(errorSpy).toHaveBeenCalled();
    const calls = errorSpy.mock.calls.map(c => c.join(" ")).join(" ");
    expect(calls).not.toContain("+38640111222");
    expect(calls).not.toContain("38640111");
    expect(calls).toContain("**22");
    
    errorSpy.mockRestore();
  });

  it("does not log full number on takeover denied in agent manager", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    
    const am = new AgentManager({ 
      allowlistMode: "allowlist", 
      allowlist: [], 
      deviceChannel: {} as any,
      settings: { get: () => ({}) } as any
    });
    
    (am as any).command({ id: "c1", remoteNumber: "+38640111222" }, "answer");

    expect(errorSpy).toHaveBeenCalled();
    const calls = errorSpy.mock.calls.map(c => c.join(" ")).join(" ");
    expect(calls).not.toContain("+38640111222");
    expect(calls).not.toContain("38640111");
    expect(calls).toContain("**22");
    
    errorSpy.mockRestore();
  });
});
