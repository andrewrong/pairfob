---
title: 安装
description: 校验并安装 Pairfob 二进制和 Tailscale 直连用户服务。
---

# 安装

Pairfob 在 macOS 或 Linux 上运行，需要 [Herdr](https://herdr.dev) 和 Tailscale。先让电脑加入 tailnet；手机也要加入同一个 tailnet，并获准访问电脑的 TCP 18474 端口。

```sh
curl -fsSL https://pairfob.com/install.sh | sh
pairfob doctor
```

安装脚本从 `https://pairfob.com/dl` 下载二进制、校验 SHA-256、检查 Herdr，并安装用户级服务。它**不会向中继登记**。官网提供安装脚本和二进制，不承担手机与电脑之间的会话传输。

## Herdr

脚本会复用已运行的 Herdr，或在允许时启动已安装的 Herdr。缺少 Herdr 时，可询问是否安装固定版本。无人值守安装：

```sh
curl -fsSL https://pairfob.com/install.sh | sh -s -- --install-herdr --non-interactive
```

若 Herdr 可执行文件不在服务的常规 PATH 里，安装服务前把 `HERDR_BIN` 设为其绝对路径。`pairfob setup` 检查 Herdr，也可配合 `--install-herdr` 安装；`pairfob doctor` 只诊断。

## 安装参数

| 参数 | 作用 |
| --- | --- |
| `--prefix DIR` | 指定二进制目录；默认优先可写的 `/usr/local/bin`，否则 `~/.local/bin` |
| `--no-service` | 只装二进制，不安装用户服务 |
| `--install-herdr` | 缺少时安装固定版本的 Herdr |
| `--non-interactive` | 不询问 |
| `--skip-herdr-check` | 先准备 Pairfob，不宣称 Herdr 已就绪 |

安装器还保留兼容命令 `pairfobd`。已配对设备的凭证保存在状态目录中，重新安装会保留它们。

## 服务和本机文件

macOS 使用 launchd 用户服务，Linux 使用 systemd 用户服务。用户登录且电脑保持唤醒时服务运行。默认状态、管理 socket 和日志位于 `~/.config/pairfob/`。服务只监听电脑的 Tailscale IPv4 地址和 18474 端口，不暴露 Herdr socket。

```sh
pairfob service status
pairfob service restart
pairfob doctor
```

服务配置和日志仅当前用户可读。状态文件、配对链接和本地部署 `.env` 不应提交到仓库。自建的 service 目录可放脚本和二进制；除非设置 `PAIRFOB_STATE_DIR`，那里不是实际状态目录。

## 更新或卸载

安装发行版后可用 `pairfob update`。源码构建的 `dev` 二进制应重新构建并重启用户服务。直连宿主机的手机端版本检查可能不可用。

```sh
pairfob service uninstall
```

卸载服务不会删除配对信息。只有确定要丢弃身份和所有配对凭证时才删除 `~/.config/pairfob/`。源码和构建说明见[仓库](https://github.com/arronKler/pairfob)。
