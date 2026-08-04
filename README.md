# Weiff

Weiff is a local web app for working with Jujutsu (`jj`) repositories.

It gives the daily `jj` workflows a visual place to live: graph browsing, diffs, bookmarks, workspaces, and operation history. The `jj` CLI still remains the source of truth; Weiff is a browser-based companion for the tasks that are easier to inspect visually.

## Capabilities

- Browse revisions in a commit graph and inspect inline or split diffs.
- Explore repository files at the working copy or any visible revision, with line numbers and syntax highlighting.
- View change details, bookmarks, conflicts, and evolution history, with older history loaded on demand.
- Restore selected files or individual diff sections from a change.
- Create, update, delete, and push bookmarks.
- Create, open, and forget workspaces.
- Browse the operation log, restore an operation, or undo the latest one.
- Switch between remembered repositories and filter revisions with revsets.
- Remember theme and diff-view preferences in a dedicated settings page.

## Quick Start

```sh
npm ci --prefix web
npm run build
./dist/weiff
```

Open [http://127.0.0.1:7000](http://127.0.0.1:7000).

You need `jj`, Go 1.26.5, Node.js 24, and npm 11 to build from source.

## Docs

- [Using Weiff](docs/usage.md)
- [Development](docs/development.md)

## Security

Weiff is designed for single-user, local use and has no login screen. Anyone who can reach the server can use it with the permissions of the operating-system user running it, including access to repositories and local files reachable by `jj`.

Keep it bound to a loopback address such as `127.0.0.1`. Do not expose it directly to a public or shared network unless it is protected by authentication, HTTPS, and network-level access controls.
