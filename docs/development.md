# Weiff Development

## Requirements

- `jj` available on `PATH`
- Go 1.26.6
- Node.js 24
- npm 11
- `gofumpt` for Go formatting checks

## Run locally

Install frontend dependencies once:

```sh
npm ci --prefix web
```

Run the backend and frontend in separate terminals:

```sh
npm run backend:dev
npm run frontend:dev
```

The backend listens on `127.0.0.1:7000` by default. The Angular development server uses `web/proxy.conf.json` to proxy `/api/` to the backend.

The listen address and configuration directory can be set with flags or environment variables:

```sh
WEIFF_ADDR=127.0.0.1:8080 WEIFF_CONFIG_DIR=/path/to/config npm run backend:dev
go run ./cmd/weiff -addr 127.0.0.1:8080 -config-dir /path/to/config
```

## Build

```sh
npm run build
./dist/weiff
```

The production binary embeds the built Angular app. Angular writes to `internal/webui/dist/browser`, and Go embeds that directory with the `embed_frontend` build tag.

Fonts and Material Symbols are bundled locally, so production builds and the running UI do not depend on Google Fonts.

## Validate

```sh
npm run format:check
npm run vet
npm test
npm run test:embedded
npm run race
npm run build
```

## Release

Run `.github/workflows/release.yml` manually from the `main` branch and enter the semantic version
without a `v` prefix, for example `0.2.0`. The workflow verifies and builds that exact commit, creates
the required `v0.2.0` Git tag, and publishes:

- `weiff-linux-amd64`
- `weiff-linux-arm64`
- `weiff-darwin-amd64`
- `weiff-darwin-arm64`
- `weiff-windows-amd64.exe`
- `weiff-windows-arm64.exe`

The release directory also contains `checksums.txt`.
