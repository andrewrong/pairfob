import { AttachmentConnection, useAttachmentP2PReady } from "./attachments-connection";
import { memo, useRef, useSyncExternalStore } from "react";
import { presentModal } from "../../../shared/ui/overlay/modal";
import { SheetFrame } from "../../../shared/ui/overlay/action-sheet";
import { Button } from "../../../shared/ui/primitives/button";
import { haptic } from "../../../lib/dom";
import { currentDaemonId, liveSession } from "../../computers/catalog-store";
import { phase, sessionTransport } from "../../connection/connection-store";
import { openPaneId } from "../session-store";
import { computersStore } from "../../computers/catalog-store";
import { connectionStore } from "../../connection/connection-store";
import { sessionStore } from "../session-store";
import { attachT, type AttachCopyKey } from "./attach-copy";
import type { AttachmentItem, AttachmentScope } from "./attach-model";
import { canInsert, etaParts, formatBytes, progressPercent, speedParts } from "./attach-model";
import { attachmentsStore, attachmentScopeKey, queueSnapshot, runtimeObjectUrl, runtimeCheckpoint, setImageIntent, setPreference } from "./attachments-store";
import {
  addPickedFiles,
  cancelUpload,
  checkUpload,
  editImage,
  hasUploadHandle,
  insertPaths,
  removeItem,
  resumeUpload,
  startAllQueued,
  startUpload,
} from "./attachments-controller";
import { LOCAL_INTAKE_LIMITS } from "./attachments-admission";
import { restoreAttachmentScope } from "./attachments-recovery";
import { presentImageEditor } from "./image-editor/image-editor";

/** Reactive check that the pane that owns the queue is still the open live pane. */
function useScopeIsCurrent(scope: AttachmentScope): boolean {
  return useSyncExternalStore(
    (listener) => {
      const unsubs = [
        sessionStore.subscribe(listener),
        computersStore.subscribe(listener),
        connectionStore.subscribe(listener),
        attachmentsStore.subscribe(listener),
      ];
      return () => unsubs.forEach((unsubscribe) => unsubscribe());
    },
    () => phase() === "live"
      && openPaneId() === scope.paneId
      && currentDaemonId() === scope.daemonId
      && liveSession() !== null,
  );
}

function useQueue(scope: AttachmentScope) {
  const key = attachmentScopeKey(scope);
  return useSyncExternalStore(
    attachmentsStore.subscribe,
    () => attachmentsStore.get().queues[key],
  ) ?? queueSnapshot(key);
}

type Source = "files" | "photos" | "camera";

function SourceButtons({ onPick, disabled }: { onPick: (source: Source) => void; disabled: boolean }) {
  return <div className="attach-sources" role="group">
    <Button className="attach-source" disabled={disabled} onClick={() => onPick("files")}>{attachT("attach.files")}</Button>
    <Button className="attach-source" disabled={disabled} onClick={() => onPick("photos")}>{attachT("attach.photos")}</Button>
    <Button className="attach-source" disabled={disabled} onClick={() => onPick("camera")}>{attachT("attach.camera")}</Button>
  </div>;
}

function statusLabel(item: AttachmentItem, ready: boolean): string {
  // A scheduled row waiting for the serial scheduler says so honestly; an
  // explicit transfer phase (when present) names the live stage.
  if (item.scheduled && item.status === "queued") return attachT("attach.scheduled");
  if (item.transferPhase) {
    switch (item.transferPhase) {
      case "waiting-p2p": return attachT(ready ? "attach.waitingContinue" : "attach.waitingP2P");
      case "persisting": return attachT("attach.phase.persisting");
      case "queued": return attachT("attach.status.queued");
      case "compressing": return attachT("attach.compressing");
      case "hashing": return attachT("attach.phase.hashing");
      case "begin": return attachT("attach.phase.begin");
      case "sending": return attachT("attach.phase.sending");
      case "commit": return attachT("attach.phase.commit");
      case "status": return attachT("attach.phase.status");
    }
  }
  switch (item.status) {
    case "queued": return attachT("attach.status.queued");
    case "preparing": return attachT("attach.status.preparing");
    case "uploading": return attachT("attach.status.uploading", { percent: progressPercent(item) });
    case "cancelling": return attachT("attach.status.cancelling");
    case "committed": return attachT("attach.status.committed");
    case "cancelled": return attachT("attach.status.cancelled");
    case "error": return item.errorText || (item.recoverable ? attachT("attach.paused", { done: formatBytes(item.acknowledged), total: formatBytes(item.size) }) : "");
  }
}

