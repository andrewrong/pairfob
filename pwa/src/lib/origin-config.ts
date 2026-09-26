import { t } from "./i18n.ts";
import { ProtocolError } from "./protocol/errors.ts";
import type { MuxProtocol } from "./protocol/mux.ts";
import { fetchWithTimeout, type FetchLike } from "./request-timeout.ts";
import { isTailnetIPv4 } from "./tailnet-ip.ts";

export type { MuxProtocol };
export type OriginConfig = { protocol: MuxProtocol; build: string; p2p: boolean; releaseCheck: boolean; telemetry: boolean };

export function parseOriginConfig(value: unknown): OriginConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("bad_message", t("err.originShape"));
  }
  const record = value as Record<string, unknown>;
  if (record.protocol !== 2) {
    throw new ProtocolError("bad_message", t("err.originVersion"));
  }
  if (typeof record.build !== "string") {
    throw new ProtocolError("bad_message", t("err.originBuild"));
  }
  if (record.p2p !== undefined && typeof record.p2p !== "boolean") {
    throw new ProtocolError("bad_message", t("err.originShape"));
  }
  if (record.release_check !== undefined && typeof record.release_check !== "boolean") {
    throw new ProtocolError("bad_message", t("err.originShape"));
  }
  if (record.telemetry !== undefined && typeof record.telemetry !== "boolean") {
    throw new ProtocolError("bad_message", t("err.originShape"));
  }
  return {
    protocol: record.protocol,
    build: record.build,
    p2p: record.p2p === true,
    // Older hosted origins retain their prior behavior. Direct origins must
    // explicitly opt in, so a missing capability never sends phone metadata.
    releaseCheck: record.release_check !== false,
    telemetry: record.telemetry === true,
  };
}

/** Network failures may recover; invalid origin configuration must remain rejected. */
export function originConfigErrorIsRecoverable(error: unknown): boolean {
  if (!(error instanceof ProtocolError)) return false;
  return error.code === "bad_relay" || error.code === "timeout";
}

export async function loadOriginConfig(fetchImpl: FetchLike = fetch): Promise<OriginConfig> {
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, "/api/config", { cache: "no-store" });
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("bad_relay", t("err.originRead"));
  }
  if (!response.ok) throw new ProtocolError("bad_relay", t("err.originRead"));
  try {
    return parseOriginConfig(await response.json());
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("bad_message", t("err.originShape"));
  }
}

/** Same-origin PWA WS. Origin config is pairfob.v2 only; never `/v1/ws`. */
export function clientWsURL(
  protocol: MuxProtocol,
  site: { protocol: string; host: string },
  query?: { daemonId?: string; pairTicket?: string },
): string {
  if (protocol !== 2) {
    throw new ProtocolError("bad_message", t("err.originVersion"));
  }
  const scheme = site.protocol === "https:" ? "wss" : "ws";
  const url = new URL(`${scheme}://${site.host}/v2/ws`);
  url.searchParams.set("role", "client");
  if (query?.daemonId) url.searchParams.set("daemon_id", query.daemonId);
  if (query?.pairTicket) url.searchParams.set("pair_ticket", query.pairTicket);
  return url.toString();
}

export function clientWsURLForOrigin(origin: string, daemonId: string): string {
	let site: URL;
	try {
		site = new URL(origin);
	} catch {
		throw new ProtocolError("bad_relay", "电脑地址无效");
	}
	const directIP = isTailnetIPv4(site.hostname);
	if (site.origin !== origin || site.protocol !== "http:" || !directIP || site.port !== "18474") {
		throw new ProtocolError("bad_relay", "电脑不是 Tailscale 直连地址");
	}
	return clientWsURL(2, site, { daemonId });
}
