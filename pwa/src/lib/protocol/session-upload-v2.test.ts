import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The GetConfig capability-guard / V2 wrapper tests drive a real
// ReconnectingSession with network/negotiation I/O stubbed via bun
// mock.module, which is process-global. They run in a child process (see
// workspace-media-ownership.test.ts for the same pattern) so the stubbed openWS
// cannot serve other protocol tests in the suite process.
describe("upload v2 capability guard + wrappers (isolated child process)", () => {
  test("latest GetConfig wins, losses clear, switch relearns, V2 wrappers parse 131072 only", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pwaRoot = resolve(here, "../../..");
    const target = resolve(pwaRoot, "test-support", "session-upload-v2-isolated.test.ts");
    const proc = Bun.spawn(["bun", "test", target, "--timeout", "20000"], {
      cwd: pwaRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exit = await proc.exited;
    if (exit !== 0) {
      throw new Error(`isolated upload v2 test exited ${exit}\n${stdout}\n${stderr}`);
    }
    // Bun writes the run summary to stderr.
    expect(stderr).toContain("9 pass");
    expect(stderr).toContain("0 fail");
  }, 25_000);
});