/**
 * Live throughput line for an uploading row: acknowledged bytes, measured
 * speed and approximate ETA. After a confirmation stall it shows a waiting
 * note instead of a stale rate. Rate is rendered only while uploading — every
 * paused/error/cancel/complete state hides it.
 */
function MeterLine({ item }: { item: AttachmentItem }) {
  if (item.status !== "uploading") return null;
  const byteText = `${formatBytes(item.acknowledged)} / ${formatBytes(item.size)}`;
  if (item.waiting) {
    return <p className="attach-rate">
      <span className="attach-rate-bytes">{byteText}</span>
      <span className="attach-waiting">{attachT("attach.waiting")}</span>
    </p>;
  }
  const parts: string[] = [byteText];
  const speed = typeof item.speedBps === "number" ? speedParts(item.speedBps) : null;
  if (speed) parts.push(attachT(speed.unit === "kib" ? "attach.speed.kib" : "attach.speed.mib", { value: speed.value }));
  const eta = typeof item.etaSeconds === "number" ? etaParts(item.etaSeconds) : null;
  if (eta) parts.push(attachT(eta.kind === "seconds" ? "attach.eta.seconds" : "attach.eta.minutes", { value: eta.value }));
  return <p className="attach-rate">{parts.map((part, index) =>
    <span key={index} className={index === 0 ? "attach-rate-bytes" : "attach-rate-metric"}>{part}</span>
  )}</p>;
}

