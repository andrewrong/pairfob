---
title: Pairing
description: Use the one-use QR or complete pairing link, then approve on the computer.
---

# Pairing

Pairing authorizes one browser on one device. Pairfob has no account login. The browser stores a device credential only after the computer approves pairing.

## On the computer

```sh
pairfob pair
```

The terminal prints a QR code and a **complete pairing link**. Both expire, and the invitation ticket is usable once. Leave the command running until the phone reaches the approval step. Only the current offer can be used.

## On the phone

The phone must be connected to the same Tailscale network. Scan the QR using the phone's **system camera**; it opens the Pairfob page served by the computer. If you cannot scan, open Pairfob at the computer's Tailscale address and paste the complete link into the pairing form.

The browser's in-page camera may be unavailable because the direct page uses HTTP. The eight-glyph short code alone is incomplete: the complete link also carries the computer address and a one-use ticket.

The ticket is in the link's URL fragment, which is not sent in an HTTP request. Treat the whole link as sensitive until it expires; do not post it in chat or a screenshot.

## Approve on the computer

Once the phone proves the pairing code, the computer asks for confirmation. Press Enter only if this is your device. Ctrl-C or expiry denies the attempt. Pairing is not complete before this approval.

## Later use

Open the computer's Tailscale address again in the same browser profile. Its saved credential reconnects without another QR. Another browser profile, cleared site data, or a new phone needs a fresh pairing. Use **Settings → Add another computer** to pair a second computer, or `pairfob list` and `pairfob forget N` to manage devices.

If pairing fails, create a fresh offer with `pairfob pair`; spent and expired links cannot be retried. See [Troubleshooting](/troubleshoot).
