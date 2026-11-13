# Klei download site

Small read-only Spring Boot + Thymeleaf site (story 18.5). Lists each Electron version with per-OS downloads and serves `latest.json` for the app's Update button. Separate from `backend/`; shares no code, port or secret with it.

Every URL starts with a secret token: `/<token>/`. Anything else is an empty `404`. A secret path is obscurity, not access control: anyone with the URL can download.

## Configure

Copy `.env.example` to `.env` (or enter the values in Dokploy). Never commit `.env`.

| Variable | Meaning |
|---|---|
| `KLEI_DOWNLOAD_PORT` | Listen port, default `8090`. |
| `KLEI_DOWNLOAD_PATH_TOKEN` | The secret path. 43+ chars from `[A-Za-z0-9_-]`. Or `KLEI_DOWNLOAD_PATH_TOKEN_FILE`. |
| `KLEI_DOWNLOAD_DATA_DIR` | Folder of `<version>/release.json` plus its files. Default `/data`. |

Generate a token (do not paste it into chat or commit it):

    openssl rand -base64 32 | tr '+/' '-_' | tr -d '='

## Data folder

    <data>/0.2.0/release.json
    <data>/0.2.0/klei-0.2.0-mac-arm64.dmg

`release.json`: `{"version","pubDate","channel":"preview","files":[{"name","os","arch","kind","size","sha256"}]}` with `os` in `macos|windows|linux`, `arch` in `arm64|x64`.

A version is listed only if its manifest is valid and every named file exists at the stated size. A folder starting with `.` is ignored (upload in progress). To withdraw a version, delete its folder. No restart needed.

## Run locally

    export JAVA_HOME=$(/usr/libexec/java_home -v 25)
    ./mvnw test
    ./mvnw -DskipTests package
    KLEI_DOWNLOAD_PATH_TOKEN_FILE=~/.klei/download-token KLEI_DOWNLOAD_DATA_DIR=/path/to/data java -jar target/download-site.jar
    open "http://127.0.0.1:8090/$(cat ~/.klei/download-token)/"

## Docker / Dokploy

`docker compose up --build` reads `.env` and mounts `./data` read-only. In Dokploy, build from this folder's `Dockerfile`, set the three variables, mount a volume at `/data`, and publish container port `8090` through the HTTPS proxy.

## Rotate the token

Set a new token and redeploy. The URL is compiled into every installed app, so each app must be reinstalled. Keep the proxy's access log off or redacted: the path is the secret.

## Not included

No in-app rate limit (do it at the proxy), no re-hash of files on read (the publisher computes SHA-256), no container health check (the image has no curl; use the platform's TCP check).