const Row = memo(function Row({ scope, item, scopeCurrent, canUpload }: { scope: AttachmentScope; item: AttachmentItem; scopeCurrent: boolean; canUpload: boolean }) {
  const active = item.status === "preparing" || item.status === "uploading";
  const cancelling = item.status === "cancelling";
  const cancelUncertain = item.status === "error" && item.cancelIntent;
  const thumb = item.kind === "image" ? runtimeObjectUrl(attachmentScopeKey(scope), item.localId) : "";
  return <li className={`attach-row attach-${item.status}`}>
    <div className="attach-thumb" aria-hidden={item.kind !== "image"}>
      {thumb ? <img src={thumb} alt="" decoding="async" loading="lazy" /> : <span className="attach-thumb-mark" />}
    </div>
    <div className="attach-meta">
      <p className="attach-name" title={item.name}>{item.name}</p>
      <p className={`attach-status${item.status === "error" ? " is-error" : ""}`}>{statusLabel(item, canUpload)}</p>
      {item.restored && <p className="attach-restored">{attachT("attach.restoredNote")}</p>}
      {item.persistenceWarning && <p className="attach-persist-warn">{item.persistenceWarning}</p>}
      {item.editNote && <p className="attach-edit-note">{item.editNote}</p>}
      {item.kind === "image" && <IntentControl storeKey={attachmentScopeKey(scope)} item={item} />}
      {item.kind === "image" && <ModeControl storeKey={attachmentScopeKey(scope)} item={item} />}
      {item.kind === "image" && item.compressing && item.status === "preparing" && item.transferPhase !== "compressing"
        && <p className="attach-compression is-compressing">{attachT("attach.compressing")}</p>}
      <CompressionOutcome item={item} />
      <MeterLine item={item} />
      <TransferDetails item={item} scopeCurrent={scopeCurrent} />
      {(active || cancelling) && <progress className="attach-progress" max={item.size || 1} value={item.acknowledged} />}
    </div>
    <div className="attach-row-actions">
      {item.status === "queued" && <>
        {/* A scheduled row is already claimed by the bounded scheduler: its
            preparation may be one step away, so Upload/Edit hide and only an
            immediate Cancel (plus Remove) stays available. */}
        {item.kind === "image" && !item.scheduled && <Button className="attach-act" onClick={() => {
          haptic(2);
          void editImage(scope, item.localId, (input) => presentImageEditor(input));
        }}>{attachT("attach.edit")}</Button>}
        {!item.scheduled
          && <Button className="attach-act" disabled={!canUpload} onClick={() => startUpload(scope, item.localId)}>{attachT("attach.upload")}</Button>}
        {item.scheduled
          && <Button className="attach-act attach-danger" onClick={() => cancelUpload(scope, item.localId)}>{attachT("attach.cancel")}</Button>}
        <Button className="attach-act attach-danger" onClick={() => void removeItem(scope, item.localId)}>{attachT("attach.remove")}</Button>
      </>}
      {(active || cancelling) && <Button className="attach-act attach-danger" disabled={cancelling}
        onClick={() => cancelUpload(scope, item.localId)}>{attachT("attach.cancel")}</Button>}
      {item.status === "committed" && (item.inserted
        ? <span className="attach-inserted">{attachT("attach.inserted")}</span>
        : <Button className="attach-act" disabled={!scopeCurrent} onClick={() => void insertPaths(scope, [item.localId])}>{attachT("attach.insert")}</Button>)}
      {item.status === "committed" && <Button className="attach-act attach-danger" onClick={() => void removeItem(scope, item.localId)}>{attachT("attach.remove")}</Button>}
      {item.status === "cancelled" && <>
        <Button className="attach-act" disabled={!canUpload} onClick={() => startUpload(scope, item.localId)}>{attachT("attach.upload")}</Button>
        <Button className="attach-act attach-danger" onClick={() => void removeItem(scope, item.localId)}>{attachT("attach.remove")}</Button>
      </>}
      {cancelUncertain && <>
        {/* Read-only reconciliation and another cancel; never resume/Begin. */}
        <Button className="attach-act" disabled={!scopeCurrent} onClick={() => void checkUpload(scope, item.localId)}>{attachT("attach.checkStatus")}</Button>
        <Button className="attach-act" disabled={!scopeCurrent} onClick={() => cancelUpload(scope, item.localId)}>{attachT("attach.retryCancel")}</Button>
      </>}
      {item.status === "error" && !item.cancelIntent && (() => {
        // A recoverable outcome exposes an explicit Resume. A retained remote
        // handle that is not resumable is reconciled with Check/Cancel only —
        // never a "Retry" that would abandon it or silently no-op. Fresh Retry
        // appears only once no unresolved handle remains.
        if (item.recoverable) {
          return <>
            <Button className="attach-act" disabled={!scopeCurrent || item.transferPhase === "status"}
              onClick={() => void checkUpload(scope, item.localId)}>{attachT("attach.checkStatus")}</Button>
            <Button className="attach-act" disabled={!canUpload || item.transferPhase === "status"} onClick={() => resumeUpload(scope, item.localId)}>{attachT("attach.resume")}</Button>
            <Button className="attach-act attach-danger" onClick={() => void removeItem(scope, item.localId)}>{attachT("attach.remove")}</Button>
          </>;
        }
        if (hasUploadHandle(scope, item.localId)) {
          return <>
            <Button className="attach-act" disabled={!scopeCurrent} onClick={() => void checkUpload(scope, item.localId)}>{attachT("attach.checkStatus")}</Button>
            <Button className="attach-act" disabled={!scopeCurrent} onClick={() => cancelUpload(scope, item.localId)}>{attachT("attach.cancel")}</Button>
            <Button className="attach-act attach-danger" onClick={() => void removeItem(scope, item.localId)}>{attachT("attach.remove")}</Button>
          </>;
        }
        return <>
          <Button className="attach-act" disabled={!canUpload} onClick={() => startUpload(scope, item.localId)}>{attachT("attach.retry")}</Button>
          <Button className="attach-act attach-danger" onClick={() => void removeItem(scope, item.localId)}>{attachT("attach.remove")}</Button>
        </>;
      })()}
    </div>
  </li>;
});

function formatLimits(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  return `${Math.round(bytes / 1024)} KiB`;
}

