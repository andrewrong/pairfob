import { beforeEach } from "bun:test";
import { resetTelemetry, setTelemetrySender } from "../src/lib/telemetry";

// Product code queues beacons that flush on a timer. The default sender POSTs to
// /v2/events through Happy DOM's real fetch; its late DNS failure surfaces as an
// unhandled error inside whichever unrelated test is running. A test that cares
// about telemetry installs its own sender in its body, which still wins.
beforeEach(() => {
  resetTelemetry();
  setTelemetrySender(() => undefined);
});
