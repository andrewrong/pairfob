(function () {
  const ORIGIN = "https://pairfob.com";

  const zh = {
    title: "Pairfob — 手机接着操作电脑上的 AI Agent 会话",
    description:
      "在手机上接着操作电脑里正在跑的 AI 编码 Agent。Pairfob 通过你的 Tailscale 网络直连电脑，会话内容端到端加密。",
    "og.image.alt": "Pairfob：电脑和手机上是同一份 Agent 会话列表",
    skip: "跳到正文",
    "brand.aria": "Pairfob 首页",
    "nav.aria": "本页",
    "nav.how": "怎么用",
    "nav.what": "能做什么",
    "nav.safe": "安全吗",
    "nav.faq": "常见问题",
    "nav.doc": "文档",
    "nav.github": "GitHub 上的源码",
    "nav.feedback": "反馈",
    "lang.aria": "语言",
    "cta.start": "开始使用",
    "cta.open": "设置 Pairfob",
    "start.copy": "复制",

    "hero.chip": "Herdr 的手机端",
    "hero.chip2": "开源 · 免费",
    "hero.title": "电脑上跑的 Agent，<br />手机随时接着操作。",
    "hero.tick1": "浏览器打开 Pairfob，两端都装 Tailscale",
    "hero.tick2": "不用注册",
    "hero.tick3": "端到端加密",
    "hero.sub":
      "Codex、Claude 在电脑上跑着，你<b>离开座位也不用停</b>：在手机上看进度、回它一句、替它按下确认。手机和电脑是<b>同一个终端</b>，不是远程桌面。",
    "hero.cta.how": "三步开始用",
    "hero.cta.see": "看看手机上长什么样",
    "hero.cta.install": "先在电脑上安装",
    "hero.figure": "同一个会话同时开在电脑终端和手机上",
    "demo.prev": "修一下 session 过期的测试",
    "demo.prompt": "再跑一遍 auth 的测试",
    "demo.ph": "组字 · 写完点发送",
    "demo.send": "发送",
    "demo.stop": "停止",
    "demo.done": "本轮结束",
    "demo.work": "工作中",
    "demo.wait": "等你",
    "demo.sync": "同一个会话，两边实时同步",
    beat1: "手机上写一句",
    beat2: "点发送，电脑终端里就有了",
    beat3: "Agent 停下来问你",
    beat4: "手机点 Enter，两边一起继续",
    "anim.pause": "暂停动画",
    "anim.play": "播放动画",
    "logos.lead": "<b>Herdr</b> 是电脑上跑 coding agent 的本机程序，里面跑的都能接：",

    "how.ask": "怎么用？",
    "how.h2": "电脑上装一次，手机扫一次码。",
    "how.p": "前两步在装有 Herdr 的电脑终端里做，第三步在手机上。之后就不用再配了。",
    "req.aria": "使用条件",
    "req1.b": "电脑",
    req1: "macOS 或 Linux，装好 Herdr 0.7+",
    "req2.b": "手机 / 平板",
    req2: "浏览器和 Tailscale，加入同一个 tailnet",
    "req3.b": "网络",
    req3: "允许手机访问电脑的 Tailscale IP 与 18474 端口",
    "where.pc": "在电脑上",
    "where.phone": "在手机上",
    "s1.term1": "# 在电脑终端里",
    "s1.term2": "校验下载 · 装成用户服务",
    "s1.term3": "之后开机自动运行，并拉起 Herdr",
    "s1.term4": "缺什么，它会告诉你",
    "s1.h": "安装 pairfob",
    "s1.p":
      '需要先装好 <a href="https://herdr.dev" target="_blank" rel="noreferrer">Herdr</a> 0.7+（电脑上跑 coding agent 的程序，Pairfob 不替代它）。支持 macOS 和 Linux。',
    "s2.h": "运行 <code>pairfob pair</code>",
    "s2.p": "终端里出现二维码。先别关，留着给手机扫。",
    "s3.h": "用手机扫描二维码",
    "s3.p": "扫完，电脑终端出现 <code>Press Enter to pair</code>，回电脑按一下 Enter 就配好了。",
    "s3.hint": "使用电脑上打印的完整链接；上方只是示例，不能用于配对。",
    "s3.open": "查看配对步骤",
    "after1.b": "之后每一次",
    after1: "手机打开电脑的 Tailscale 地址，就能用已保存的配对继续会话。",
    "after2.b": "第二台电脑",
    after2: "同样跑第 1 步，然后在手机上「设置 → 添加另一台电脑」。",

    "what.ask": "能帮你做什么？",
    "what.h2": "人不在电脑前，<br />Agent 也不用干等你。",
    "what.p": "点任意一项看对应的真实界面。",
    "tour.aria": "手机上能做的事",
    "tour.pause": "暂停轮播",
    "tour.play": "自动轮播",
    "t1.h": "一眼看到谁在等你",
    "t1.tag": "需要你 2",
    "t1.p": "所有会话按工作区分组。停下来等你的，会亮在顶部「需要你」一栏，点一下直达。",
    "t1.alt": "会话列表按工作区分组，顶部是「需要你」",
    "t2.h": "回它一句话",
    "t2.p": "用系统键盘写，听写、自动更正、多行都行。写完点发送，文字进的是电脑上那个真实终端。",
    "t2.alt": "会话页，输入框里写了两行消息",
    "t3.h": "按键一个不少",
    "t3.p": "Esc、方向键、Tab、Ctrl、Shift、Ctrl+C……在 TUI 里选选项、打断任务都能按。",
    "t3.alt": "会话页，展开了完整按键面板",
    "t4.h": "看它改了什么",
    "t4.p": "看它改了哪些文件，一个个翻 diff。点一行写批注，直接发给 Agent。",
    "t4.alt": "src/app.ts 未提交改动的 diff",
    "t5.h": "像聊天一样读结果",
    "t5.p": "对话模式把执行过程和回复排成消息，在手机上读长回复更轻松。",
    "t5.alt": "对话模式，显示执行过程和回复",
    "t6.h": "订阅额度还剩多少",
    "t6.p": "Codex、Claude、Copilot、Cursor、Grok……这台电脑上各家额度一眼看到。",
    "t6.alt": "设置页，每家订阅各有一个额度环",
    "wide.h": '<span class="nw">平板和另一台电脑，</span><span class="nw">打开也一样。</span>',
    "wide.p": "平板横过来就是左右两栏：左边会话列表，右边就是那个终端。",
    "wide.alt": "平板横屏上的 Pairfob：会话列表在左，终端在右",
    "x1.b": "一部设备管多台电脑",
    x1: "公司的、家里的，在设置里切换。",
    "x2.b": "等你时一眼看见",
    x2: "打开页面，「需要你」会话会排在顶部。",
    "x3.b": "在手机上新建会话",
    x3: "选工作区、选 Agent，就开跑。",
    "x4.b": "切 Git worktree",
    x4: "列出、新建、打开，越界路径直接拒绝。",
    "what.fine": "能用哪些，由电脑上当时的 Herdr 决定；它不支持的操作不会出现在界面上，也不会假装成功。",

    "vs.ask": "和别的方式有什么不同？",
    "vs.h2": "不是远程桌面，<br />也不是把 Agent 搬到云上。",
    "vs.not": "不是",
    "vs1.not": "远程桌面 / VNC / 投屏",
    "vs1.is": "只接会话，不搬整个桌面",
    "vs2.not": "浏览器里再开一个终端",
    "vs2.is": "打开电脑上已经在跑的会话",
    "vs3.not": "把 Agent 搬到云上",
    "vs3.is": "Agent 仍在你电脑上跑",
    "vs4.not": "精简版手机专用 Agent",
    "vs4.is": "电脑当时能做的，手机上也能做",
    "vs5.not": "账号登录",
    "vs5.is": "配对就是授权，凭证只在这台浏览器里",
    "vs6.not": "公网监听",
    "vs6.is": "Pairfob 只监听电脑的 Tailscale IP",

    "safe.ask": "安全吗？",
    "safe.h2": "通过你的 tailnet 直连。<br />会话内容端到端加密。",
    "safe.p":
      "手机连接电脑的 Tailscale IP，不通过 pairfob.com 中转；Herdr 仍只在电脑本机运行。",
    "route.p2p": "Tailscale 直连 · 18474 端口",
    "route.phone": "你的手机",
    "route.pc": "你的电脑",
    "route.key": "持有密钥",
    "route.wire": "Tailscale 传输 · 会话端到端加密",
    "safe.fine":
      "浏览器通过 Tailscale IP 使用 HTTP，可能提示“不安全”，并限制相机、安装和通知。用手机系统相机扫码，或粘贴完整配对链接。",
    "g1.b": "双层加密",
    g1: "Tailscale 保护传输；Pairfob 加密已配对的会话。",
    "g2.b": "只在 tailnet 内访问",
    g2: "两台设备都需获准访问电脑的 18474 端口。",
    "g3.b": "必须电脑按 Enter",
    g3: "配对要在电脑终端确认，别人拍到二维码也配不上。",
    "g4.b": "不用账号 · 开源",
    g4: "没有邮箱登录；Apache-2.0，代码在 GitHub。",

    "faq.ask": "还有疑问？",
    "faq.h2": "常见问题",
    "faq.feedback":
      '没找到答案？看<a href="/doc/zh/faq" data-locale-href="faq">文档</a>，或者<a href="https://github.com/arronKler/pairfob/issues/new" target="_blank" rel="noreferrer">去 GitHub 开 issue</a>。安全漏洞请私下报告。',
    "faq.q0": "要不要在手机上装 App？",
    "faq.a0": "先装 Tailscale，再在手机浏览器打开电脑的 Tailscale 地址。",
    "faq.q2": "锁屏或合盖之后还能用吗？",
    "faq.a2": "锁屏可以。合盖只有系统没睡才行。Pairfob 唤不醒已经睡着的电脑。",
    "faq.q3": "能在 Windows 上装 pairfob 吗？",
    "faq.a3": "还不能。Windows 可以打开网页当第二块屏幕，宿主仍是 macOS 或 Linux。",
    "faq.q4": "家里要开端口或开 Tailscale 吗？",
    "faq.a4": "需要。两端加入同一个 tailnet；Pairfob 监听电脑的 Tailscale IP 和 18474 端口。",
    "faq.q5": "一部设备能管多台电脑吗？",
    "faq.a5": "能。手机、平板、另一台电脑都可以当设备。第二台电脑装好后，设置 → 添加另一台电脑。",
    "faq.q6": "收费吗？",
    "faq.a6": "不收费。",

    "close.h2": "离开座位之前，<br />先把它装上。",
    "close.p": "在装有 Herdr 的电脑终端里运行：",
    "close.then": "然后运行 <b>pairfob pair</b>，让同一 tailnet 的手机扫描二维码。",
    "close.phone": "已经在电脑上装好了？",
    "foot.blurb": "Pairfob · Herdr 的手机端。跑 Herdr 的那台电脑目前要是 macOS 或 Linux。",
    "foot.aria": "页脚",
  };

  const en = {
    title: "Pairfob — continue the AI agent session on your computer from your phone",
    description:
      "Continue the coding agents already running on your computer from your phone. Pairfob serves the phone interface directly over your Tailscale network, with end-to-end encrypted sessions.",
    "og.image.alt": "Pairfob: the same agent list on computer and phone",
    skip: "Skip to content",
    "brand.aria": "Pairfob home",
    "nav.aria": "On this page",
    "nav.how": "How it works",
    "nav.what": "What it does",
    "nav.safe": "Security",
    "nav.faq": "FAQ",
    "nav.doc": "Docs",
    "nav.github": "Source on GitHub",
    "nav.feedback": "Feedback",
    "lang.aria": "Language",
    "cta.start": "Get started",
    "cta.open": "Set up Pairfob",
    "start.copy": "Copy",

    "hero.chip": "The phone surface for Herdr",
    "hero.chip2": "Open source · Free",
    "hero.title": "Agents that run on your computer,<br />continued from your phone.",
    "hero.tick1": "Pairfob in the browser · Tailscale on both devices",
    "hero.tick2": "No account",
    "hero.tick3": "End-to-end encrypted",
    "hero.sub":
      "Codex and Claude keep running on your computer, and <b>leaving your desk doesn't stop the work</b>: check progress, reply, and confirm from your phone. Phone and computer share <b>the same terminal</b>. It is not a remote desktop.",
    "hero.cta.how": "Get started in 3 steps",
    "hero.cta.see": "See it on the phone",
    "hero.cta.install": "Install on your computer first",
    "hero.figure": "The same session open in the computer terminal and on the phone",
    "demo.prev": "fix the session expiry test",
    "demo.prompt": "run the auth tests again",
    "demo.ph": "Compose · tap Send when done",
    "demo.send": "Send",
    "demo.stop": "Stop",
    "demo.done": "Turn finished",
    "demo.work": "Working",
    "demo.wait": "Needs you",
    "demo.sync": "One session, live on both screens",
    beat1: "Write on the phone",
    beat2: "Tap Send and it's in the computer's terminal",
    beat3: "The agent stops to ask",
    beat4: "Tap Enter on the phone and both sides carry on",
    "anim.pause": "Pause animation",
    "anim.play": "Play animation",
    "logos.lead": "<b>Herdr</b> runs coding agents on your computer. Pairfob picks up any of them:",

    "how.ask": "How does it work?",
    "how.h2": "Install once on the computer, scan once with the phone.",
    "how.p":
      "The first two steps run in a terminal on the computer with Herdr; the third is on your phone. After that, you're set.",
    "req.aria": "Requirements",
    "req1.b": "Computer",
    req1: "macOS or Linux with Herdr 0.7+",
    "req2.b": "Phone / tablet",
    req2: "Browser and Tailscale on the same tailnet",
    "req3.b": "Network",
    req3: "Tailscale permits access to the computer on port 18474",
    "where.pc": "On the computer",
    "where.phone": "On the phone",
    "s1.term1": "# in a terminal on the computer",
    "s1.term2": "verifies the download · installs a user service",
    "s1.term3": "then starts at login and launches Herdr",
    "s1.term4": "tells you what is still missing",
    "s1.h": "Install pairfob",
    "s1.p":
      'Needs <a href="https://herdr.dev" target="_blank" rel="noreferrer">Herdr</a> 0.7+, which runs your coding agents; Pairfob doesn\'t replace it. macOS and Linux.',
    "s2.h": "Run <code>pairfob pair</code>",
    "s2.p": "A QR code appears in the terminal. Leave it there for the phone.",
    "s3.h": "Scan the QR with your phone",
    "s3.p":
      "After the scan, the terminal shows <code>Press Enter to pair</code>. Press Enter on the computer and you're paired.",
    "s3.hint": "Use the complete link printed on your computer; the example above is not a pairing link.",
    "s3.open": "How to pair",
    "after1.b": "Every time after",
    after1: "Open the computer's Tailscale address to resume with your saved pairing.",
    "after2.b": "A second computer",
    after2: "Run step 1 there too, then on your phone: Settings → Add another computer.",

    "what.ask": "What does it do for you?",
    "what.h2": "You're away from the desk.<br />Your agents don't have to wait.",
    "what.p": "Tap any item to see the real screen.",
    "tour.aria": "What you can do on the phone",
    "tour.pause": "Pause",
    "tour.play": "Autoplay",
    "t1.h": "See who needs you",
    "t1.tag": "Needs you 2",
    "t1.p":
      "Sessions are grouped by workspace. Anything waiting on you lights up in the Needs you strip at the top; one tap takes you there.",
    "t1.alt": "Session list grouped by workspace, with Needs you at the top",
    "t2.h": "Reply in a sentence",
    "t2.p":
      "Write with the system keyboard: dictation, autocorrect, several lines. Tap Send and it goes into the real terminal on your computer.",
    "t2.alt": "Session screen with a two-line message in the compose box",
    "t3.h": "Every key you need",
    "t3.p": "Esc, arrows, Tab, Ctrl, Shift, Ctrl+C… pick an option in a TUI or interrupt a task.",
    "t3.alt": "Session screen with the full key pad open",
    "t4.h": "See what it changed",
    "t4.p": "Go through the changed files one diff at a time. Tap a line, write a note, and send it to the agent.",
    "t4.alt": "Diff of an uncommitted change in src/app.ts",
    "t5.h": "Read results like a chat",
    "t5.p": "Chat mode lays out the steps and the reply as messages, easier to read on a phone.",
    "t5.alt": "Chat mode with the run steps and the reply",
    "t6.h": "How much quota is left",
    "t6.p": "Codex, Claude, Copilot, Cursor, Grok… see what's left on each plan used on this computer.",
    "t6.alt": "Settings with a quota ring for each plan",
    "wide.h": '<span class="nw">On a tablet or another computer,</span> <span class="nw">it works the same.</span>',
    "wide.p": "Turn a tablet sideways for two columns: sessions on the left, the terminal on the right.",
    "wide.alt": "Pairfob on a tablet in landscape: the session list beside the terminal",
    "x1.b": "One device, several computers",
    x1: "Work and home machines; switch in Settings.",
    "x2.b": "See when it needs you",
    x2: "Open Pairfob to see waiting sessions at the top.",
    "x3.b": "Start sessions from the phone",
    x3: "Pick a workspace and an agent, and go.",
    "x4.b": "Switch Git worktrees",
    x4: "List, create, open. Paths outside the allowed roots are refused.",
    "what.fine":
      "What's available is whatever the live Herdr on your computer supports. Unsupported actions aren't shown, and never faked as success.",

    "vs.ask": "How is it different?",
    "vs.h2": "Not a remote desktop,<br />and not agents in the cloud.",
    "vs.not": "Not",
    "vs1.not": "Remote desktop / VNC / screen share",
    "vs1.is": "Attaches to sessions, not the whole desktop",
    "vs2.not": "Another terminal in the browser",
    "vs2.is": "Opens the session already running on the computer",
    "vs3.not": "Agents moved into the cloud",
    "vs3.is": "Agents still run on your computer",
    "vs4.not": "A cut-down mobile agent",
    "vs4.is": "What the computer can do is what the phone can do",
    "vs5.not": "An account login",
    "vs5.is": "Pairing is authorization; the credential stays in this browser",
    "vs6.not": "A public internet listener",
    "vs6.is": "Pairfob listens only on the computer's Tailscale IP",

    "safe.ask": "Is it secure?",
    "safe.h2": "Direct through your tailnet.<br />Sessions stay end-to-end encrypted.",
    "safe.p":
      "Your phone connects to Pairfob on the computer's Tailscale IP. Pairfob does not relay this connection through pairfob.com. Herdr stays on the computer's local socket.",
    "route.p2p": "Tailscale direct · port 18474",
    "route.phone": "Your phone",
    "route.pc": "Your computer",
    "route.key": "Holds the keys",
    "route.wire": "Tailscale transport · end-to-end session encryption",
    "safe.fine":
      "The browser uses HTTP on the Tailscale IP, so it may say “Not Secure” and limit camera, installation, and notifications. Scan with the phone's system camera or paste the complete pairing link.",
    "g1.b": "Two layers of encryption",
    g1: "Tailscale protects transport; Pairfob encrypts the paired session.",
    "g2.b": "Tailnet access only",
    g2: "Both devices need Tailscale access to the computer's port 18474.",
    "g3.b": "Enter on the computer",
    g3: "Pairing is approved in the computer's terminal, so a photo of your QR code isn't enough.",
    "g4.b": "No account · open source",
    g4: "No email login. Apache-2.0, with the code on GitHub.",

    "faq.ask": "Still have questions?",
    "faq.h2": "FAQ",
    "faq.feedback":
      'Didn\'t find it? Read the <a href="/doc/faq" data-locale-href="faq">docs</a> or <a href="https://github.com/arronKler/pairfob/issues/new" target="_blank" rel="noreferrer">open a GitHub issue</a>. Report security issues privately.',
    "faq.q0": "Do I need to install an app on my phone?",
    "faq.a0": "Install Tailscale, then open Pairfob at your computer's Tailscale address in the browser.",
    "faq.q2": "Does locking the screen or closing the lid still work?",
    "faq.a2": "A locked screen is fine. A closed lid only works if the machine does not sleep. Pairfob cannot wake a sleeping computer.",
    "faq.q3": "Can I install pairfob on Windows?",
    "faq.a3": "Not yet. A Windows machine can open the page as another screen. The host still has to be macOS or Linux.",
    "faq.q4": "Do I need Tailscale or an inbound port?",
    "faq.a4": "Yes. Both devices join the same tailnet; Pairfob listens on the computer's Tailscale IP and port 18474.",
    "faq.q5": "Can one device manage several computers?",
    "faq.a5":
      "Yes. A phone, tablet, or another computer can be the device. After the second host is installed: Settings → Add another computer.",
    "faq.q6": "Does it cost money?",
    "faq.a6": "No.",

    "close.h2": "Before you leave your desk,<br />set it up.",
    "close.p": "Run this in a terminal on the computer with Herdr:",
    "close.then": "Then run <b>pairfob pair</b> and scan its QR with a phone on the same tailnet.",
    "close.phone": "Already set up on your computer?",
    "foot.blurb": "Pairfob · the phone surface for Herdr. The computer that runs Herdr has to be macOS or Linux for now.",
    "foot.aria": "Footer",
  };

  const COPY = { zh, en };

  function text(lang, key) {
    const table = COPY[lang] || COPY.zh;
    return table[key] ?? COPY.zh[key] ?? "";
  }

  function apply(lang) {
    const root = document;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const value = text(lang, el.getAttribute("data-i18n"));
      if (!value) return;
      if (el.hasAttribute("data-i18n-html")) el.innerHTML = value;
      else el.textContent = value;
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const value = text(lang, el.getAttribute("data-i18n-aria"));
      if (value) el.setAttribute("aria-label", value);
    });
    root.querySelectorAll("[data-i18n-alt]").forEach((el) => {
      const value = text(lang, el.getAttribute("data-i18n-alt"));
      if (value) el.setAttribute("alt", value);
    });
    // Product stills are captured per locale (scripts/site-shots.ts); the static
    // src is English and data-src-zh holds the Chinese capture.
    root.querySelectorAll("img[data-src-zh]").forEach((img) => {
      if (!img.dataset.srcEn) img.dataset.srcEn = img.getAttribute("src");
      const next = lang === "zh" ? img.dataset.srcZh : img.dataset.srcEn;
      if (img.getAttribute("src") !== next) img.setAttribute("src", next);
    });
    document.title = text(lang, "title");
    const desc = text(lang, "description");
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", desc);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", text(lang, "title"));
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", desc);
    const ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.setAttribute("content", lang === "en" ? "en_US" : "zh_CN");
    const altLocale = document.querySelector('meta[property="og:locale:alternate"]');
    if (altLocale) altLocale.setAttribute("content", lang === "en" ? "zh_CN" : "en_US");
    const url = ORIGIN + (lang === "en" ? "/" : "/zh/");
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute("content", url);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", url);
    // Only matters for a JS-rendering crawler; unfurlers read the static head.
    const card = ORIGIN + (lang === "en" ? "/og-en.png" : "/og.png");
    document
      .querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')
      .forEach((el) => el.setAttribute("content", card));
    const cardAlt = document.querySelector('meta[property="og:image:alt"]');
    if (cardAlt) cardAlt.setAttribute("content", text(lang, "og.image.alt"));
    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) twitterTitle.setAttribute("content", text(lang, "title"));
    const twitterDesc = document.querySelector('meta[name="twitter:description"]');
    if (twitterDesc) twitterDesc.setAttribute("content", desc);

    const docHref = lang === "en" ? "/doc/" : "/doc/zh/";
    document.querySelectorAll("[data-locale-href=doc]").forEach((el) => el.setAttribute("href", docHref));
    const faqHref = lang === "en" ? "/doc/faq" : "/doc/zh/faq";
    document.querySelectorAll("[data-locale-href=faq]").forEach((el) => el.setAttribute("href", faqHref));

    document.querySelectorAll(".lang-btn").forEach((btn) => {
      const on = btn.getAttribute("data-lang") === lang;
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });

    const ld = document.querySelector('script[type="application/ld+json"]');
    if (ld) {
      try {
        const data = JSON.parse(ld.textContent);
        data.url = url;
        data.description = desc;
        data.softwareRequirements = lang === "en" ? "Herdr 0.7 or newer" : "Herdr 0.7 或更高版本";
        ld.textContent = JSON.stringify(data);
      } catch {
        /* leave original */
      }
    }
  }

  function syncUrl(lang) {
    const want = PairfobLang.marketingPath(lang);
    const path = location.pathname === "/zh" || location.pathname.startsWith("/zh/") ? "/zh/" : "/";
    if (!PairfobLang.samePath(want, path)) {
      history.replaceState(null, "", want + location.search + location.hash);
    }
  }

  function choose(lang) {
    const value = PairfobLang.set(lang);
    apply(value);
    syncUrl(value);
    PairfobLang.notify(value);
  }

  function bootMarketing() {
    if (!window.PairfobLang) return;
    const lang = PairfobLang.prefer(location.pathname);
    if (!PairfobLang.readSaved()) PairfobLang.set(lang);
    apply(lang);
    syncUrl(lang);
    PairfobLang.notify(lang);
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => choose(btn.getAttribute("data-lang")));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootMarketing);
  } else {
    bootMarketing();
  }
})();
