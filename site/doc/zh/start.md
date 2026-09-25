---
title: 开始使用
description: 装好 Herdr 和 Pairfob，让手机与电脑加入同一个 Tailscale 网络后配对。
---

# 开始使用

Pairfob 和 Herdr 一起运行在 macOS 或 Linux 电脑上。手机通过电脑的 Tailscale IPv4 地址和 18474 端口连接。两端都要安装 Tailscale，并允许手机访问这个端口。

## 1. 准备电脑

安装 [Herdr](https://herdr.dev) 0.7 或更新版本，让电脑加入 Tailscale。Pairfob 连接 Herdr 的本机 socket；Agent 和会话仍在电脑上运行。

## 2. 安装 Pairfob

```sh
curl -fsSL https://pairfob.com/install.sh | sh
pairfob doctor
```

安装脚本校验二进制并安装用户级登录服务，不向中继登记。`doctor` 应显示 **Running yes**、**Herdr ready** 和电脑的 Tailscale 地址。电脑需保持唤醒和登录，用户服务才能运行。安装路径和服务管理见 [安装](/zh/install)。

## 3. 手机配对

手机加入同一个 tailnet。在电脑执行：

```sh
pairfob pair
```

用手机的**系统相机**扫描二维码，或者把二维码下方的**完整配对链接**粘贴进 Pairfob 配对页面。仅有 8 位短码无法连接：完整链接含一次性邀请票据。电脑出现提示后，在电脑上确认。链接失效前请当作敏感信息保管。见 [配对](/zh/pair)。

## 4. 继续会话

在手机浏览器打开 `pairfob doctor` 显示的电脑 Tailscale 地址。已配对的浏览器会用保存的凭证重新连接，无需每次扫码。列表显示 Herdr 的实时会话。Pairfob 读取渲染好的终端画面，把按键送回电脑的 PTY。

Tailscale IP 页面使用 HTTP，浏览器可能显示**不安全**。Tailscale 加密两台设备间的传输，Pairfob 另行对已建立会话的内容做端到端加密。网页内扫码、推送和安装 PWA 等需要 HTTPS 的浏览器功能可能不可用；手机系统相机仍可打开二维码链接。见 [安全说明](/zh/security)。

## 检查和管理

```sh
pairfob list          # 已配对设备和最近成功使用时间
pairfob forget 1      # 按当前列表序号撤销一台设备
pairfob service status
```

`never seen` 表示已配对但从未建立会话。每次撤销后应重新查看列表，因为序号会变化。第二台电脑也要安装 Pairfob，再在手机上选择 **设置 → 添加另一台电脑**。见 [多台设备](/zh/devices)和[排查问题](/zh/troubleshoot)。
