/**
 * daemon-update installs its visibility/focus listeners on whichever `document`
 * is global the first time anything checks for a release, and never again. In one
 * process that is the first file's private DOM, so a later file dispatching on the
 * shared boot-dom window would never reach it. Install them once, on boot-dom's
 * window, before any file runs, then hand the globals back untouched.
 */
const keys = ["window", "document", "navigator", "location", "localStorage", "sessionStorage", "IS_REACT_ACT_ENVIRONMENT"] as const;
const globals = globalThis as unknown as Record<string, unknown>;
const saved = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));

const { installTestDOM, happy } = await import("./boot-dom");
const { observeDaemonUpdates } = await import("../src/features/settings/daemon-update");
installTestDOM();
observeDaemonUpdates();

for (const key of keys) {
  const was = saved.get(key);
  if (was) Object.defineProperty(globalThis, key, was); else delete globals[key];
}
void happy;
