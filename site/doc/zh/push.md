---
title: 通知
description: 当前 Tailscale HTTP 直连页面无法使用浏览器推送。
---

# 通知

当前直连部署通过电脑的 Tailscale IP 以 HTTP 提供 Pairfob 页面。浏览器推送需要安全上下文和 service worker，因此**这个页面无法使用推送通知**。在电脑设置 `PAIRFOB_PUSH` 也不能绕过浏览器要求。

打开 Pairfob 可以查看实时会话状态，列表会突出显示**需要你**的会话。网页内相机不可用时，手机系统相机仍能扫描新的配对二维码。

HTTP 浏览器限制见[安全说明](/zh/security)，直连步骤见[开始使用](/zh/start)。
