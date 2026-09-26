# 手机交互与耗电检查

日期：2026-09-26。范围：当前源码及未提交的日志改动。本次检查后修复了可在源码层安全完成的问题；没有修改部署或配对设备。

## 结论与验证边界

已有后台暂停、重连退避、重复内容复用和手机交互基础。优先工作是让界面准确反映 Tailscale 直连能力，并减少前台空闲请求。

本次进行了源码检查、构建产物测量和定向测试。本地预览服务器被沙箱拒绝，部署页面访问被浏览器权限策略拒绝；没有进行新的浏览器视觉验收、Safari 性能录制或 iPhone 电池实测。因此不能给出每小时掉电百分比。

| 审查维度 | 代码证据 | 验证缺口 |
| --- | --- | --- |
| 无障碍 | label、原生 dialog、焦点提示、错误关联、减少动画偏好 | VoiceOver、实际对比度、完整键盘路径，暂不评分 |
| 性能 | 固定轮询、资源不缓存和无效请求已确认 | 未测手机 CPU；源码暂评 2/4 |
| 响应式 | 手机样式、16px 输入框、44/52px 主按钮、桌面分界 | 真机键盘、文字放大和横屏，暂不评分 |
| 主题 | 共用颜色和间距变量，部分局部颜色常量 | 未做现场视觉确认；源码暂评 3/4 |
| 实现一致性 | 职责清晰，但部分入口与实际能力不一致 | 源码暂评 2/4 |

实现一致性部分通过。由于视觉验证不完整，不计算总分，也不声称 WCAG 合规。

## 优先发现

### 1. [P1] 上传入口与传输能力不一致

`internal/daemon/rpc_read.go:52` 在 Herdr 支持 Snapshot 时宣告 upload_file/upload_file_v2；`pwa/src/features/session/attachments/attachments-context.ts:41` 据此开放附件入口。但 `pwa/src/lib/protocol/session-ws.ts:542` 要求上传使用 p2p，当前网关和连接器却禁用了 P2P。`attachment-tray.tsx:338` 中等待附件的连接按钮也会被禁用。

影响：用户进入不能完成的上传流程，选图、预处理可能成为无用工作。应先让服务端 capability 准确反映当前部署，在选文件前说明不可用。要支持 Tailnet WebSocket 上传，需要完整验证分块、限流、取消和断线结果，不能只删除传输检查。对应交互工作：`$impeccable harden`、`$impeccable clarify`。

### 2. [已修复] 配对主操作不适配 HTTP 页面

`pwa/src/features/pairing/connect-view.tsx:49` 始终把站内扫码作为主操作。当前 HTTP Tailnet IP 页面无法使用要求安全上下文的摄像头和异步剪贴板 API；点击后才解释不可用。`code-sheet.tsx:53` 仍在空输入或非 http 开头时显示旧的 14 位计数，model 也保留短码格式化。

已改为：不具备安全上下文或摄像头接口时，主按钮直接打开“粘贴配对链接”；输入保持完整链接原样，不再显示或格式化旧的 14 位短码。系统相机扫描电脑二维码仍会直接打开完整链接。

依据：[摄像头安全上下文要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)、[剪贴板要求](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/readText)。对应工作：`$impeccable clarify`、`$impeccable harden`。

### 3. [部分修复] 前台空闲控制页与看板缺少降频

`pwa/src/features/connection/poll-schedule.ts:1`：控制视图和工作中的聊天每 1.5 秒补读，只有空闲聊天退到 10 秒。`features/board/preview/model.ts:11` 将看板每轮读取上限设为 8 个窗格。重复文本会跳过主要重绘，但网络请求和响应已经发生。

已将看板预览降到 15 秒；Poke 仍立即刷新。活跃窗格保持 1.5 秒，以免牺牲交互响应；无变化后的分级退避需要真机数据确认后再调整。

### 4. [部分修复] 静态资源统一禁止缓存且未压缩

`internal/tailnet/server.go:112` 直接使用 http.FileServer，`:145` 为所有响应设置 no-store，没有 gzip/Brotli 层。当前构建主 JS 为 1,428,313 字节、CSS 为 185,853 字节；离线 gzip 分别约 470KB、34KB。这是产物测量，不是线上抓包。

已为 `/assets/` 下带构建哈希的资源设置一年 immutable 缓存；HTML、配置、健康检查和 WebSocket 握手仍为 no-store。尚未加入预压缩产物。

### 5. [已修复] 保留了当前部署无法处理的后台请求

`pwa/src/features/settings/daemon-update.ts:101` 查询同源 /dl/VERSION，但当前嵌入产物没有这个文件，网关没有发布处理器；失败后前台约每 60 秒重试（`:111`）。`pwa/src/lib/telemetry.ts:65` 还发送同源 /v2/events，网关对此 POST 返回 405。

