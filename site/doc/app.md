---
title: Using the app
description: List, open a session, use the system keyboard, and respond when an agent needs you. Controls appear only when the computer supports them.
---

# Using the app

Pairfob opens on the session list from the computer. Tapping a card opens that session, not a copy and not a screenshot.

Labels below are the English Pairfob strings. **Settings → Language** can pin **English**, **中文**, or **Browser default**.

Wide layouts (roughly a landscape tablet or a desktop browser) use two columns: list on the left, session on the right. Phones are one screen at a time. Swipe right from the left edge of a session to return to the list.

## The list

The default is a flat list, ordered by recent activity (create, status change, open). In **Settings**, grouping is:

- **All** — one list
- **By workspace** — Herdr workspaces
- **By agent** — agent kinds

Grouped headings toggle open and closed. The first group starts open; the rest start collapsed. When **Pinned** is present, that section and the group under it start open.

The card title is a single identity: the session name if you set one; otherwise the workspace name when it is not just the directory name; otherwise a task-like terminal title (stripping live crumbs such as `Thinking` / `Waiting for response` and a trailing ` - grok`). If none of those exist, it shows **claude**, or **Terminal** for a shell. The next line is always coordinates in the form **claude · pairfob** (Agent · folder · a non-default tab), omitting words already in the title and default tabs such as `main`. Internal IDs are never presented as names.

- **Session name** names this terminal surface only.
- **Tab name** names the tab containing one or more sessions.
- **Workspace name** names the outer project container and becomes the heading when grouped by workspace.

| Label | Meaning |
| --- | --- |
| **Needs you** | The agent is waiting for confirm or input; the card is emphasized |
| **Working** | Running |
| **Idle** | Connected, not busy |
| **Done** | This turn finished |

When Pairfob is connected, an empty list means there are no sessions yet; create one or open a terminal on the computer. Only the explicit **Herdr is not running on the computer** state means Herdr is closed. You can run `pairfob doctor` on the computer to confirm.

**New** appears in the top bar when the computer supports creating a session. **New tab** (list long-press or session `···`) and **Split** (session `···`) use the same kind list. Each form can start a supported agent, or a **Terminal only (no agent)** pane. With no kinds listed, the dialog still opens and creates that terminal session. An in-flight worktree shows a progress card above the list until it finishes.

Tap a card to open it. Long-press (right-click on a computer) to **Pin to top**, open another tab in this workspace, rename, or close that session. Pinned sessions move into a **Pinned** section at the top of the list and leave their workspace or Agent group; long-press again to **Unpin**. **Rename tab** appears only when the tab already has a visible name, or the tab is split; **Close the whole tab** only when split. Grouped by workspace, long-press the group heading to create a tab in that workspace, rename it, or **Close this workspace**; in other groupings workspace rename and close sit at the bottom of the card menu. Create-tab actions appear only when the computer supports them. Split stays in `···` after you open a session.

**Board** in the top bar (also **Tab layout** on a card or in session `···`) opens a zoomable canvas of one tab’s real pane split from the computer. Pinch or scroll to zoom out and see the whole tab. Workspace chips switch the project you are looking at; the tab row under them creates and switches tabs. Tapping a pane opens that session. This does not steal focus on the computer.

## Inside a session

Opening a session defaults to **Auto**: Terminal on a P2P direct connection when the browser supports WebGL2 and Save-Data is off, otherwise Control. The session remains on the computer; this is not a remote-desktop screenshot or another terminal running in the browser.

Chrome:

