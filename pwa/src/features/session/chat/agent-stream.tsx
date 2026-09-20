import { Fragment, type ReactNode, type Ref } from "react";
import { renderMarkdown } from "../../../lib/agent-markdown";
import { groupAgentTurns, groupAgentTurnBlocks, processTitle, replyText, turnKey,
  type AgentTurn, type AgentTurnBlock } from "../../../lib/agent-trace-view";
import type { AgentTraceItem } from "../../../lib/operations";
import { t } from "../../../lib/i18n";
import type { AgentEmptySpec, DetailsState } from "./agent-chat-stream";
import { AgentDetails } from "./agent-details";
import { AgentStep, type ToolDetailHooks } from "./agent-process";
import { Button, Spinner } from "../../../shared/ui/primitives";

type CopyReply = (text: string) => void | Promise<void>;
type TraceAnchor = { key: string; ordinal: number; ordinalFromEnd: number };

function anchorData(anchor: TraceAnchor, part: string) {
  return {
    "data-trace-anchor": `${anchor.key}:${part}`,
    "data-trace-ordinal": anchor.ordinal,
    "data-trace-ordinal-end": anchor.ordinalFromEnd,
  };
}

function AssistantReply({ items, final, live, anchor, part, onCopy }: {
  items: AgentTraceItem[]; final: boolean; live: boolean; anchor: TraceAnchor; part: string; onCopy?: CopyReply;
}) {
  const text = replyText(items);
  return <article {...anchorData(anchor, part)} className={`agent-assistant${final ? " agent-assistant-final" : " agent-assistant-intermediate"}`}>
    {/* The existing Markdown parser returns sanitized allowlisted HTML. */}
    <div className="agent-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
    {final && !live && onCopy && text && <div className="agent-reply-actions">
      <Button className="agent-reply-copy" aria-label={t("chat.copyReplyAria")} onClick={() => void onCopy(text)}>{t("chat.copyReply")}</Button>
    </div>}
  </article>;
}

function ProcessCard({ turn, items, blockIndex, live, anchor, kept, hooks }: {
  turn: AgentTurn; items: AgentTraceItem[]; blockIndex: number; live: boolean; anchor: TraceAnchor; kept?: DetailsState; hooks: ToolDetailHooks;
}) {
  const scope = `${turnKey(turn)}:${blockIndex}`;
  return <AgentDetails traceKey={`p:${scope}`} className="agent-process" auto={live} kept={kept}
    dataTraceAnchor={`${anchor.key}:process:${blockIndex}`} dataTraceOrdinal={anchor.ordinal} dataTraceOrdinalEnd={anchor.ordinalFromEnd}>
    <summary className="agent-process-summary">{processTitle(items, live)}</summary>
    <div className="agent-process-body">
      {items.map((item, index) => <AgentStep key={index} item={item} index={index} scope={scope} kept={kept} hooks={hooks} />)}
    </div>
  </AgentDetails>;
}

function ProcessFold({ turn, blocks, anchor, kept, hooks, onCopy }: {
  turn: AgentTurn; blocks: AgentTurnBlock[]; anchor: TraceAnchor; kept?: DetailsState; hooks: ToolDetailHooks; onCopy?: CopyReply;
}) {
  const count = blocks.reduce((total, block) => total + block.items.length, 0);
  let offset = 0;
  return <AgentDetails traceKey={`f:${turnKey(turn)}`} className="agent-process agent-reply-fold" kept={kept}
    dataTraceAnchor={`${anchor.key}:fold`} dataTraceOrdinal={anchor.ordinal} dataTraceOrdinalEnd={anchor.ordinalFromEnd}>
    <summary className="agent-process-summary agent-reply-fold-summary">
      <span className="agent-reply-fold-title">{t("trace.nSteps", { n: count })}</span>
    </summary>
    <div className="agent-process-body agent-reply-fold-body">
      {blocks.map((block, blockIndex) => {
        const start = offset;
        offset += block.items.length;
        return block.type === "reply" ? <AssistantReply key={`reply:${blockIndex}`} items={block.items} final={false} live={false}
          anchor={anchor} part={`fold-reply:${blockIndex}`} onCopy={onCopy} />
          : <Fragment key={`process:${blockIndex}`}>
            {block.items.map((item, index) => <AgentStep key={start + index} item={item} index={start + index}
              scope={turnKey(turn)} kept={kept} hooks={hooks} />)}
          </Fragment>;
      })}
    </div>
  </AgentDetails>;
}