/**
 * Per-image compression preference. Undefined mode means smart. Only safely
 * idle image rows may change it: an active transfer, a retained runtime
 * checkpoint (authoritative), a pending cancel intent, or a committed result
 * freezes the source choice. The change itself is delegated to the store; a
 * fresh upload compresses elsewhere.
 */
function canChangeCompressionMode(storeKey: string, item: AttachmentItem): boolean {
  if (item.kind !== "image") return false;
  if (item.status === "preparing" || item.status === "uploading"
    || item.status === "cancelling" || item.status === "committed") return false;
  if (item.cancelIntent) return false;
  if (item.scheduled) return false;
  return runtimeCheckpoint(storeKey, item.localId) === null;
}

/**
 * Per-image rendering intent as a native SELECT (aria-label 图片用途).
 * Default is photo. Same frozen guards as the compression mode, plus a
 * scheduled row: setImageIntent re-validates them in the store.
 */
function IntentControl({ storeKey, item }: { storeKey: string; item: AttachmentItem }) {
  const intent = item.imageIntent ?? "photo";
  const changeable = item.kind === "image" && canChangeCompressionMode(storeKey, item);
  const captionId = `attach-intent-caption-${item.localId}`;
  return <div className="attach-intent">
    <select className="attach-intent-select" aria-label={attachT("attach.intentLabel")} aria-describedby={captionId}
      value={intent} disabled={!changeable} onChange={(event) => {
        const next = event.target.value;
        if (next === intent || (next !== "photo" && next !== "detail")) return;
        haptic(2);
        setImageIntent(storeKey, item.localId, next);
      }}>
      <option value="photo">{attachT("attach.intent.photo")}</option>
      <option value="detail">{attachT("attach.intent.detail")}</option>
    </select>
    <p className="attach-intent-caption" id={captionId}>
      {intent === "detail" ? attachT("attach.intentCaption.detail") : ""}
    </p>
  </div>;
}

/**
 * Frozen store/model contract for the compression fields, landed on
 * AttachmentItem by the sibling change. Read-only here; the store is the
 * single authority and is never stubbed in this leaf.
 */
function ModeControl({ storeKey, item }: { storeKey: string; item: AttachmentItem }) {
  const mode = item.compressionMode ?? "smart";
  const changeable = canChangeCompressionMode(storeKey, item);
  const groupName = `attach-mode-${item.localId}`;
  const captionId = `attach-mode-caption-${item.localId}`;
  const choose = (value: "smart" | "original") => {
    if (value === mode) return;
    haptic(2);
    setPreference(storeKey, item.localId, value);
  };
  return <>
    <div className="attach-mode" role="radiogroup" aria-label={attachT("attach.modeLabel")} aria-describedby={captionId}>
      <label className={`attach-mode-option${mode === "smart" ? " is-on" : ""}`}>
        <input type="radio" name={groupName} value="smart" checked={mode === "smart"}
          disabled={!changeable} onChange={() => choose("smart")} />
        <span>{attachT("attach.mode.smart")}</span>
      </label>
      <label className={`attach-mode-option${mode === "original" ? " is-on" : ""}`}>
        <input type="radio" name={groupName} value="original" checked={mode === "original"}
          disabled={!changeable} onChange={() => choose("original")} />
        <span>{attachT("attach.mode.original")}</span>
      </label>
    </div>
    {/* Caption lives OUTSIDE the radiogroup; the group references it via
        aria-describedby. Always-valid general text, never tied to editNote. */}
    <p className="attach-mode-caption" id={captionId}>{attachT("attach.modeCaption")}</p>
  </>;
}

/**
 * Expandable per-stage timings, only when stageTimings actually exists.
 * Real numeric ms per stage plus source/upload bytes; the live transport is
 * shown only while this scope is still current (never an inferred route).
 */
type StageKey = "compression" | "hashing" | "persistence" | "begin" | "sending" | "commit" | "status";
const STAGE_ORDER: readonly StageKey[] = ["compression", "hashing", "persistence", "begin", "sending", "commit", "status"];

