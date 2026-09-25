# Pairfob 代码地图

这份索引用于快速定位代码职责。协议的权威定义在 `proto/`；v1 加密和内部
RPC 字段保持冻结。

## 整体数据路径

```text
手机 PWA ── Tailscale HTTP/WS ──> 电脑的 Tailscale IPv4:18474
                                      │
                              internal/tailnet Gateway
                                      │ 不透明 FWD
                              internal/daemon Engine
                                      │ 本机 Unix socket
                              internal/runtime → Herdr
```

`pairfob.v1` 是端到端 envelope 与加密字节格式。`pairfob.v2` 仅承载本地
gateway 的控制帧。Tailscale 负责设备间的传输加密；浏览器访问的 HTTP 页面
本身仍会显示“不安全”。Pairfob 仍以 SPAKE2+、设备密钥
和 AEAD 认证端到端会话。

## 从哪里开始读

| 目标 | 首选文件 | 接下来阅读 |
| --- | --- | --- |
| 守护进程启动与 Tailscale 地址发现 | `cmd/pairfob/main.go` | `internal/tailnet/serve.go`、`service_*.go` |
| 直连 HTTP/WS gateway | `internal/tailnet/server.go` | `internal/daemon/pairing.go`、`session.go` |
| 配对与会话加密 | `internal/daemon/pairing.go`、`session.go` | `internal/envelope/`、`internal/crypto/` |
| 一条 phone RPC 的服务端处理 | `internal/daemon/rpc.go` | 对应的 `rpc_*.go` |
| Herdr 调用或能力问题 | `internal/runtime/types.go` | `herdr_*.go`、`fake.go`、`offline.go` |
| 浏览器配对与会话协议 | `pwa/src/lib/protocol/client.ts` | `pair-ws.ts`、`session-ws.ts`、`mux.ts` |

## Go

### `cmd/pairfob`

CLI 与常驻 daemon。`main.go` 打开状态和 Runtime，从 Tailscale 发现本机
IPv4 地址，并仅在该地址的 18474 端口启动 `internal/tailnet`。无需
`tailscale serve`。

| 文件群 | 职责 |
| --- | --- |
| `main.go` | 启动、旧 hosted 状态迁移、Tailnet gateway、管理 socket |
| `pair.go`、`phones.go`、`doctor.go` | 用户命令、配对和诊断 |
| `setup*.go`、`update_*.go` | Herdr 安装/检查和二进制更新 |
| `service_*.go` | macOS/Linux 用户级服务生命周期 |

### `internal/tailnet`

产品的本地传输边界。

| 文件 | 职责 |
| --- | --- |
| `server.go` | Tailscale IPv4 HTTP server、嵌入式 PWA、WS 握手、路由绑定与不透明 FWD 转发 |
| `serve.go` | Tailscale IPv4 地址发现和默认端口 |
| `ui/generated/` | 发布/验证时由 PWA 构建产生并嵌入二进制的资源（忽略提交） |

扫码 URL 在 fragment 中携带 `pair_ref` 和一次性 token。gateway 只消费一次
token，随后调用 daemon 既有的 PAKE 状态机；电脑仍须显式准入。

### `internal/daemon`

产品核心。`Engine` 持有设备、持久化、会话和 Runtime。`DirectMux` 表示由
Tailnet gateway 提供 v2 控制平面；不改变 v1 envelope、SPAKE、HKDF 或 RPC。

| 文件群 | 职责 |
| --- | --- |
| `engine.go`、`engine_runtime.go` | Engine、稳定 daemon ID、运行时配置 |
| `pairing.go` | SPAKE2+ 配对槽、一次性 ticket、SAS、设备准入 |
| `session*.go` | 已建立会话、DeviceHello、心跳、发送优先级 |
| `rpc*.go` | RPC 解密、校验、分派、读写、工作区和上传 |
| `operations.go` | 变更 `operation_id` 记录；未知结果只能刷新 |

### 其余 Go 包

| 包 | 职责 |
| --- | --- |
| `internal/envelope` | `pairfob.v1` 帧编码、解析与边界校验 |
| `internal/crypto/` | AEAD、canonical JSON、HKDF、DeviceHello、SPAKE2+ |
| `internal/runtime` | Herdr 的窄适配接口 |
| `internal/mux` | 仅用于测试的进程内 frame 路由器 |
| `internal/state` | 0600 原子 JSON：身份、设备、操作记录和遗留 relay 状态 |
| `internal/admin` | 本机 Unix socket 管理 API |
| `internal/workspace` | 文件边界、Git、媒体和附件 |
| `internal/pairingqr` | 配对 URL/二维码 payload |

## TypeScript：PWA

`pwa/src` 的 `app/bootstrap.ts` 装配应用；页面在 `pages/`，业务行为在
`features/`，协议与纯函数在 `lib/`。

| 路径 | 职责 |
| --- | --- |
| `lib/protocol/` | 配对、AEAD envelope、v2 控制帧、WSS 会话 |
| `lib/pairing-input.ts` | 解读扫码 fragment，包括一次性 ticket 与 tailnet endpoint |
| `lib/credentials.ts` | 电脑目录凭证；使用 `endpoint_origin`，旧 hosted 凭证会失效 |
| `features/pairing`、`connection` | 扫码配对、连接和电脑切换 |
| `pages/`、`features/session` | 页面、实时会话、工作区、附件和布局 |

## 构建、测试和检索

| 内容 | 位置 |
| --- | --- |
| 冻结 envelope、RPC schema、向量 | `proto/envelope.md`、`proto/rpc.schema.json`、`proto/pairfob-vectors.json` |
| v2 控制层 | `proto/envelope-v2.md` |
| 嵌入 PWA | `scripts/embed-pwa.sh` |
| 全量验证 | `scripts/verify.sh` |

```sh
rg -n 'GetConfig|你的 RPC 名称' pwa/src internal/daemon proto
rg -n 'PAIR_ATTACH|SESSION_ATTACH|FWD|PAIRFOB_LISTEN_ADDR' cmd internal pwa/src proto
rg -n 'rename_file|worktree_create|capabilities' internal pwa/src proto
```

## 修改前的快速规则

- 先读 `proto/`；不要更改 v1 加密、HKDF info、AAD、Argon2id、SPAKE2+、
  DeviceHello transcript 或内部 RPC 字段。
- 所有读写必须在 `Established` 会话中；变更带新的 `operation_id`。
- 路径和 cwd 必须落在 live snapshot root 或 `PAIRFOB_ALLOWED_ROOTS`。
- 手写源码每个文件不超过 800 行；按职责拆分后再继续修改。