function TraceTurn({ turn, live, anchor, kept, hooks, onCopy }: {
  turn: AgentTurn; live: boolean; anchor: TraceAnchor; kept?: DetailsState; hooks: ToolDetailHooks; onCopy?: CopyReply;
}) {
  const blocks = groupAgentTurnBlocks(turn.items);
  const finalReply = !live && blocks.at(-1)?.type === "reply" ? blocks.length - 1 : -1;
  let lastProcess = -1;
  for (const [index, block] of blocks.entries()) if (block.type === "process") lastProcess = index;
  return <>
    {turn.user && <article className="agent-user" {...anchorData(anchor, "user")}><div className="agent-user-text">{turn.user.text || ""}</div></article>}
    {finalReply > 0 && <ProcessFold turn={turn} blocks={blocks.slice(0, finalReply)} anchor={anchor}
      kept={kept} hooks={hooks} onCopy={onCopy} />}
    {finalReply >= 0 ? <AssistantReply items={blocks[finalReply].items} final live={live}
      anchor={anchor} part={`reply:${finalReply}`} onCopy={onCopy} />
      : blocks.map((block, index) => block.type === "process"
        ? <ProcessCard key={`process:${index}`} turn={turn} items={block.items} blockIndex={index}
          live={live && index === lastProcess} anchor={anchor} kept={kept} hooks={hooks} />
        : <AssistantReply key={`reply:${index}`} items={block.items} final={false} live={live}
          anchor={anchor} part={`reply:${index}`} onCopy={onCopy} />)}
    {live && <div className="agent-run-status" role="status" aria-live="polite">
      <Spinner /><span>{turn.items.length ? t("trace.runningSteps", { n: turn.items.length }) : t("chat.runningEllipsis")}</span>
    </div>}
  </>;
}

function EmptyPanel({ spec, onRetry, onTerminal }: { spec: AgentEmptySpec; onRetry?: () => void; onTerminal?: () => void }) {
  return <div className={`agent-empty agent-empty-${spec.kind}`} role={spec.kind === "error" ? "alert" : "status"}>
    {(spec.kind === "loading" || spec.kind === "working") && <Spinner />}
    <p className="agent-empty-title">{spec.title}</p>
    {spec.sub && <p className="agent-empty-sub">{spec.sub}</p>}
    {spec.kind === "unavailable" && onTerminal && <Button className="btn btn-small agent-open-terminal" onClick={onTerminal}>{t("chat.openTerminal")}</Button>}
    {spec.kind === "error" && onRetry && <Button className="btn btn-small" onClick={onRetry}>{t("retry")}</Button>}
  </div>;
}

function turnAnchor(turn: AgentTurn, index: number, turns: readonly AgentTurn[]): TraceAnchor {
  const key = turnKey(turn);
  let ordinal = 0;
  let ordinalFromEnd = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (turnKey(turns[cursor]) === key) ordinal += 1;
  }
  for (let cursor = index + 1; cursor < turns.length; cursor += 1) {
    if (turnKey(turns[cursor]) === key) ordinalFromEnd += 1;
  }
  return { key, ordinal, ordinalFromEnd };
}

export function AgentStream({ items, working, empty, busy, kept, onRetry, onTerminal, onNeedOlder, onFollow, onCopyReply,
  toolDetail, onNeedToolDetail, truncated, older, streamRef, signature }: {
  items: AgentTraceItem[]; working: boolean; empty: AgentEmptySpec; busy?: boolean; kept?: DetailsState;
  onRetry?: () => void; onTerminal?: () => void; onNeedOlder?: () => void; onFollow?: (follow: boolean, stream: HTMLElement) => void; onCopyReply?: CopyReply;
  toolDetail?: ToolDetailHooks["view"]; onNeedToolDetail?: ToolDetailHooks["need"]; truncated?: boolean;
  older?: ReactNode; streamRef?: Ref<HTMLDivElement>; signature?: string;
}) {
  const turns = groupAgentTurns(items);
  const hooks = { view: toolDetail, need: onNeedToolDetail };
  return <div ref={streamRef} className="agent-stream" role="log" aria-label={t("chat.streamAria")}
    aria-busy={busy === true} tabIndex={0} data-sig={signature} onScroll={event => {
      const stream = event.currentTarget;
      const follow = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 32;
      onFollow?.(follow, stream);
      if (stream.scrollTop < 32) onNeedOlder?.();
    }}>
    <div className="agent-stream-inner">
      {older}
      {(!items.length || empty.kind === "unavailable") && <EmptyPanel spec={empty} onRetry={onRetry} onTerminal={onTerminal} />}
      {truncated && items.length > 0 && <p className="agent-trace-limit">{t("chat.truncated")}</p>}
      {turns.map((turn, index) => {
        const anchor = turnAnchor(turn, index, turns);
        return <TraceTurn key={`${turnKey(turn)}:${index}`} turn={turn} anchor={anchor}
          live={working && empty.kind !== "unavailable" && index === turns.length - 1}
          kept={kept} hooks={hooks} onCopy={onCopyReply} />;
      })}
    </div>
  </div>;
}
