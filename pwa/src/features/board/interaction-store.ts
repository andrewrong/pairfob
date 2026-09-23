import { createDomain } from "../../shared/model/domain-store";

/** Ephemeral board attention; never changes the selected terminal session. */
const domain = createDomain("boardInteraction", { paneId: "", createdPaneId: "", tabId: "" });
export const boardInteractionStore = domain.store;
let expiry: ReturnType<typeof setTimeout> | undefined;

export function highlightBoardPane(paneId: string, tabId: string, created = false): void {
  clearTimeout(expiry);
  domain.controller.write(record => {
    record.paneId = paneId;
    record.tabId = tabId;
    record.createdPaneId = created ? paneId : "";
  });
  if (created) expiry = setTimeout(() => {
    domain.controller.write(record => { record.paneId = ""; });
  }, 3000);
}

export function clearBoardInteraction(): void {
  clearTimeout(expiry);
  domain.controller.write(record => { record.paneId = ""; record.createdPaneId = ""; record.tabId = ""; });
}