- Left: back to the list (phone)
- Center: name and status; tap to switch sessions
- While working, an interrupt control is the same as Esc
- Right: **Browse files and changes**, then `···` **Session actions** (how this view looks and types, this pane's name, close this pane)

The four choices are under `···` → **Mode**. A switch inside a session is remembered for that session only. The default for newly opened sessions is in **Settings**.

| Mode | What it is |
| --- | --- |
| **Auto** | Chooses when the session opens: Terminal on P2P with WebGL2 unless Save-Data is on, otherwise Control |
| **Control** | View the terminal and operate the session with the system keyboard and keypad |
| **Terminal** | A real terminal. Use for vim or a full-screen TUI. On a phone the default is an 80-column view you pan sideways; **Fit screen** resizes the computer to the phone width. Vertical pan still scrolls remotely |
| **Chat** | Message the Agent (this is where you send a task; it is not a `···` menu item). The run collapses after the reply |

In **Control**:

- The compose box uses the **system keyboard**, including dictation and autocorrect. **Compose / Live** switches sit above the field
- Confirmation choices stay in the terminal view. Follow the prompt: use the keypad's ↑/↓ to select, then Enter to confirm. Type a letter or text when the prompt asks for it
- The trailing control is **Enter**: with no draft it is a terminal Return; with a draft it types then confirms
- Tapping a row can copy the line, copy a path, quote into compose, or start text selection
- Swipe or **Page up** pages the live view; it does not dump history
- Font size is remembered
- Long lines can wrap or not
- The keypad starts with Esc and arrows. **More keys** adds Tab, Ctrl+C, and a **Commands** pad with tokens such as `/clear` and `/goal` (typed into the terminal; Pairfob does not interpret them)

When **Chat** shows **Needs you**, tap **Go confirm** to switch to **Control** and read the terminal prompt. Check the operation and current selection before confirming. You can also switch to **Terminal** through `···` → **Mode** when needed.

The computer and phone operate the same terminal dialog. Once either confirms it, the other sees the updated state. If the prompt is missing on the phone, handle it on the computer and report the phone's mode, Agent / extension versions, and a redacted recording.

## Files and changes

The folder control in the session chrome is not the Worktree menu. It opens this pane's workspace:

- **Files** — directory listing and a text preview
- **Changes** — uncommitted git status; tap a file for the diff
- Tap a diff line to comment, then **Send to agent**
- The branch list is read-only. Switch work with worktree actions

If the computer daemon cannot inspect the workspace, the page says so.

## Upload attachments

Tap **Attach files** beside the session's compose field to **Choose file**, pick from **Photo library**, or **Take photo**. The entry appears only when the computer supports uploads. If it is missing, check the connection and update Pairfob on the computer.

### Upload and pass a file to the Agent

1. Select files. For an image, you can edit it and choose **Smart compress** or **Original**.
2. Make sure the session has a **P2P direct connection**. Use **Connect P2P** inside the attachment sheet if needed.
3. Tap **Upload** for one file or **Upload all**. Connecting P2P does not start uploads automatically.
4. When complete, tap **Insert path** or **Insert all paths** to add the computer-side paths to the current draft. Add your instructions and send the draft yourself.

Files are saved in the current session's workspace on the computer. Uploading and inserting paths do not automatically send a task or press terminal Enter. File transfer works independently of which Agent is running; reading a PDF, understanding an image, or parsing an Office document depends on that Agent's model and tools.

### File types and limits

**PDFs are supported and transferred unchanged.** **Choose file** does not restrict extensions: text, Markdown, JSON, images, Office documents, archives, audio and video can also be selected. Upload support does not imply that Pairfob previews or parses a format.

The computer saves attachments under controlled filenames. A PDF correctly identified by the browser is saved with `.pdf`; types without a dedicated mapping, or without a recognized type, may be saved as `.bin` with their contents unchanged.

| Limit | Current value |
| --- | --- |
| Attachment queue per session | Up to 5 files |
| Actual uploaded file | Up to 20 MiB each |
| Actual uploaded total in the same queue | Up to 40 MiB |
| Source files retained locally | Up to 80 MiB total |

Eligible JPEG photos can be selected at up to 40 MiB per source file, but the compressed result must still meet the upload limits. PDFs and other ordinary files are limited to 20 MiB at selection. **Local retained capacity is not an upload allowance.** If compression fails or Original leaves a file over the limit, reduce its size first.

### Smart image compression

The default is **Photo → Smart compress**. Processing starts after you explicitly start an upload and P2P is ready, not immediately when you select an image:

- Ordinary JPG/JPEG photos larger than 256 KiB are compression candidates, with an output long edge of at most 2048 pixels. PNGs produced by editing a JPEG photo may also use this path.
- Ordinary PNG, WebP, AVIF, HEIC/HEIF, GIF and SVG files stay original. Files recognized as screenshots by their names also skip automatic compression.
- **Text & detail** or **Original** skips this compression step. Original keeps any edits already made.
- Files of 256 KiB or less, failed compression, or results saving less than 10% keep the original.

Each file shows the actual size savings or why the original was kept. Choose **Text & detail** for text screenshots, error messages and fine diagrams.

### Interruptions, status checks and resuming

**File uploads use P2P only.** Relay can show the session and **Check status**, but cannot start or continue sending files. Unsent queue work stops when P2P is unavailable; prepared image results can be reused. After reconnecting, explicitly tap **Upload**, **Upload all**, or **Continue upload**.

After an interruption or an uncertain result, use **Check status** to find out how much the computer has received. This only reads status and never resumes automatically. Once P2P is ready, tap **Continue upload**. After a page reload, the browser attempts to restore unfinished attachments saved locally. Recovery is not guaranteed if browser storage is unavailable or its records have been cleared; follow the on-screen instructions.

**Transfer details** separates hashing, local saving, sending and other measured stages. **Saving resume information** means the browser is storing its recovery record; that file has not entered the network sending stage yet.

## Actions that may appear on this view

Tap the session chrome `···`. Missing items are not drawn. **Rename tab**, **Rename workspace**, **Close the whole tab**, and **Close this workspace** live on the list long-press menu, not here.

| Group | May include |
| --- | --- |
| Mode | Auto, Control, Terminal (vim / TUI), Chat |
| Input | Compose, Live (Control) |
| Display | Wrap long lines (Control), width Fit screen / 80 columns (Terminal), Select text, Larger text / Smaller text, Copy screen text. **Chat** does not show this group |
| New | New tab, Split |
| Worktree | Worktree list, New worktree, Open worktree |
| Layout | Make this pane larger, Swap with the facing pane |
| (ungrouped) | Rename session, Close this session |

**Chat** groups thinking and tools into a collapsible run that closes once the reply is in. Expand the run to see arguments and results. **Copy reply** sits on a finished answer. **Load earlier** pulls older turns when the thread is long.

The web surface does not offer arbitrary shell, deleting worktrees, or yanking the computer window to the front.

## Settings

From the top-right of the list (**Settings**).

- **Connection:** computer name, online state, this phone’s label (for example iPhone), and **Network path** as **Auto** / **P2P** / **Relay**. Auto prefers a direct path; P2P tries one now; Relay stays on the relay. The current path and round-trip sit on the same card. The choice is remembered in this browser. **Add another computer** starts another pairing without replacing the current one. With more than one credential, **Switch computer** appears here and **Computers** appears in the top bar
- **Subscription quota:** allowance for accounts signed in on this computer (Codex, Claude Code, GitHub Copilot, Cursor, Grok, Antigravity). Overview rings; **Usage details** for each window. **Refresh quota** on that page. Missing or stale data is not shown as zero
- **Language:** **Browser default**, or pin **中文** / **English**. This only changes Pairfob on this device. Docs have their own language menu in the top bar; both remember `pairfob_lang`
- **Session list:** grouping (**All** / **By workspace** / **By agent**)
- **Mode:** defaults to **Auto**, or can be pinned to **Control** / **Terminal** / **Chat**. A later switch is remembered per session
- **Input:** send after composing, or type live into the terminal. The **Enter** button beside the field also sends a terminal Return when the draft is empty. The switches above the session's compose field control the same preference
- **Notifications:** see [Notifications](/push). Once enabled, this phone is notified when an Agent needs you or finishes; if the computer has not enabled push, it shows **Off on the computer**
- **Paired devices:** label, online or offline, last used, and notification state. The current row is marked **This phone**. Other rows have **Unpair**; already unpaired rows are omitted
- **Computer update:** a reminder on the list, and **Check for updates** / **Update computer** at the bottom of Settings when the user service can do it. Confirming briefly disconnects, then reconnects. Never automatic. Command-line: [CLI](/cli)
- **Danger zone:** **Unpair this phone**. Pairing is required to connect again

A lost phone that can still open Pairfob can also unpair other devices from Settings. `pairfob forget` that phone on the computer immediately — [Multiple devices](/devices).

## Another window

If another browser window of the same paired device opens Pairfob, the old window may say **Another window took over this phone**. Keep a single open page.

## Add to Home Screen

See [Get started](/start#add-to-home-screen). On iOS, prefer Safari → Add to Home Screen for daily use.
