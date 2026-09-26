---
title: Environment
description: Direct Tailscale listener, local state, and Herdr configuration.
---

# Environment

Pairfob discovers the computer's Tailscale IPv4 address and listens on port 18474. A user service keeps only the runtime environment it needs; it does not inherit every variable from your interactive shell.

| Variable | Use |
| --- | --- |
| `PAIRFOB_ORIGIN` | Optional advertised `http://<tailscale-ip>:18474` origin; must match the listener |
| `PAIRFOB_LISTEN_ADDR` | Optional `<tailscale-ip>:18474` bind address; never use a wildcard or LAN address |
| `PAIRFOB_STATE_DIR` | State, paired-device credentials, and admin socket; logs also live here unless `PAIRFOB_LOG_DIR` is set; default `~/.config/pairfob` |
| `PAIRFOB_LOG_DIR` | Optional absolute directory for `pairfob.log` and `audit.log`; defaults to the state directory |
| `PAIRFOB_ALLOWED_ROOTS` | Additional allowed workspace roots; paths outside a live snapshot root or allowed roots fail closed |
| `HERDR_BIN` | Absolute Herdr executable path when it is outside the service PATH |
| `HERDR_SOCKET_PATH` | Local Herdr socket path when using a nondefault socket |
| `PAIRFOB_DOWNLOAD_BASE` | Optional release download root for installation and updates |
| `PAIRFOB_INSTALL_PREFIX` | Binary directory used by `install.sh` |

Set required values before `pairfob service install`, then restart the service. Keep local state and service configuration private. `PAIRFOB_JOIN_TOKEN` is not used; it must not be set.

The direct HTTP origin is not a browser secure context. Push notification configuration cannot enable push in this deployment. See [Security](/security) and [Notifications](/push).
