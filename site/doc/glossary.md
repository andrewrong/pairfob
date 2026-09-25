---
title: Glossary
description: Terms used by Pairfob's direct Tailscale deployment.
---

# Glossary

| Term | Meaning |
| --- | --- |
| Herdr | Local program running coding agents on the computer; Pairfob connects to its local socket |
| pane | One live terminal surface in a Herdr session |
| Control | Rendered pane, keypad, and system keyboard on the phone |
| Terminal | Full terminal view for vim and other TUIs when supported |
| Chat | Agent messages and a readable transcript |
| Auto | Selects a suitable pane mode from current capabilities |
| tailnet | The private Tailscale network shared by the phone and computer |
| Pairfob gateway | PWA and WebSocket listener on the computer's Tailscale IPv4 address, port 18474 |
| pairing link | One-use URL with the computer address and a fragment containing the code and invitation ticket |
| computer confirm | Enter on the computer admits the device after it proves the pairing code |
| device credential | Stored after pairing; lets that browser resume without another QR |
| PWA | Browser page served by the computer; HTTP can limit installation and secure-context features |
| `PAIRFOB_STATE_DIR` | Local state and paired devices; default `~/.config/pairfob` |
| worktree | Git worktree managed by Herdr on the computer |
| subscription quota | Allowance for accounts signed in on this computer, shown in Settings |
