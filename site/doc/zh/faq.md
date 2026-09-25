---
title: 常见问题
description: Pairfob Tailscale 直连部署的常见问题。
---

# 常见问题

## 需要 Pairfob 账号吗？

不需要。电脑提供 Pairfob 页面，手机经电脑确认配对后得到设备凭证。电脑不向托管中继登记。

## 需要 Tailscale 吗？

需要。电脑和手机加入同一个 tailnet，ACL 要允许手机访问电脑的 Tailscale IPv4 地址和 TCP 18474 端口。Pairfob 不在路由器上开放公网端口。

## Pairfob 能自己运行 Agent 吗？

不能。Agent 由电脑上的 [Herdr](https://herdr.dev) 运行，Pairfob 把实时会话呈现在另一台设备上。

## 这是远程桌面吗？

不是。Pairfob 读取 Herdr 渲染的 pane，把按键送回 PTY，不镜像整个桌面。

## 手机上的是会话副本吗？

不是。手机打开的是电脑上的实时会话，坐回电脑前无需同步。

## 电脑睡眠或网络断了怎么办？

唤醒电脑或恢复 Tailscale，再打开电脑的 Tailscale 地址。已配对浏览器会用保存的凭证重连。Pairfob 无法唤醒睡眠中的电脑。

## 为什么手机浏览器提示“不安全”？

页面使用 Tailscale IP 上的 HTTP。Tailscale 加密设备间传输，Pairfob 另行对已建立会话内容做端到端加密；但 HTTP 仍不是浏览器安全上下文，网页相机、推送、service worker 和 PWA 安装可能不可用。配对请用手机系统相机。见[安全说明](/zh/security)。

## 其他 tailnet 成员能读取我的会话吗？

ACL 允许的成员可以加载 Pairfob 页面，但进入会话还需要已配对的设备凭证。请限制 tailnet 访问，丢失设备后执行 `pairfob forget N`。

## 为什么只输短配对码不行？

完整二维码或链接还包含电脑地址和一次性票据。不能扫码时粘贴整个链接；仅有 8 位短码无法连接直连网关。

## 手机丢了，或清除了浏览器数据？

在电脑用 `pairfob list`、`pairfob forget N` 撤销丢失的设备。浏览器数据清除后要重新 `pairfob pair`。显示 `never seen` 的设备已配对，但从未成功建立会话。

## 一部手机能管理多台电脑吗？

可以。每台电脑分别安装 Pairfob，在手机上选择 **设置 → 添加另一台电脑**。每台电脑各有配对关系和 Tailscale 地址。

## 推送和文件上传在哪里？

当前直连 HTTP 页面不提供浏览器推送。现有附件上传流程依赖旧 P2P 传输，在这套直连部署中不可用。读取会话、发送按键和查看工作区改动仍可使用。见[手机上怎么用](/zh/app)。

## 收费吗？

Pairfob 免费，源码以 Apache-2.0 发布在 <https://github.com/arronKler/pairfob>。Tailscale 和所用 Agent 各有自己的条款。

## 如何反馈？

普通问题请到 [GitHub Issues](https://github.com/arronKler/pairfob/issues/new)；安全漏洞请走 [GitHub Security Advisories](https://github.com/arronKler/pairfob/security/advisories/new)。不要公开配对链接、设备凭证或私有终端内容。可以附上去掉个人路径与地址后的 `pairfob doctor` 输出。
