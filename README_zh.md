# Pairfob

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![pairfob.com](https://img.shields.io/badge/site-pairfob.com-111111)](https://pairfob.com)
[![Docs](https://img.shields.io/badge/docs-pairfob.com%2Fdoc-111111)](https://pairfob.com/doc/zh/)

[English](README.md) | **简体中文**

**在手机上接着操作 [Herdr](https://herdr.dev) 会话。** Agent 继续在电脑上运行。
配对后的手机通过 Tailscale 读取实时终端画面，并把按键发回电脑。

![手机上的 Pairfob：会话列表、实时会话和 diff 审查](site/img/readme/zh.webp)

## 从当前源码开始

官网安装脚本目前仍提供旧中继版本。要使用 `main` 分支的 Tailscale 直连版，
现在请从源码构建。需要 macOS 或 Linux、Go 1.26、bun、Herdr 0.7+，
电脑和手机都已连接 Tailscale；手机还需获准访问电脑 Tailscale IP 的 TCP 18474 端口。

```sh
(cd pwa && bun install --frozen-lockfile)
bash ./scripts/embed-pwa.sh
mkdir -p "$HOME/.local/bin"
go build -o "$HOME/.local/bin/pairfob" ./cmd/pairfob
"$HOME/.local/bin/pairfob" service install
"$HOME/.local/bin/pairfob" doctor
"$HOME/.local/bin/pairfob" pair
```

用手机系统相机扫描二维码，或打开终端打印的完整配对链接；只有短码无法连接。
接着在电脑按 Enter 确认。以后在同一手机浏览器中打开这台电脑的 Tailscale
地址即可。用户服务在登录后运行上面构建的二进制，请勿移动该文件。服务管理、
清理设备和浏览器限制见 [Tailscale 直连部署说明](docs/tailscale-direct.md)。

[Herdr 插件](plugin/herdr/README.md)和官网安装脚本目前安装的仍是旧发行版；
发布新的直连二进制后才能通过它们安装直连版。

## 在手机上能做什么

- **Agent 等你时及时处理。** 打开 Pairfob 后，列表顶部的 **需要你** 会把
  等待中的 Agent 提出来，点一下直接进到那个提示。
- **操作实时会话。** 看渲染好的终端画面，用系统键盘和按键垫输入；
  全屏 TUI 可切到**终端**模式，阅读 Agent 消息可切到**对话**模式。
- **审查改动。** 浏览文件，查看 git 状态和 diff，在 diff 行上写评论并发给
  Agent。
- **管理工作区。** 新建对话、标签页、分屏和 worktree，在 **画板** 上看标签页
  的真实分栏。电脑不支持的操作不会出现。
- **多台电脑、多台设备。** 一台手机可以在几台电脑之间切换，一台电脑也可以
  配对多台设备。
- **看订阅余量。** 由电脑收集 Codex、Claude Code、Copilot、Cursor、Grok 等账号的
  额度。

手机端支持中文和 English。当前 HTTP 直连地址不支持浏览器推送和附件上传；
网页内扫码与安装 PWA 也可能受浏览器限制。扫描配对二维码请用手机系统相机。

## 安全

- **配对** 用 SPAKE2+，配对码由双方确认；会话密钥用 Argon2id 加固。
- **密钥** 只在电脑和已配对设备上。
- **私有网络。** 手机通过 Tailscale IP 直接连接电脑，不经过 Pairfob 中继。
- **Herdr 不对外开放。** Pairfob 只在电脑的 Tailscale IP 上监听，Herdr 仍在本机。

直连的隐私与浏览器限制见 [部署说明](docs/tailscale-direct.md#privacy-and-browser-limits)。安全漏洞请按
[SECURITY.md](SECURITY.md) 私下报告。

## 环境要求

| | |
| --- | --- |
| 电脑 | macOS 或 Linux（不支持 Windows） |
| Herdr | 0.7 及以上；安装脚本可以装固定版本 0.8.2 |
| Herdr 插件 | Herdr 0.8.2 及以上 |
| 在手机上关闭工作区 | Herdr 0.9.0 及以上 |
| 手机 / 平板 | 较新的移动浏览器，并与电脑加入同一个 tailnet |
| 当前源码构建工具 | Go 1.26 和 bun |

## 电脑上的命令

下列示例假定 `~/.local/bin` 已加入 `PATH`；否则请使用
`"$HOME/.local/bin/pairfob"`。

```sh
pairfob                     # 查看状态；没在运行时启动它
pairfob pair                # 配对手机、平板或另一台电脑
pairfob list                # 已配对设备
pairfob forget 1            # 按序号或名字解除配对
pairfob doctor              # 检查这台电脑（只诊断，不改任何东西）
pairfob setup               # 检查 Herdr，按需安装并启动
pairfob update              # 仅适用于发行版；当前源码版要重新构建
pairfob quota-setup-claude  # 开启 Claude 订阅余量采集
pairfob service status      # 登录服务：start / stop / restart / install / uninstall
```

第二台电脑也要构建并运行自己的用户服务，然后在手机上用 **设置 → 添加另一台电脑**
配对。服务和设备管理见 [部署说明](docs/tailscale-direct.md)。

## 工作原理

```
手机 --Tailscale HTTP/WS--> Pairfob daemon --本机连接--> Herdr
```

手机读取渲染好的终端画面，把按键发回 PTY；它本身不是终端模拟器。
协议规格在 [`proto/`](proto/)，包括 [mux 控制层](proto/envelope-v2.md)。

| 目录 | 内容 |
| --- | --- |
| `cmd/pairfob` | 电脑端 daemon 和命令行 |
| `internal/` | 配对、会话、RPC、Herdr 适配、协议原语 |
| `pwa/` | 手机端应用（React + TypeScript，用 bun 构建） |
| `internal/tailnet` | Tailscale IP 上的网页和 WebSocket 网关 |
| `site/` | 主页和[文档](https://pairfob.com/doc/zh/)源码 |
| `proto/` | 冻结的信封格式、RPC schema 和测试向量 |
| `plugin/herdr` | Herdr 插件入口 |

## 开发

```sh
(cd pwa && bun install --frozen-lockfile)
./scripts/verify.sh     # 完整检查：Go、PWA、Worker、站点测试和构建
```

`scripts/dev-up.sh` 是用于协议开发的本地 Worker 测试环境；直连宿主机构建
见上面的步骤。真机调试、验证范围、协议约束和发布流程见
[`docs/develop.md`](docs/develop.md)（英文）。

## 参与贡献

欢迎在 [github.com/arronKler/pairfob](https://github.com/arronKler/pairfob)
提 issue 和 PR。按改动范围运行对应检查（见
[`docs/develop.md`](docs/develop.md#verification)），并在 PR 里写明跑了哪些。
`proto/` 下的信封格式、测试向量和 RPC 字段是有意冻结的，想改动请先开 issue 讨论。

## 许可证

[Apache License 2.0](LICENSE)。见 [NOTICE](NOTICE)。
