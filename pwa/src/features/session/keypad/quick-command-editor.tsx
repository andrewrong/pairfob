import { ArrowUp, ArrowDown, Trash2, Plus, X } from "lucide-react";
import { useState } from "react";
import { t } from "../../../lib/i18n";
import { ModalFrame, presentModal, type ModalController } from "../../../shared/ui/overlay/modal";
import { setQuickCommands } from "../../settings/preferences-store";
import { QUICK_COMMAND_LIMIT, QUICK_LABEL_LIMIT, QUICK_TEXT_LIMIT, QUICK_PIN_LIMIT,
  parseQuickCommands, type QuickCommand } from "../../settings/quick-command-model";

export function defaultQuickCommands(): QuickCommand[] {
  return [
    { id: "review", label: t("quick.reviewLabel"), text: t("quick.reviewText"), pinned: false },
    { id: "test", label: t("quick.testLabel"), text: t("quick.testText"), pinned: false },
    { id: "summary", label: t("quick.summaryLabel"), text: t("quick.summaryText"), pinned: false },
  ];
}

function QuickCommandEditor({ modal, initial }: { modal: ModalController<boolean>; initial: readonly QuickCommand[] }) {
  const [items, setItems] = useState(() => initial.map(item => ({ ...item })));
  const update = (id: string, patch: Partial<QuickCommand>) =>
    setItems(old => old.map(item => item.id === id ? { ...item, ...patch } : item));
  const move = (index: number, direction: number) => setItems(old => {
    const next = [...old];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    return next;
  });
  const pins = items.filter(item => item.pinned).length;
  return <ModalFrame modal={modal} title={t("quick.manage")} className="modal quick-command-editor"
    heading={<div className="quick-editor-heading"><h2 id={modal.titleId} className="modal-title">{t("quick.manage")}</h2>
      <button type="button" className="quick-icon" aria-label={t("close")} onClick={modal.dismiss}><X size={20} /></button></div>}
    onSubmit={event => {
      event.preventDefault();
      if (setQuickCommands(items)) modal.close(true);
    }}>
    <p className="lede">{t("quick.help")}</p>
    <div className="quick-command-list">
      {items.map((item, index) => <fieldset key={item.id}>
        <legend className="sr-only">{index + 1}</legend>
        <div className="quick-card-heading">
          <span className="quick-card-number">{String(index + 1).padStart(2, "0")}</span>
          <div className="quick-card-actions">
            <button type="button" className="quick-icon" aria-label={t("quick.up")} title={t("quick.up")}
              disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={17} /></button>
            <button type="button" className="quick-icon" aria-label={t("quick.down")} title={t("quick.down")}
              disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={17} /></button>
            <button type="button" className="quick-icon quick-delete" aria-label={t("quick.remove")} title={t("quick.remove")}
              onClick={() => setItems(old => old.filter(value => value.id !== item.id))}><Trash2 size={17} /></button>
          </div>
        </div>
        <label className="quick-field">{t("quick.label")}<input value={item.label} required maxLength={QUICK_LABEL_LIMIT}
          onChange={event => update(item.id, { label: event.target.value })} /></label>
        <label className="quick-field">{t("quick.text")}<textarea value={item.text} required maxLength={QUICK_TEXT_LIMIT} rows={3}
          onChange={event => update(item.id, { text: event.target.value })} /></label>
        <label className="quick-command-pin"><input type="checkbox" checked={item.pinned}
          disabled={!item.pinned && pins >= QUICK_PIN_LIMIT}
          onChange={event => update(item.id, { pinned: event.target.checked })} />{t("quick.pin")}</label>
      </fieldset>)}
    <button type="button" className="quick-add" disabled={items.length >= QUICK_COMMAND_LIMIT}
      onClick={() => setItems(old => [...old, { id: crypto.randomUUID(), label: "", text: "", pinned: false }])}><Plus size={18} />{t("quick.add")}<span>{items.length}/{QUICK_COMMAND_LIMIT}</span></button>
    </div>
    <div className="quick-editor-footer">
      <button type="button" className="btn btn-small btn-ghost" onClick={modal.dismiss}>{t("cancel")}</button>
      <button type="submit" className="btn btn-small btn-primary" disabled={parseQuickCommands(items) === null}>{t("quick.save")}</button>
    </div>
  </ModalFrame>;
}

export function editQuickCommands(initial: readonly QuickCommand[]): void {
  presentModal<boolean>(modal => <QuickCommandEditor modal={modal} initial={initial} />, { replaceKey: "quick-commands" });
}
