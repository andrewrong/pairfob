---
title: Notifications
description: Push notifications are unavailable from the direct HTTP Tailscale page.
---

# Notifications

The current direct deployment serves Pairfob over HTTP on the computer's Tailscale IP. Browser push requires a secure context and a service worker, so **push notifications are unavailable** from this page. Enabling `PAIRFOB_PUSH` on the computer cannot override the browser requirement.

Open Pairfob to see live session status. The list highlights **Needs you** sessions. Your phone can also use its system camera to scan a fresh pairing QR even when the in-page camera is unavailable.

See [Security](/security) for the HTTP browser limit and [Get started](/start) for the direct connection.