function transportLabel(transport: "relay" | "p2p"): string {
  return attachT(transport === "p2p" ? "attach.transport.p2p" : "attach.transport.relay");
}

function TransferDetails({ item, scopeCurrent }: { item: AttachmentItem; scopeCurrent: boolean }) {
  const timings = item.stageTimings;
  if (!timings) return null;
  const stages = STAGE_ORDER.filter((stage) =>
    typeof timings[stage] === "number" && Number.isFinite(timings[stage]) && timings[stage]! >= 0);
  if (!stages.length) return null;
  // The captured transport is labeled as the connection WHEN UPLOAD STARTED —
  // never as a claim the whole transfer used one route. The CURRENT connection
  // is shown separately, only while the scope is live and it differs.
  const current = scopeCurrent ? sessionTransport() : null;
  return <details className="attach-details">
    <summary>{attachT("attach.details")}</summary>
    <ul className="attach-stages">
      {stages.map((stage) => <li key={stage}>
        {attachT("attach.stage.ms", { name: attachT(`attach.stage.${stage}` as AttachCopyKey), ms: Math.round((timings[stage] as number) * 10) / 10 })}
      </li>)}
      <li>{attachT("attach.bytes", {
        source: formatBytes(item.originalBytes ?? item.size),
        upload: formatBytes(item.size),
      })}</li>
      {item.transferTransport
        && <li>{attachT("attach.transportStart", { transport: transportLabel(item.transferTransport) })}</li>}
      {current && (!item.transferTransport || current !== item.transferTransport)
        && <li>{attachT("attach.transportCurrent", { transport: transportLabel(current) })}</li>}
    </ul>
  </details>;
}

/**
 * Completed compression outcome, once the store has published it. Real saved
 * bytes are claimed only when the result actually changed the file; every
 * preserve/fallback reason states that the original was kept and never
 * claims gains before a result exists.
 */
function CompressionOutcome({ item }: { item: AttachmentItem }) {
  if (item.kind !== "image" || item.compressing || !item.compressionReason) return null;
  if (item.compressionChanged && typeof item.originalBytes === "number" && item.originalBytes > 0) {
    // Floor to whole percent (or one decimal), capped at 99.9: a nonzero
    // remainder must never round up to a claimed "100% saved".
    const raw = Math.max(0, (1 - item.size / item.originalBytes) * 100);
    const floored = Math.min(99.9, Math.floor(raw * 10) / 10);
    const percent = Number.isInteger(floored) ? floored : floored.toFixed(1);
    return <p className="attach-compression is-saved">{attachT("attach.compression.saved", {
      from: formatBytes(item.originalBytes),
      to: formatBytes(item.size),
      percent,
    })}{dimsNote(item)}</p>;
  }
  const note = item.compressionReason === "preserved"
    ? (item.imageIntent === "detail"
      ? attachT("attach.compression.detailPreserved")
      : attachT("attach.compression.preserved"))
    : item.compressionReason === "small" ? attachT("attach.compression.small")
    : item.compressionReason === "not-smaller" ? attachT("attach.compression.notSmaller")
    : item.compressionReason === "unsupported" ? attachT("attach.compression.unsupported")
    : item.compressionReason === "failed" ? attachT("attach.compression.failed")
    : attachT("attach.compression.kept");
  return <p className="attach-compression">{note}{dimsNote(item)}</p>;
}

/** Real measured output dimensions, shown only when the pipeline reported them. */
function dimsNote(item: AttachmentItem): string {
  if (typeof item.outputWidth === "number" && typeof item.outputHeight === "number"
    && item.outputWidth > 0 && item.outputHeight > 0) {
    return ` · ${item.outputWidth} × ${item.outputHeight}`;
  }
  return "";
}

/**
 * Raw source bytes govern the batch capacity: an image's pre-compression size
 * (when known) is what counts against the limit, never less than the current
 * size. The actual upload progress still uses item.size.
 */
function capacityBytes(item: AttachmentItem): number {
  return Math.max(item.originalBytes ?? item.size, item.size);
}

