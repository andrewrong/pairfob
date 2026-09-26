---
title: 环境变量
description: Tailscale 直连监听、本机状态与 Herdr 配置。
---

# 环境变量

Pairfob 自动发现电脑的 Tailscale IPv4 地址，并监听 18474 端口。用户服务只保存需要的运行环境，不会继承交互式终端的全部变量。

| 变量 | 作用 |
| --- | --- |
| `PAIRFOB_ORIGIN` | 可选，对外显示的 `http://<tailscale-ip>:18474`；必须与监听地址一致 |
| `PAIRFOB_LISTEN_ADDR` | 可选，`<tailscale-ip>:18474`；不能使用通配地址或普通 LAN 地址 |
| `PAIRFOB_STATE_DIR` | 状态、设备凭证和管理 socket；未设置 `PAIRFOB_LOG_DIR` 时也存日志；默认 `~/.config/pairfob` |
| `PAIRFOB_LOG_DIR` | 可选的绝对日志目录，存放 `pairfob.log` 和 `audit.log`；默认使用状态目录 |
| `PAIRFOB_ALLOWED_ROOTS` | 其他允许的工作区根目录；越界路径拒绝 |
| `HERDR_BIN` | Herdr 不在服务 PATH 中时，填写可执行文件的绝对路径 |
| `HERDR_SOCKET_PATH` | Herdr 使用非默认本机 socket 时的路径 |
| `PAIRFOB_DOWNLOAD_BASE` | 可选的发行版下载根地址 |
| `PAIRFOB_INSTALL_PREFIX` | `install.sh` 的二进制目录 |

安装服务前设置必要的变量，再重启服务。状态和服务配置应保持私有。`PAIRFOB_JOIN_TOKEN` 不使用，也不应设置。

直连 HTTP 地址不属于浏览器安全上下文。设置推送环境变量无法在这套部署中启用推送。见[安全说明](/zh/security)和[通知](/zh/push)。
