# Phase 2 conversation acceptance

This checklist covers the second-phase Pi conversation experience. The QA scenes are deterministic browser fixtures mounted through the real App architecture; they are not evidence of a real Pi runtime or a physical-device pass.

## Deterministic scenes

| Scene ID | Purpose | Browser actions / evidence |
| --- | --- | --- |
| `chat-pi-long` | Twelve user/thinking/tool/assistant turns, including successful tool output, an error result, empty successful output, and expandable detail references. | `await qa.setScene("chat-pi-long")`; record viewport, first/last visible turn, error presentation, empty-result presentation, and tool-detail expansion. |
| `chat-pi-unread` | Long transcript with follow disabled and an unread update near the top. | `await qa.setScene("chat-pi-unread")`; verify the new-reply control is visible, scroll position is not forced to the tail, activate the control, then record resulting position/control state. |
| `chat-pi-recovery` | Stable long transcript for recovery behavior. | `await qa.setScene("chat-pi-recovery")`; `qa.clearCalls()`; `qa.setConnected(false)`; `qa.emit({type:"reconnecting",message:"QA reconnect"})`; `qa.setConnected(true)`; `qa.emit({type:"connected"})`; `qa.emit({type:"poke",reason:"agent_update"})`; `await qa.render()`. Record calls and confirm no mutation replay. For foreground exercise, background/foreground the tab and record visibility plus calls. |
| `chat-pi-compose` | Focused three-line English/Chinese compose value with active IME composition and selection. | Use a 320 px wide viewport before selection; `await qa.setScene("chat-pi-compose")`; record focused input node ID, value, selection, viewport, and horizontal overflow before/after `qa.render()`. |

Tool details use the fixture's existing `agentTraceDetail` API. Recovery uses only existing `window.qa` connection and event actions. These fixtures do not duplicate the chat UI and do not claim to emulate Pi session files.

## Android manual checklist

Use a physical Android device connected to a candidate origin and a dedicated, non-production Pi session.

- [ ] Open installed standalone PWA; record device/model, Android version, browser/WebView version, build SHA, origin, time, and tester.
- [ ] Open a long real Pi conversation containing user/assistant/thinking/tool entries. Expand one successful tool detail, one failed tool detail, and one successful tool with empty output. Record whether input/output/error semantics remain distinguishable and capture redacted evidence.
- [ ] Scroll near the top, allow a new real update, and verify content does not jump. Record scroll anchor, unread indicator, and result after activating “new reply.”
- [ ] Focus multiline compose, enter Latin and CJK text with the device IME, move selection, insert/delete around composition, and dismiss/reopen the keyboard. Record keyboard app/mode, retained text, selection, and whether send happened unexpectedly.
- [ ] With keyboard open, check portrait narrow layout, bottom inset, compose/send visibility, and absence of horizontal overflow. Rotate once if supported; record safe-area/viewport measurements and any occlusion.
- [ ] Background the standalone PWA during an active read, return after at least 15 seconds, and verify recovery refreshes without duplicate prompt/tool rows or automatic mutation replay. Record connection transitions and call/runtime evidence.
- [ ] Disable and restore network once. Verify reconnect feedback, preserved draft, stable transcript ownership, and no duplicated send. Record timing and final state.
- [ ] Use Android system Back from an open tool detail, from the conversation, and with the IME open. Record which surface closes/navigates and confirm no PTY key or prompt is sent.
- [ ] Continue through a long chat (at least 100 rendered entries); record scroll stability, input responsiveness, memory/crash observation, and whether older-history loading preserves position.

## iOS manual checklist

Use a physical iPhone/iPad added to Home Screen, connected to a candidate origin and a dedicated, non-production Pi session.

- [ ] Record device/model, iOS version, Safari version, display mode (`standalone`), build SHA, origin, time, and tester.
- [ ] Repeat the real Pi tool-detail checks above, including failed and empty successful results; attach redacted evidence.
- [ ] Verify near-top unread behavior and return-to-latest without an involuntary jump.
- [ ] Exercise multiline Latin/CJK composition, selection handles, autocorrect, keyboard dismiss/reopen, and send. Confirm draft persistence and no accidental send.
- [ ] Check portrait safe-area top/bottom insets with keyboard open and closed; rotate if supported. Record occlusion, horizontal overflow, and touch-target issues.
- [ ] Background the standalone app, lock/unlock once, then foreground. Confirm transcript recovery, preserved draft/scroll intent, and no duplicate mutation.
- [ ] Toggle connectivity and return via iOS app switcher. Record reconnect state and real Pi refresh evidence.
- [ ] Exercise the app's back/navigation controls and swipe-back where available; verify tool detail closes before leaving the conversation and no prompt/key is sent.
- [ ] Continue through at least 100 real entries and load older history. Record anchor stability, input latency observation, crash/reload, and final transcript continuity.

## Evidence record

For every physical run, store: pass/fail per item; exact reproduction steps; expected and actual result; device/OS/browser/display mode; viewport and orientation; build/commit; origin and runtime identity (redacted); timestamps; network transition; relevant `window.qa` snapshot only when testing a fixture; real session call/log excerpts with secrets and prompt content redacted; screenshot or screen recording when permission permits; issue link and severity. Mark unavailable evidence as unavailable—never infer a physical-device pass from desktop responsive emulation.

Current status: no Android device was available through ADB when this checklist was authored. No Android or iOS physical-device acceptance is claimed.