直连网关现在在配置中明确关闭 release check 与 telemetry；PWA 收到该能力后不再请求 `/dl/VERSION` 或发送 `/v2/events`。

### 6. [已修复] 自定义日志初始化失败可能没有诊断记录

`cmd/pairfob/service.go:315` 在自定义日志目录时把管理器 stdout/stderr 设为 /dev/null；`main.go:46` 先打开状态，之后才调用 redirectDaemonLog。状态或日志文件打开失败时，错误会落到 /dev/null。

服务管理器现在始终先写 state 目录的 `pairfob-startup.log`，守护进程启动后再转入配置的运行日志。外置卷不可用或配置错误仍有本机启动诊断。

### 7. [P2] 日志没有轮转与保留上限

`internal/audit/log.go:26`、`cmd/pairfob/log_paths.go:68` 持续追加，未发现项目级轮转配置。长期运行会不断占用存储，也延长本机网络地址和审计记录保留时间。建议分别为运行日志和审计日志设定大小/时间策略，保持目录 0700、文件 0600，验证重开文件后日志连续性。这主要影响电脑，不是手机耗电源。

### 8. [P2] 前台恢复测试未完整隔离网络

`pwa/src/features/connection/controller.agent-status.test.ts:155` 的 slow foreground recovery 测试因 Happy DOM 遥测 fetch 的 ECONNREFUSED 失败。应安装显式 telemetry sender/fetch stub，并清理计时器。这个失败不能证明生产恢复逻辑已坏，也不能算作通过。

### 9. [已修复] 后台还可减少残留计时器与空闲连接

`pwa/src/lib/protocol/session-transport.ts:106` 隐藏时跳过心跳发送，但 interval 继续存在；隐藏时 WS 未自动关闭，服务器仍可能对已建立会话发送 Poke（`internal/daemon/push.go:454`），上层会阻止其触发读取。

隐藏时现在清除心跳 interval，回到前台后重建。没有自动关闭 WS，以保持待定变更结果与会话语义。

## 已有的保护

- `app/bootstrap.ts:212` 隐藏时停止主要轮询，回前台先恢复连接和可信快照。
- 心跳 25 秒一次，隐藏时不主动发送；后台取消重连计时器，重连有抖动和指数退避，上限 15 秒。
- 空闲聊天降至 10 秒；相同 pane 文本复用解析结果，减少重绘并保留文本选择。
- 轮询只有一轮在途读取，stop/start 不叠加请求；未知结果的变更不会自动重放。
- 已有手机大按钮、焦点提示、表单错误关联与减少动画偏好；未发现持续点亮屏幕的 Wake Lock 请求。

## 手机耗电判断

Agent/Herdr 在电脑执行。手机增加的是网页渲染、加解密和网络活动；用户原本就在使用 Tailscale，应区分 VPN 原有耗电和 Pairfob 网页新增耗电。

| 场景 | 代码层预期 |
| --- | --- |
| 偶尔查看结果、发指令 | 工作集中在短时间，没有依据断言必然严重掉电 |
| 长时间亮屏停在控制页、繁忙聊天或看板 | 持续补读与更新，风险较高，应优先做空闲降频 |
| 切后台或锁屏 | 主要主动读取和主动心跳已暂停，预期远低于前台，但不是保证零耗电 |
| 关闭网页 | 网页工作结束；Tailscale 的 VPN 开销可能仍存在 |

[WebKit 官方说明](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)将屏幕、CPU/GPU 和网络列为主要耗电来源；iOS 会尽可能挂起后台标签，但网络事件和定时器仍应主动削减。上述 Pairfob 判断是源码推断，未测出实际电量变化。

真机核对应保持相同亮度、网络和时长，对比“Tailscale 开启但不使用 Pairfob”与“使用 Pairfob”。在「设置 → 电池」分别查看 Safari、Tailscale 的前台/后台活动，避免用一次短时百分比跳动下结论。[Apple 电池使用说明](https://support.apple.com/en-us/102432)。Tailscale 更新记录包含 iOS/DNS 耗电修复，保持较新版本有意义，但不能代替实测。[Tailscale 更新记录](https://tailscale.com/changelog)。

## 验证与后续顺序

- 本次已通过 TypeScript 类型检查、PWA production build、diff 格式检查和静态 UI 检测（0 项）。
- 完整 `./scripts/verify.sh` 已启动，但当前执行环境缺少 `bun`，在嵌入 PWA 的第一步停止；Go 工具链同样不在 PATH。因此本报告不把 Go 测试或 Bun 测试标成通过。
- 仍需要在部署机完成完整验证和真机检查：系统相机扫码、完整链接粘贴、前后台切换、空闲看板，以及上传入口确实隐藏。
