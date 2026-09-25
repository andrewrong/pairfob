---
title: Computer commands
description: Pair, inspect, revoke, and manage the direct Tailscale service.
---

# Computer commands

Pairfob runs as a user service after login. Running `pairfob` with no subcommand prints local status or starts it in the current terminal when needed.

| Command | Use |
| --- | --- |
| `pairfob pair` | Create a one-use QR and complete pairing link; wait for computer approval |
| `pairfob list` | Show paired devices and their last successful use |
| `pairfob forget N` | Revoke the device at the current list number |
| `pairfob doctor` | Read-only local health check |
| `pairfob setup` | Check or start Herdr; optionally install it |
| `pairfob service status` | Inspect the user service |
| `pairfob service restart` | Restart after configuration changes |
| `pairfob update` | Update an installed release binary |

`forget` also accepts an unambiguous device name. Its list numbers change after a revocation. `never seen` means a device paired but has never completed a session handshake.

## Doctor

A healthy direct installation reports `Running yes`, `Herdr ready`, and the computer's Tailscale IPv4 address with port 18474. It also reports the installed and running Pairfob versions and the number of paired devices. It exits nonzero if the service, Herdr, or Tailscale listener is not ready.

If Herdr lives outside the service PATH, set `HERDR_BIN` to its absolute executable path before `pairfob service install`. An interactive `doctor` needs the same setting to find that executable. It does not change the service.

## Service and updates

```sh
pairfob service install
pairfob service status
pairfob service restart
pairfob service stop
pairfob service start
pairfob service uninstall
```

The user service points to the binary used during installation. Its state and log default to `~/.config/pairfob/`. A source-built `dev` binary is updated by rebuilding it and restarting the service. Release binaries can use `pairfob update`; pairings survive. The direct HTTP page may not be able to check `/dl/VERSION` or offer a phone-initiated update.

Advanced commands `pairfob pair new`, `pairfob pair accept` / `deny`, and `pairfob device revoke <id>` remain available for local automation. See [Environment](/env) and [Troubleshooting](/troubleshoot).
