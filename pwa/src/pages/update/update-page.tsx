import { goToScreen } from "../../app/navigation-store";
import { commitView } from "../../app/host";
import { DaemonUpdate } from "../../features/settings/daemon-update-view";
import { t } from "../../lib/i18n";
import { BackBar } from "../../shared/ui/primitives";

/**
 * Computer update, a settings sub-page.
 *
 * The detailed update view (version, check, update, progress and the manual
 * command) moved off the bottom of the long settings list onto its own page,
 * reached from the settings row and from the home activity strip. Back returns
 * to settings through the application port, like the quota page.
 */
export function UpdateContent() {
  return (
    <>
      <BackBar
        title={t("update.title")}
        onBack={() => {
          goToScreen("settings");
          commitView();
        }}
      />
      <DaemonUpdate />
    </>
  );
}

export function UpdateScreen() {
  return (
    <div className="page settings-page update-page">
      <UpdateContent />
    </div>
  );
}
