---
title: FAQ
description: Answers for Pairfob's direct Tailscale connection.
---

# FAQ

## Do I need a Pairfob account?

No. The computer hosts Pairfob, and the phone receives a device credential after you approve pairing. Pairfob does not enroll the computer with a hosted relay.

## Do I need Tailscale?

Yes. Join the computer and phone to the same tailnet. Its ACL must allow the phone to reach the computer's Tailscale IPv4 address on TCP port 18474. Pairfob does not open a public router port.

## Can Pairfob run agents by itself?

No. [Herdr](https://herdr.dev) runs the agents on your computer. Pairfob presents those live sessions on another device.

## Is this remote desktop?

No. Pairfob reads Herdr's rendered pane and sends keys to its PTY. It does not mirror the whole desktop.

## Is the phone session a copy?

No. It is the computer's live session. There is no sync step when you return to the computer.

## What if the computer sleeps or the network drops?

Wake the computer or restore Tailscale. Reopen the computer's Tailscale address; a paired browser reconnects with its saved credential. Pairfob cannot wake a sleeping computer.

## Why does the phone browser say Not Secure?

The page uses HTTP on a Tailscale IP. Tailscale encrypts traffic between devices, while Pairfob encrypts established session content end to end. HTTP is still not a browser secure context, so the web camera, push, service workers, and PWA installation may be unavailable. Use the phone's system camera for QR pairing. See [Security](/security).

## Can another tailnet member read my sessions?

Someone permitted by your Tailscale ACL may load the Pairfob page, but session access still requires a paired device credential. Restrict tailnet access and revoke lost devices with `pairfob forget N`.

## Why is a short pairing code rejected?

The complete QR or link also contains the computer address and a one-use ticket. Paste the entire link if you cannot scan. An eight-glyph code alone cannot attach to the direct gateway.

## I lost the phone or cleared browser data.

Run `pairfob list` and `pairfob forget N` on the computer to revoke a lost device. Cleared browser data requires a fresh `pairfob pair`. A row marked `never seen` paired but has never completed a session handshake.

## Can one phone manage several computers?

Yes. Install Pairfob on each computer, then use **Settings → Add another computer** on the phone. Each computer has its own pairing and Tailscale address.

## Where are push and file uploads?

The current direct HTTP page does not offer browser push. The existing attachment upload flow requires the legacy P2P transport and is unavailable in this direct deployment. Reading sessions, sending keys, and viewing workspace changes remain available. See [Using the app](/app).

## Does it cost money?

Pairfob is free, Apache-2.0 source at <https://github.com/arronKler/pairfob>. Tailscale and any agents you use have their own terms.

## How do I report a problem?

Use [GitHub Issues](https://github.com/arronKler/pairfob/issues/new) for bugs and feedback. Report security issues privately through [GitHub Security Advisories](https://github.com/arronKler/pairfob/security/advisories/new). Do not paste pairing links, device credentials, or private terminal content into an issue. Include the output of `pairfob doctor` after removing personal paths and addresses.
