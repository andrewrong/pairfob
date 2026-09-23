/**
 * Which Settings page is showing: the overview or one of its sub-pages.
 *
 * Presentation state only, kept outside the component so an entry from another
 * screen (the computer panel's "Connection details") can land on a sub-page.
 * Leaving Settings returns it to the overview.
 */
export type SettingsSection = "overview" | "connection" | "devices";

let section: SettingsSection = "overview";
const listeners = new Set<() => void>();

export function settingsSection(): SettingsSection {
  return section;
}

export function subscribeSettingsSection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSettingsSection(next: SettingsSection): void {
  if (section === next) return;
  section = next;
  for (const listener of [...listeners]) listener();
}
