---
title: Using the app
description: List, open a session, use the system keyboard, and respond when an agent needs you. Controls appear only when the computer supports them.
---

# Using the app

Pairfob opens on the session list from the computer. Tapping a card opens that session, not a copy and not a screenshot.

Labels below are the English Pairfob strings. **Settings → Language** can pin **English**, **中文**, or **Browser default**.

Wide layouts (roughly a landscape tablet or a desktop browser) use two columns: list on the left, session on the right. Phones are one screen at a time. Swipe right from the left edge of a session to return to the list.

## The list

The default groups by **Workspace**, meaning by project directory. The **Workspace** button at the top right of the list opens **Group by**:

- **Workspace** — Herdr workspaces (default)
- **Agent** — agent kinds
- **All** — no grouping, one list

The same sheet has **Expand all** / **Collapse all**. Cards and groups follow the order you last opened them; a status change never moves a row.

Grouped headings toggle open and closed. The first group starts open; the rest start collapsed. When **Pinned** is present, that section and the group under it start open.

When a session is waiting on you, a **Needs you** strip at the top of the list lists it; one tap opens it.

The card title is a single identity: the session name if you set one; otherwise the workspace name when it is not just the directory name; otherwise a task-like terminal title (stripping live crumbs such as `Thinking` / `Waiting for response` and a trailing ` - grok`). If none of those exist, it shows **claude**, or **Terminal** for a shell. The next line is always coordinates in the form **claude · pairfob** (Agent · folder · a non-default tab), omitting words already in the title and default tabs such as `main`. Internal IDs are never presented as names.

- **Session name** names this terminal surface only.
- **Tab name** names the tab containing one or more sessions.
- **Workspace name** names the outer project container and becomes the heading when grouped by workspace.

| Label | Meaning |
| --- | --- |
| **Needs you** | The agent is waiting for confirm or input; the card is emphasized |
| **Working** | Running |
| **Turn finished** | This turn is done |
| **Waiting for input** | Ready for the next thing you give it |
| **Idle** | Connected, not busy |
| **Starting** | The agent is starting up |
| **Unknown** | The computer did not report a status, or it cannot be confirmed right now |

When Pairfob is connected, an empty list means there are no sessions yet; create one or open a terminal on the computer. Only the explicit **Herdr is not running on the computer** state means Herdr is closed. You can run `pairfob doctor` on the computer to confirm.

**New** appears when the computer supports creating a session: bottom right on a phone, at the top of the left rail on a wide screen. **New tab** (list long-press or session `···`) and **Split** (session `···`) use the same kind list. Each form can start a supported agent, or a **Terminal only (no agent)** pane. With no kinds listed, the dialog still opens and creates that terminal session. An in-flight worktree shows a progress card above the list until it finishes.

Tap a card to open it. Long-press (right-click on a computer) to **Pin to top**, open another tab in this workspace, rename, or close that session. Pinned sessions move into a **Pinned** section at the top of the list and leave their workspace or Agent group; long-press again to **Unpin**. **Rename tab** appears only when the tab already has a visible name, or the tab is split; **Close the whole tab** only when split. Grouped by workspace, long-press the group heading to create a tab in that workspace, rename it, or **Close this workspace**; in other groupings workspace rename and close sit at the bottom of the card menu. Create-tab actions appear only when the computer supports them. Split stays in `···` after you open a session.

