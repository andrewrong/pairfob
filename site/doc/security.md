---
title: Security and privacy
description: Understand Tailscale transport, Pairfob session encryption, local credentials, and HTTP browser limits.
---

# Security and privacy

Pairfob serves the phone interface from the computer's Tailscale IPv4 address on port 18474. The active connection does not pass through a Pairfob relay. Herdr stays on the computer's local socket.

## What each layer protects

Tailscale authenticates tailnet peers and encrypts traffic between them. Pairfob uses a one-use pairing invitation, the pairing code, and computer approval before storing a device credential. Established sessions encrypt their contents end to end between the paired device and the computer. The gateway routes opaque frames; it does not inspect session content.

A tailnet member permitted by your ACL can load the Pairfob page and contact its WebSocket. That alone does not grant access to a session. Limit tailnet access to trusted devices, and revoke a lost phone with `pairfob forget N`.

## Browser and client trust

The page is served over **HTTP** at a Tailscale IP. The browser may show **Not Secure**, and APIs requiring an HTTPS secure context, including in-page camera access, service workers, PWA installation, and push notifications, may be unavailable. Tailscale transport encryption does not change the browser's secure-context rules. Use the phone's system camera to scan the QR or paste the complete pairing link.

The browser executes code served by the computer. Someone who compromises that computer, its Pairfob binary, or the browser can read keys or plaintext at that endpoint. End-to-end encryption cannot protect a compromised endpoint. A saved Home Screen shortcut, when available, does not pin a trusted code version.

## Where private data lives

The computer's identity and paired-device credentials default to `~/.config/pairfob/`. Browser credentials stay in that device's browser profile. The pairing link contains a one-use ticket in its URL fragment; browsers do not send fragments in HTTP requests, but you should not share the link while it is valid. Pairfob logs peer addresses and request paths locally, without that fragment. Keep the state directory, service configuration, and logs private.

If a device is lost, revoke it from the computer with `pairfob list` and `pairfob forget N`. If the computer may be compromised, stop the service, clean it, and re-pair trusted devices. Report security issues privately through the repository's [security policy](https://github.com/arronKler/pairfob/blob/main/SECURITY.md).
