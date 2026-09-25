---
title: 电脑上的命令
description: 在 Tailscale 直连部署中配对、查看、撤销设备和管理服务。
---

# 电脑上的命令

Pairfob 在登录后作为用户服务运行。终端直接执行 `pairfob` 会显示本机状态；服务未运行时可在当前终端启动。

| 命令 | 作用 |
| --- | --- |
| `pairfob pair` | 打印一次性二维码和完整链接，等待电脑端确认 |
| `pairfob list` | 显示已配对设备与最近成功使用时间 |
| `pairfob forget N` | 撤销当前列表中第 N 台设备 |
| `pairfob doctor` | 只读的本机健康检查 |
| `pairfob setup` | 检查或启动 Herdr；可选择安装 |
| `pairfob service status` | 查看用户服务 |
| `pairfob service restart` | 修改配置后重启 |
| `pairfob update` | 更新已安装的发行版二进制 |

`forget` 也接受不重名的设备名。撤销后列表序号会变化。`never seen` 表示设备已配对，但从未成功建立会话。

## doctor

健康的直连安装应显示 `Running yes`、`Herdr ready` 和电脑的 Tailscale IPv4 地址及 18474 端口。命令还显示 Pairfob 的安装版本、运行版本和已配对数量。服务、Herdr 或 Tailscale 监听不可用时会以非零状态退出。

如果 Herdr 不在服务的 PATH 中，在执行 `pairfob service install` 前设置绝对路径 `HERDR_BIN`。交互式 `doctor` 也需要同样设置才能找到该可执行文件；它不会更改服务。

## 服务和更新

```sh
pairfob service install
pairfob service status
pairfob service restart
pairfob service stop
pairfob service start
pairfob service uninstall
```

用户服务指向安装时使用的二进制。状态和日志默认位于 `~/.config/pairfob/`。源码构建的 `dev` 版本要重新构建并重启服务；发行版可用 `pairfob update`。配对关系会保留。直连 HTTP 页面可能无法查询 `/dl/VERSION`，也可能不提供手机端发起更新。

供本机自动化使用的 `pairfob pair new`、`pairfob pair accept` / `deny`、`pairfob device revoke <id>` 仍然可用。见[环境变量](/zh/env)和[排查问题](/zh/troubleshoot)。