**Board** (also **Tab layout** in a card's long-press menu) opens a zoomable canvas of one tab’s real pane split from the computer. Pinch or scroll to zoom out and see the whole tab. Workspace chips switch the project you are looking at; the tab row under them creates and switches tabs. Tapping a pane opens that session. This does not steal focus on the computer.

On a phone, the bottom bar has **Sessions** / **Board** / **Settings**; **Sessions** shows a count when something needs you. On a wide screen the same entries sit in a row at the top of the left rail: **New** / **Computers** / **Board** / **Settings**.

## Inside a session

Opening a session defaults to **Auto**. On this direct Tailscale deployment it uses **Control**; the computer still owns the live session.

Chrome:

- Left: back to the list (phone). The back control shows a count when other sessions need you
- Center: agent icon, name and status. It is display-only; switch sessions from the list or with the edge swipe
- Right: **Browse files and changes**, then `···` **Session actions** (how this view looks and types, this pane's name, close this pane)

Stopping a working agent lives on the button beside the compose field; see **Control** below.

The four choices are at the top of `···` under **Mode**. A switch inside a session is remembered for that session only. The default for newly opened sessions is in **Settings**.

| Mode | What it is |
| --- | --- |
| **Auto** | Uses Control on the direct Tailscale deployment; other modes depend on available capabilities |
| **Control** | View the terminal and operate the session with the system keyboard and keypad |
| **Terminal** | A real terminal. Use for vim or a full-screen TUI. On a phone the default is an 80-column view you pan sideways; **Fit screen** resizes the computer to the phone width. Vertical pan still scrolls remotely |
| **Chat** | Message the Agent (this is where you send a task; it is not a `···` menu item). The run collapses after the reply |

In **Control**:

- The compose box uses the **system keyboard**, including dictation, autocorrect and several lines. On a phone keyboard Return adds a new line; tap **Send** when done. To make Return send, turn on **Return key sends** in Settings. On an external keyboard Enter sends and Shift+Enter adds a line
- The button beside the field changes with the situation:
  - With a draft: **Send** types it into the terminal and presses Enter
  - No draft while the agent is working: **Stop** sends Esc; if it keeps working the button becomes **Force stop**, and only a second tap sends Ctrl+C, once. Long-pressing **Send** while it works also stops it
  - Otherwise: **Enter** (↵) sends a terminal Return
- **Compose / Live** is under `···` → **Input and display** → **Input**, for this session only; Live marks the field with **Live**
- Confirmation choices stay in the terminal view. Follow the prompt: use the keypad's ↑/↓ to select, then Enter to confirm. Type a letter or text when the prompt asks for it
- Tapping a row offers **Copy**, **Copy path**, **Quote** into compose, or **Select…** text
- Swipe or **Page up** pages the live view; it does not dump history
- Font size is remembered
- Long lines can wrap or not
- The first keypad row is Esc, arrows and Backspace. `···` expands it; switch between **Keys** and **Commands**. Keys has two pages, **Control** (Ctrl, Alt, Shift, Cmd, Tab, Shift+Tab, Enter, Ctrl+C and more) and **Select & edit**; Commands holds the agent's slash commands (such as `/clear`, typed into the terminal; Pairfob does not interpret them) and your own saved commands, which you can add, edit and reorder

When **Chat** shows **Needs you**, tap **Go confirm** to switch to **Control** and read the terminal prompt. Check the operation and current selection before confirming. You can also switch to **Terminal** through `···` → **Mode** when needed.

The computer and phone operate the same terminal dialog. Once either confirms it, the other sees the updated state. If the prompt is missing on the phone, handle it on the computer and report the phone's mode, Agent / extension versions, and a redacted recording.

## Files and changes

The folder control in the session chrome is not the Worktree menu. It opens this pane's workspace, with the current branch and how many commits it is ahead at the top:

- **Files** — directory listing and a text preview
- **Changes** — uncommitted git status in **Staged Changes** and **Changes**; tap a file for the diff
- A diff switches between **Staged** and **Working tree**, **Open file** shows the whole file, and **Previous** / **Next** at the bottom step through changed files
- Tap a diff line to comment, then **Send to agent**
- The branch list is read-only. Switch work with worktree actions

If the computer daemon cannot inspect the workspace, the page says so.

## Upload attachments

The current direct deployment has P2P disabled. The attachment picker and upload flow require that legacy transport, so **file uploads are unavailable here**. Reading files and diffs in the workspace remains available. Do not select a file expecting it to reach the computer.

## Actions that may appear on this view

Tap the session chrome `···`. Missing items are not drawn. **Rename tab**, **Rename workspace**, **Close the whole tab**, and **Close this workspace** live on the list long-press menu, not here.

| Group | May include |
| --- | --- |
| Mode | Auto, Control, Terminal (vim / TUI), Chat |
| Tiles | Copy screen, New tab, Split, Rename |
| Input and display | Input: Compose / Live (Control), Larger text / Smaller text, Wrap long lines (Control), Fit width to screen (Terminal) |
| Session | Layout (drag dividers to resize, long-press this pane to swap it, zoom), Worktree (list, new, open), Agent info, Close session |

**Chat** groups thinking and tools into a collapsible run that closes once the reply is in. Expand the run to see arguments and results. **Copy reply** sits on a finished answer. **Load earlier** pulls older turns when the thread is long.

The web surface does not offer arbitrary shell, deleting worktrees, or yanking the computer window to the front.

## Settings

Tap **Settings** at the bottom on a phone, or at the top of the left rail on a wide screen.

- **Connection:** shows the computer, this phone, and the active **Tailscale direct** path. There is no Relay / P2P path selector. **Add another computer** creates another pairing, and **Switch computer** appears when you have more than one
- **Subscription quota:** allowance for accounts signed in on this computer (Codex, Claude Code, GitHub Copilot, Cursor, Grok, Antigravity). Overview rings; **Usage details** for each window. **Refresh quota** on that page. Missing or stale data is not shown as zero
- **Language:** **Browser default**, or pin **中文** / **English**. This only changes Pairfob on this device. Docs have their own language menu in the top bar; both remember `pairfob_lang`
- **Mode:** defaults to **Auto**, or can be pinned to **Control** / **Terminal** / **Chat**. A later switch is remembered per session
- **Input:** whether new sessions start in Compose (write, then Send) or Live (type straight into the terminal). `···` → **Input and display** switches one session only
- **Return key sends:** off by default, so the phone keyboard's Return adds a line and the send button sends; turn it on to send with Return. External keyboards always send with Enter and add a line with Shift+Enter
- **Notifications:** unavailable on this HTTP direct host; see [Notifications](/push)
- **Paired devices:** label, online or offline, last used, and notification state. The current row is marked **This phone**. Other rows have **Unpair**; already unpaired rows are omitted
- **Export connection diagnostics:** export recent connection events when something goes wrong; see the [FAQ](/faq)
- **Computer update:** the direct host may not serve the phone’s release check. Use `pairfob update` for a release binary or rebuild a source-built binary; see [CLI](/cli)
- **Danger zone:** **Unpair this phone**. Pairing is required to connect again

A lost phone that can still open Pairfob can also unpair other devices from Settings. `pairfob forget` that phone on the computer immediately — [Multiple devices](/devices).

## Another window

If another browser window of the same paired device opens Pairfob, the old window may say **Another window took over this phone**. Keep a single open page.

## Add to Home Screen

See [Get started](/start). HTTP on a Tailscale IP may prevent PWA installation; the browser page still works.
