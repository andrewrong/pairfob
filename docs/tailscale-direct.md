# Tailscale direct deployment

Pairfob serves its PWA and WebSocket endpoint from the computer's Tailscale
IPv4 address on port `18474`. The phone and computer must be in the same
tailnet and permitted to connect by its ACLs. Herdr stays on the computer's
local Unix socket. No Pairfob relay or Tailscale Serve configuration is used.

## Install and use

Install Tailscale and Herdr on the computer, and Tailscale on the phone. Build
and install the current direct version using the commands in the repository
README, then run `pairfob doctor` with that same binary.
The doctor must report `Running yes`, `Herdr ready`, and a Tailscale address.
If Herdr lives outside the service's `PATH`, set `HERDR_BIN` to its absolute
executable path before `pairfob service install`.

Run `pairfob pair` on the computer. Scan the QR with the phone's system camera
or paste the **complete pairing link** into the Pairfob page. Confirm the
matching words and admit the phone at the computer. The short code alone does
not contain the one-use invitation ticket. Existing paired devices reconnect
with their stored keys after a restart or upgrade.

Use `pairfob list` to see paired devices and their last successful session.
`never seen` means a device paired but has not established a session. Run
`pairfob forget N` to revoke a device; check the list again because the
numbers change after revocation.

## Service and local data

`pairfob service install` creates a **user-level** launchd agent on macOS or
systemd user unit on Linux. It points to the executable from which the command
was run. By default `~/.config/pairfob/` holds the daemon identity, device
credentials, operation records, admin socket, `pairfob.log`, `audit.log`, and
`pairfob-startup.log`. The startup log remains in the state directory so an
invalid external log path does not hide service startup errors.
Set the absolute `PAIRFOB_LOG_DIR` before `pairfob service install` to put both
logs in a separate private directory. The state and paired-device keys remain
in the state directory. Keep both directories private.

Restart with `pairfob service restart` and inspect `pairfob doctor` and the
configured `pairfob.log`. The listener should bind the Tailscale IPv4
address only, never `0.0.0.0`. A local health check is
`curl http://<tailscale-ip>:18474/v2/health`.

## Privacy and browser limits

Tailscale encrypts traffic between tailnet devices. Pairfob separately
authenticates pairing and encrypts established session contents end to end;
the gateway routes opaque `FWD` frames. Tailnet members allowed by ACL can
load the login page and reach the WebSocket, but they cannot read a session
without a paired device credential. Restrict access with Tailscale ACLs and
revoke lost phones with `pairfob forget`.

The browser URL uses **HTTP**, so it may display “Not Secure.” Tailscale's
transport encryption does not turn that origin into a browser secure context.
Browser features requiring HTTPS, including in-page camera scanning, service
workers, push notifications, and PWA installation, may be unavailable on a
Tailscale IP. Attachment uploads currently require the old P2P transport and
are disabled in this direct deployment. Use the phone's system camera or paste
the complete link for pairing. The one-use
ticket is in the URL fragment, which is not sent in an HTTP request; treat the
link as sensitive until pairing completes. Pairfob logs network peer addresses
and request paths locally, but does not log that fragment.

Keep local `.env`, state, logs, launchd/systemd unit files, pairing links, and
binary paths out of commits. Source tests use example tailnet addresses.