function AttachmentSheetBody({ scope }: { scope: AttachmentScope }) {
  const queue = useQueue(scope);
  const scopeCurrent = useScopeIsCurrent(scope);
  const ready = useAttachmentP2PReady();
  const canUpload = scopeCurrent && ready;
  const filesInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const items = queue?.items ?? [];
  const queued = items.filter((item) => item.status === "queued" && !item.scheduled);
  const insertable = items.filter((item) => canInsert(item));
  const used = items.reduce((total, item) => total + capacityBytes(item), 0);
  // The capacity line is LOCAL retained-source capacity (80 MiB batch, 5
  // files; large JPEG candidates up to 40 MiB each). The remote upload caps
  // (20 MiB/file, 40 MiB/batch) are stated separately and honestly.

  async function picked(source: Source, list: FileList | null): Promise<void> {
    if (list && list.length) await addPickedFiles(scope, list);
    const input = source === "files" ? filesInput.current : source === "photos" ? photosInput.current : cameraInput.current;
    if (input) input.value = "";
  }

  return <div className="attach-sheet">
    <p className="attach-hint">{attachT("attach.hint")}</p>
    <SourceButtons disabled={!scopeCurrent} onPick={(source) => {
      haptic(2);
      (source === "files" ? filesInput : source === "photos" ? photosInput : cameraInput).current?.click();
    }} />
    <input ref={filesInput} type="file" multiple tabIndex={-1} aria-hidden="true" className="attach-native-input"
      accept="*/*" onChange={(event) => void picked("files", event.target.files)} />
    <input ref={photosInput} type="file" multiple tabIndex={-1} aria-hidden="true" className="attach-native-input"
      accept="image/*" onChange={(event) => void picked("photos", event.target.files)} />
    <input ref={cameraInput} type="file" tabIndex={-1} aria-hidden="true" className="attach-native-input"
      accept="image/*" capture="environment" onChange={(event) => void picked("camera", event.target.files)} />

    <AttachmentConnection scope={scope} current={scopeCurrent} ready={ready} />
    {!scopeCurrent && <p className="attach-banner" role="alert">{attachT("attach.scopeMoved")}</p>}

    {items.length === 0
      ? <p className="attach-empty">{attachT("attach.empty")}</p>
      : <ul className="attach-list">
        {items.map((item) => <Row key={item.localId} scope={scope} item={item} scopeCurrent={scopeCurrent} canUpload={canUpload} />)}
      </ul>}

    <p className="attach-capacity">{attachT("attach.capacity", {
      used: formatBytes(used),
      max: formatLimits(LOCAL_INTAKE_LIMITS.batchBytes),
      count: items.length,
      files: LOCAL_INTAKE_LIMITS.maxFiles,
    })}</p>
    <p className="attach-capacity-remote">{attachT("attach.capacityRemote", {
      file: formatLimits(20 * 1024 * 1024),
      batch: formatLimits(40 * 1024 * 1024),
    })}</p>

    <div className="attach-footer">
      <Button className="btn" disabled={!canUpload || queued.length === 0}
        onClick={() => void startAllQueued(scope)}>{attachT("attach.uploadAll")}</Button>
      <Button className="btn btn-primary" disabled={!scopeCurrent || insertable.length === 0}
        onClick={() => void insertPaths(scope)}>{attachT("attach.insertAll")}</Button>
    </div>
    {/* One aria-live status region. Visually hidden only while empty; a
        nonempty rejection/notice is rendered visibly with wrapping so sighted
        mobile users see why a pick was rejected. */}
    <p className={`attach-live${queue?.notice ? "" : " sr-only"}`} role="status" aria-live="polite">{queue?.notice ?? ""}</p>
  </div>;
}

export function presentAttachmentSheet(scope: AttachmentScope): void {
  // Durable restore is async, scoped to the CURRENT live authorized pane, and
  // re-gated after the read. It never starts an upload and live rows always
  // win over journal rows; the sheet offers explicit resume for checkpoints.
  void restoreAttachmentScope(scope);
  presentModal((modal) => (
    <SheetFrame modal={modal} title={attachT("attach.title")} className="attach-modal">
      <AttachmentSheetBody scope={scope} />
    </SheetFrame>
  ));
}
