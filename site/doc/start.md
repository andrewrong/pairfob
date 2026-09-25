---
title: Get started
description: Install Herdr and Pairfob, join one Tailscale network, then pair your phone.
---

# Get started

Pairfob runs on a macOS or Linux computer alongside Herdr. The phone connects to that computer's Tailscale IPv4 address on port 18474. Install Tailscale on both devices and allow that connection in your tailnet policy.

## 1. Prepare the computer

Install [Herdr](https://herdr.dev) 0.7 or newer and join the computer to Tailscale. Pairfob uses Herdr's local socket; the agents and their sessions stay on the computer.

## 2. Install Pairfob

```sh
curl -fsSL https://pairfob.com/install.sh | sh
pairfob doctor
```

The installer verifies the binary and installs a user-level login service. It does not enroll with a hosted relay. `doctor` should report **Running yes**, **Herdr ready**, and the computer's Tailscale address. The computer must be awake and logged in for its user service to run. See [Install](/install) for paths and service management.

## 3. Pair the phone

Join the phone to the same tailnet. On the computer run:

```sh
pairfob pair
```

Scan the QR with the phone's **system camera**, or paste the **complete pairing link** printed below it into Pairfob's pairing screen. The short eight-glyph code alone cannot attach: the link contains a one-use invitation ticket. Confirm the pairing on the computer when prompted. Treat the link as sensitive until it expires. See [Pairing](/pair).

## 4. Resume a session

Open the computer's Tailscale address shown by `pairfob doctor` in the phone browser. A paired browser reconnects with its saved credential after a restart. Herdr's live sessions appear in the list. Pairfob reads the rendered pane and sends keys back to the computer's PTY.

A Tailscale IP page uses HTTP and may display **Not Secure**. Tailscale encrypts traffic between the devices, and Pairfob encrypts established session content end to end. Browser features requiring HTTPS, such as in-page camera scanning, push, and PWA installation, may be unavailable. The phone's system camera can still open the QR link. See [Security](/security).

## Check and manage

```sh
pairfob list          # paired devices and last successful use
pairfob forget 1      # revoke one device by its current list number
pairfob service status
```

If a device shows `never seen`, it paired but has never established a session. Check the list after each revocation because the numbers change. For another computer, install Pairfob there and use **Settings → Add another computer** on the phone. See [Multiple devices](/devices) and [Troubleshooting](/troubleshoot).
