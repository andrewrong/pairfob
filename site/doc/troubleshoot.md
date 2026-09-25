---
title: Troubleshooting
description: Diagnose the direct Tailscale listener, Herdr, pairing, and browser connection.
---

# Troubleshooting

Start on the computer:

```sh
pairfob doctor
pairfob service status
pairfob list
```

`doctor` should show **Running yes**, **Herdr ready**, and the computer's Tailscale IPv4 address with port 18474.

## Phone cannot open the page

Check Tailscale on both devices, the tailnet ACL, and whether the computer is awake. Open `http://<computer-tailscale-ip>:18474` on the phone. On the computer, `curl http://<computer-tailscale-ip>:18474/v2/health` should return `{"ok":true,"protocol":2}`. Pairfob binds the Tailscale IP, not `127.0.0.1` or `0.0.0.0`.

A locked screen can work while the computer remains awake. Sleep or logout stops a user service until the computer returns; Pairfob cannot wake it.

## Page opens but cannot pair

Use the phone's system camera to scan the current QR, or paste the **complete link** printed by `pairfob pair`. The in-page camera may be unavailable on HTTP. The eight-glyph code alone lacks the one-use ticket. Keep the computer's pairing command open, confirm there after the phone proves the code, and create a new offer after expiry or a failed attempt.

## Paired but cannot connect

Check `pairfob list`. `never seen` means the device paired but has never completed a session handshake. Reload the computer's own Tailscale address in the same browser profile; another profile has no saved credential. Try `pairfob doctor` and inspect `~/.config/pairfob/pairfob.log` locally. The direct deployment does not fall back to a hosted relay.

If Herdr is unavailable, start it on the computer. If the CLI is outside the service PATH, set `HERDR_BIN` before reinstalling the service and when running `doctor`. Unsupported actions depend on the running Herdr version.

## A mutation may have happened

Do not repeat a timed-out operation. Refresh the view and check the computer before deciding what to do next. Pairfob does not automatically replay mutations with an unknown outcome.

## Browser feature is unavailable

HTTP on a Tailscale IP is not an HTTPS secure context. Browser camera, push, service worker, and PWA installation can be unavailable. Use the system camera to open a pairing QR. Attachment uploads currently require the old P2P transport and are disabled on this direct host.

For support, keep `doctor` output and the relevant local log timestamps. Remove personal paths, addresses, and pairing links before sharing them.
