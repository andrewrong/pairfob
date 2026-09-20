/**
 * One-shot attachment codec worker. Each API invocation spawns its own
 * instance; the main thread terminates it on settle/abort/failure, so there is
 * no queue, cache or shared state here.
 *
 * Type note: the project compiles with the DOM lib only (no global WebWorker
 * lib, which would conflict with DOM). The worker global is therefore declared
 * locally as the tiny surface this entry touches instead of via lib refs.
 */
import {
  codecErrorReply,
  codecUnreadableReply,
  isCodecRequest,
  type CodecReply,
  type CodecRequest,
} from "./attachment-codec-protocol.ts";
import { encodeChunkCore, hashFileCore } from "./attachment-codec-core.ts";

type CodecWorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<CodecRequest>) => void): void;
  postMessage(message: CodecReply): void;
};

const workerScope = globalThis as unknown as CodecWorkerScope;

async function handle(request: CodecRequest): Promise<string> {
  if (request.op === "sha256") {
    return hashFileCore(request.file);
  }
  return encodeChunkCore(request.file, request.offset, request.end);
}

workerScope.addEventListener("message", (event: MessageEvent) => {
  const data: unknown = event.data;
  if (!isCodecRequest(data)) {
    workerScope.postMessage(codecUnreadableReply(data));
    return;
  }
  void handle(data)
    .then((result) => {
      workerScope.postMessage({ jobId: data.jobId, op: data.op, ok: true, result });
    })
    .catch((error: unknown) => {
      workerScope.postMessage(codecErrorReply(data, error));
    });
});
