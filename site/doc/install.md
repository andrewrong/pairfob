---
title: Install
description: Install the verified Pairfob binary and a user service for Tailscale direct access.
---

# Install

Pairfob runs on macOS or Linux with [Herdr](https://herdr.dev) and Tailscale. Join the computer to a tailnet before installing. The phone must join the same tailnet and be allowed to reach the computer on TCP port 18474.

```sh
curl -fsSL https://pairfob.com/install.sh | sh
pairfob doctor
```

The installer downloads the Pairfob binary from `https://pairfob.com/dl`, checks its SHA-256 checksum, checks Herdr, and installs a user-level service. It does not enroll with a hosted relay. The website serves the installer and binaries; it is not the active phone-to-computer transport.

## Herdr

The installer reuses a ready Herdr server or starts an installed one when allowed. If Herdr is missing, it can offer to install a pinned version. For unattended installation:

```sh
curl -fsSL https://pairfob.com/install.sh | sh -s -- --install-herdr --non-interactive
```

If the Herdr executable is outside the service's normal PATH, set `HERDR_BIN` to its absolute path before installing the service. `pairfob setup` checks Herdr and can install it with `--install-herdr`. `pairfob doctor` only diagnoses.

## Installer options

| Flag | Effect |
| --- | --- |
| `--prefix DIR` | Install the binary in DIR; default is a writable `/usr/local/bin` or `~/.local/bin` |
| `--no-service` | Install the binary without a user service |
| `--install-herdr` | Install pinned Herdr if missing |
| `--non-interactive` | Never prompt |
| `--skip-herdr-check` | Prepare Pairfob without claiming Herdr readiness |

The installer also keeps the `pairfobd` compatibility command. Existing pairings live in the state directory and survive a reinstall.

## Service and local files

On macOS the user service is a launchd agent; on Linux it is a systemd user unit. It starts after login, while the computer is awake. The default state, local admin socket, and logs live in `~/.config/pairfob/`. The service binds only the computer's Tailscale IPv4 address and port 18474. It does not expose Herdr's socket.

```sh
pairfob service status
pairfob service restart
pairfob doctor
```

The service configuration and log are owner-readable. Keep state files, pairing links, and local deployment `.env` files out of commits. A custom service directory may contain a build script and binary; it is not the active state directory unless `PAIRFOB_STATE_DIR` says so.

## Update or uninstall

`pairfob update` is the CLI update command for an installed release. A source-built `dev` binary is updated by rebuilding and restarting its user service. The phone's release check may be unavailable on a direct host.

```sh
pairfob service uninstall
```

Uninstalling the service keeps pairings. Remove `~/.config/pairfob/` only when you intend to discard that identity and every paired-device credential. Source and build instructions are in the [repository](https://github.com/arronKler/pairfob).
