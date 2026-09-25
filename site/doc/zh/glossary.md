---
title: 术语
description: Pairfob Tailscale 直连部署里的常用词。
---

# 术语

| 词 | 意思 |
| --- | --- |
| Herdr | 电脑上运行编码 Agent 的本机程序；Pairfob 连接它的本机 socket |
| pane | Herdr 会话中一块实时终端画面 |
| 控制 | 手机上的渲染画面、按键垫和系统键盘 |
| 终端 | 支持时显示完整终端，适合 vim 等 TUI |
| 对话 | Agent 消息和易读的会话记录 |
| 自动 | 根据当前能力选择合适的画面模式 |
| tailnet | 手机和电脑共同加入的 Tailscale 私有网络 |
| Pairfob 网关 | 电脑 Tailscale IPv4 地址的网页和 WebSocket 监听，端口 18474 |
| 配对链接 | 一次性 URL；链接指向电脑地址，fragment 含配对码和邀请票据 |
| 电脑确认 | 手机证明配对码后，在电脑按 Enter 才放行 |
| 设备凭证 | 配对后保存，让这个浏览器下次无需扫码即可连接 |
| PWA | 由电脑提供的浏览器页面；HTTP 可能限制安装和安全上下文功能 |
| `PAIRFOB_STATE_DIR` | 本机状态和已配对设备；默认 `~/.config/pairfob` |
| worktree | 由电脑上的 Herdr 管理的 Git worktree |
| 订阅余量 | 电脑上已登录账号的额度，显示在设置中 |
