# @intent-hq/web

Intent in the browser, without the desktop app. `intent-web` is a small web
server for a cloud machine (a VPS or a dev box). Open it from any browser,
sign in with an access key, and work against the Intent machines (`intentd`)
you already run, here or elsewhere.

```sh
npx @intent-hq/web
```

Requires Node.js `^22.22.2 || ^24.15.0 || >=26`.

## Getting started

1. Run `npx @intent-hq/web`. It prints the address it listens on
   (`http://127.0.0.1:47120` by default), its data directory and, on the first
   run, the access key. Later runs keep the key; `intent-web key` shows it.
2. Put an HTTPS front-end in front of it, for example
   `tailscale serve --bg 47120`, or Caddy or nginx with a real certificate.
3. Open the front-end's address, enter the access key, then add your machines
   in **Settings → Machines** (host, port, token, pinned certificate and an
   optional tunnel address). If this machine runs `intentd`, it appears as
   **This machine (local)**.

To sign in another browser without typing the key, scan the QR code on its
sign-in page with your phone, check that the match codes are the same, and enter
the key on your phone. `intent-web link --url <https address>` prints a
one-time sign-in link and QR code instead.

The [full guide](https://github.com/intent-hq/cloudlands-fe/blob/main/docs/intent-web.md)
covers `tailscale serve`, running it as a service, local daemon mode and
troubleshooting.

## Commands and options

| Command / flag                                       | Purpose                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `intent-web` / `intent-web serve`                    | Start the server                                                                                                                                 |
| `--port <n>` / `--socket <path>`                     | Listen on loopback TCP (default 47120), or on a 0600 unix socket                                                                                 |
| `--data-dir <dir>`                                   | Where config and saved machines live. Default `$XDG_STATE_HOME/intent-web` (`~/.local/state/intent-web`; `%LOCALAPPDATA%\intent-web` on Windows) |
| `--tailcat <path>`                                   | tailcat binary for tunnel routes                                                                                                                 |
| `--local-socket <path>` / `--no-local`               | Use this local `intentd` socket, or ignore the local daemon                                                                                      |
| `intent-web key [--reset]`                           | Show the access key, or replace it (signs out every browser)                                                                                     |
| `intent-web link [--url <origin>] [--ttl <minutes>]` | Print a one-time sign-in link and QR code (default 5 minutes, maximum 15)                                                                        |

Environment: `INTENT_WEB_PORT`, `INTENT_WEB_DATA_DIR` and `TAILCAT_BIN` work like
the flags; flags win.

## Security

- The server listens only on loopback or a unix socket. **Never expose its port
  directly**; use an HTTPS front-end.
- One access key means one owner. There are no accounts or per-user permissions:
  anyone with the key has full control of every saved machine, and can make the
  server connect to any host and port.
- Machine tokens are stored in plain text in `connections.json` (mode 0600) in
  the data directory (mode 0700). Browsers never receive them.

## Tunnel routes (tailcat)

Tunnel addresses need the [tailcat](https://github.com/tailscale/tailcat)
client (BSD-3-Clause), version 0.4.0, from its GitHub releases. Point
`--tailcat` or `TAILCAT_BIN` at it, or put it on `PATH`. Without it, direct host
and port routes still work.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
