---
title: 安全与隐私
description: 了解 Tailscale 传输、Pairfob 会话加密、本机凭证和 HTTP 浏览器限制。
---

# 安全与隐私

Pairfob 在电脑的 Tailscale IPv4 地址和 18474 端口提供手机页面。当前连接不经过 Pairfob 中继；Herdr 仍只连接电脑本机的 socket。

## 两层保护

Tailscale 认证 tailnet 设备并加密设备间传输。Pairfob 使用一次性邀请、配对码和电脑端确认，之后才保存设备凭证。已建立会话的内容另行在已配对设备与电脑之间端到端加密。网关只转发不透明帧，不检查会话内容。

获得 tailnet ACL 允许的设备可以加载 Pairfob 页面并连接 WebSocket，但仅凭这一点无法进入会话。请把 tailnet 访问权限限制给可信设备；丢失手机后在电脑执行 `pairfob forget N` 撤销。

## 浏览器和客户端信任

Tailscale IP 页面使用 **HTTP**。浏览器可能显示**不安全**，网页内相机、service worker、安装 PWA 和推送通知等需要 HTTPS 安全上下文的功能可能不可用。Tailscale 的传输加密不会改变浏览器的安全上下文规则。用手机系统相机扫码，或粘贴完整配对链接。

浏览器执行电脑提供的页面代码。如果电脑、Pairfob 二进制或浏览器被入侵，攻击者可能在端点读取密钥或明文；端到端加密无法保护已被控制的端点。即使能加到主屏幕，也不代表页面代码版本被固定。

## 私有数据的位置

电脑身份和已配对设备凭证默认保存在 `~/.config/pairfob/`；浏览器凭证保存在该设备的浏览器配置中。完整配对链接的 URL fragment 含一次性票据，不会随 HTTP 请求发送，但失效前仍应视作敏感信息。Pairfob 在本机日志记录对端地址和请求路径，不记录 fragment。请保护状态目录、服务配置和日志。

设备丢失时，在电脑运行 `pairfob list`、`pairfob forget N`。若怀疑电脑被入侵，先停止服务、清理电脑，再与可信设备重新配对。安全问题请按仓库的[安全政策](https://github.com/arronKler/pairfob/blob/main/SECURITY.md)私下报告。
