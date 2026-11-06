# Security

## Threat model

Obsidian Live Wallpaper runs entirely on your machine. The Node process:

- binds its HTTP server to the loopback interface only (`127.0.0.1`), so it is
  not reachable from other devices on your network;
- reads Markdown from the vault path you configure and writes only
  `config.json`, `graph.json` (a cold-start/debug copy, saved at startup and
  shutdown), `layout.json` (cached node positions) and `custom-presets.json`,
  all in the directory that holds the config file (the current working
  directory when run with `npx`);
- serves a fixed allowlist of static files plus a small JSON/SSE API, and
  validates every config write against a strict schema before persisting it;
- emits only node ids, labels, tags, link structure, and modified-times in
  `graph.json` — never note contents.

There is no telemetry and no outbound network access; after `npm install` the
renderer works offline (D3 is vendored locally).

## Reporting a vulnerability

If you find a security issue, please report it privately rather than opening a
public issue, using GitHub's **Report a vulnerability** (Security → Advisories)
on the repository.

Please include reproduction steps and the affected version. You can expect an
acknowledgement within a few days.

## Supported versions

The latest released version receives fixes. Older versions are not maintained.
