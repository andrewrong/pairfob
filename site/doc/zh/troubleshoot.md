---
title: 排查
description: 检查 Tailscale 直连监听、Herdr、配对和浏览器连接。
---

# 排查

先在电脑执行：

```sh
pairfob doctor
pairfob service status
pairfob list
```

`doctor` 应显示 **Running yes**、**Herdr ready**，以及电脑的 Tailscale IPv4 地址和 18474 端口。

## 手机打不开页面

检查两端 Tailscale、tailnet ACL，以及电脑是否保持唤醒。在手机打开 `http://<电脑的 Tailscale IP>:18474`。电脑上运行 `curl http://<电脑的 Tailscale IP>:18474/v2/health` 应返回 `{"ok":true,"protocol":2}`。Pairfob 监听 Tailscale IP，不监听 `127.0.0.1` 或 `0.0.0.0`。

电脑锁屏但保持唤醒时可继续运行。睡眠或注销会停止用户服务，Pairfob 无法唤醒电脑。

## 页面能打开但不能配对

用手机系统相机扫描当前二维码，或粘贴 `pairfob pair` 打印的**完整链接**。HTTP 页面内的相机可能不可用。仅有 8 位短码，缺少一次性票据。让电脑的配对命令保持运行；手机验证后在电脑确认。过期或失败后创建新邀请。

## 配对了但连接不上

查看 `pairfob list`。`never seen` 表示已配对但从未完成会话握手。在同一个浏览器配置里重新打开**这台电脑自己的** Tailscale 地址；新浏览器配置没有保存的凭证。再看 `pairfob doctor`，并在本机检查 `~/.config/pairfob/pairfob.log`。直连部署没有托管中继作为回退。

Herdr 不可用时在电脑启动它。CLI 不在服务 PATH 中时，在重新安装服务以及运行 `doctor` 前设置 `HERDR_BIN`。具体操作能否使用还取决于运行中的 Herdr 版本。

## 操作结果不确定

超时后不要立即重做变更。先刷新页面，并在电脑上确认结果，再决定下一步。Pairfob 不会自动重放结果未知的变更。

## 浏览器功能不可用

Tailscale IP 上的 HTTP 不属于 HTTPS 安全上下文。网页相机、推送、service worker 和 PWA 安装可能不可用。配对二维码用手机系统相机扫描。附件上传目前依赖旧 P2P 传输，在这台直连宿主机上不可用。

求助时保留 `doctor` 输出和本机日志的相关时间；分享前删掉个人路径、地址和配对链接。
