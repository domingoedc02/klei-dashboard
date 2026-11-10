# Version and technology review (2026-11-08)

Method: live primary sources only. Maven Central `maven-metadata.xml` and POMs, crates.io API, npm registry, `docker manifest inspect`, endoflife.date, GitHub API, Spring Boot 4.1.2 BOM POM, Hibernate 7.4.13 jar listing, Tauri docs.

## Verdict

Stack table is accurate. No nonexistent artifact or tag. All Spine pins resolve. Backend pins equal the Spring Boot 4.1.2 BOM (Boot-managed), so they are "current for Boot", not "newest on Central". One real conflict (TypeScript 7 vs openapi-typescript), a few risks and wording items.

## Findings

### F1 (MEDIUM, real defect): TypeScript 7.0.2 vs openapi-typescript 7.13.0
`openapi-typescript@7.13.0` (npm latest) declares peer `typescript: ^5.x`. Spine pins TypeScript 7.0.2. `npm install` fails with ERESOLVE unless `--legacy-peer-deps` or `overrides`. Fix: pin TypeScript 5.x (latest 5.x line) until openapi-typescript widens its peer range, or record the override and test that generation works on TS 7. Also check typescript-eslint and other tooling peers at the same time (not checked here).

### F2 (LOW, wording): "latest" claims
Boot-managed pins are behind Central but correct for Boot 4.1.2:

| Item | Spine | BOM 4.1.2 | Newest stable on Central |
|---|---|---|---|
| Hibernate ORM | 7.4.13.Final | 7.4.13.Final | 7.4.15.Final |
| Flyway | 12.4.0 | 12.4.0 | 13.12.1 |
| Kotlin | 2.3.21 | 2.3.21 | 2.4.21 (2.5.0-Beta2 pre) |
| JUnit | 6.0.3 | 6.0.3 | 6.1.3 |
| Testcontainers | 2.0.5 | 2.0.5 | 2.0.5 |

Do not override BOM versions without reason. State in the Spine that these follow the Boot BOM so a reader does not "fix" them. Do not upgrade Flyway to 13 independently (Boot 4.1 autoconfig is built against 12).

### F3 (LOW, risk): Hibernate listener design (ADR-3, OQ-4)
`PreInsertEventListener`, `PreUpdateEventListener`, `PreLoadEventListener`, `PostLoadEventListener` all exist in `org.hibernate.event.spi` in 7.4.13. Design is feasible. Known traps for story 1.3:
- Pre-insert/update listener must change both the entity and `event.getState()`, or the encrypted value is not persisted.
- Decrypting in `PostLoad` on the entity while the loaded snapshot holds ciphertext makes every loaded entity dirty (spurious UPDATE, re-encryption with new nonce). Use a transient plaintext field, or decrypt in `PreLoad` into the hydrated state array, and test "load then flush issues no UPDATE".
- Boot does not auto-register listeners; register through `EventListenerRegistry` (Integrator or `SessionFactory` customizer). `@Encrypted` fields in JPQL/Criteria predicates cannot be queried (design already uses blind index).
Not verified at runtime.

### F4 (LOW): Tauri deep link on Linux/Windows
Plugin README says deep-link events fire only on macOS/iOS/Android. On Windows and Linux the OS spawns a new instance with the URL as an argument, so `single-instance` with its `deep-link` feature is required (the Spine already pairs them). Linux is marked supported, but for AppImage the scheme must be registered at runtime (`register_all`), because registration uses the absolute executable path. Spike S-2 correctly covers this. Add "runtime `register`" to the spike text.

### F5 (INFO): OQ-1 object store claim confirmed
`minio/minio` GitHub repo `archived: true` (last push 2026-04-24). `minio/minio:latest` and `quay.io/minio/minio:latest` manifests do not resolve. Candidates with pullable images today: `chrislusf/seaweedfs`, `rustfs/rustfs` (latest release 1.0.4). `garagehq/garage:v2.1.0` did not resolve (tag guess, not a negative proof). Needs a decision, then pin an exact tag.

### F6 (INFO): Node
Spine says Node 24. endoflife: 24 is LTS, EOL 2028-04-30; 26 released 2026-10-28 (not LTS yet); 25 EOL. Fine. Constraints: react-router 8.5.1 needs `>=22.22.0`, vite 8.3.6 needs `^20.19 || >=22.12`, vitest 5.1.0 needs `^22.12 || ^24 || >=26`. Pin "24.x (>=24.0)" in `.nvmrc`/CI.

## Verified correct (primary source)

Maven Central / BOM:
- Spring Boot 4.1.2: latest 4.1.x stable (4.2.0-RC2 is pre-release). Boot 4.1 OSS EOL 2027-07-31.
- Spring Framework 7.0.10, Spring Security 7.1.2: match BOM.
- `spring-boot-starter-oauth2-resource-server` exists under that name in 4.1.2 (POM resolves, pulls `spring-boot-security-oauth2-resource-server`). ADR-5 correct.
- Maven 3.9.16 is the latest 3.9.x (4.0.0-rc-7 only pre-release).
- PostgreSQL JDBC 42.7.14, Thymeleaf 3.1.5.RELEASE, AWS SDK S3 2.57.11, bcprov-jdk18on 1.86, OWASP sanitizer 20261103.2, TwelveMonkeys imageio-webp 3.15.3, ArchUnit 1.5.1, Testcontainers 2.0.5: all newest on Central.
- springdoc-openapi 3.2.0: latest; its parent POM resolves with Boot 4.1.2, so a Boot 4 compatible release exists (3.x line is the Boot 4 line).
- Testcontainers 2.x artifact is `testcontainers-postgresql` (exists, 2.0.5). Use 2.x module and package names.
- Hibernate 7.4.13.Final: BOM value (7.4.15 newest).

crates.io and npm:
- tauri 2.12.5; tauri-cli 2.12.4; plugins updater 2.14.1, deep-link 2.6.3, single-instance 2.5.5, dialog 2.8.4: all max stable. Note the 3.0.0-alpha line exists; keep `2`.
- keyring 4.2.0, reqwest 0.13.5, tokio 1.54.1: match. Rust 1.99.1 is stable; Tauri 2.12.5 MSRV 1.90, keyring MSRV 1.88.
- @tauri-apps/api 2.12.4, plugin-updater 2.14.1, plugin-deep-link 2.6.3, plugin-dialog 2.8.4: match crates.
- react 19.3.1, vite 8.3.6, typescript 7.0.2 (see F1), vitest 5.1.0, @tanstack/react-query 5.107.1, react-router 8.5.1, @tiptap/react 3.33.0, dompurify 3.4.17, openapi-typescript 7.13.0: all npm `latest`.
- Tauri updater docs confirm Linux AppImage updates (`.AppImage` + `.sig`); `.deb` manual is correct. Dialog plugin exists (save dialog). tauri-action latest is `action-v1.0.0` (only matters if CI pins it).

Docker:
- `postgres:18.6` exists; 18.6 is latest 18.x, EOL 2030-11-14.
- `axllent/mailpit:v1.33.0` exists; GitHub latest release is v1.33.0.
- `eclipse-temurin:25-jre` exists (multi-arch, 10 manifests); JDK 25 is LTS. Latest 25.0.5+8. Consider pinning the patch tag for reproducibility (`25.0.5_8-jre`), since `25-jre` floats.
- JDK 25 + Kotlin 2.3.21 + Boot 4.1: supported combination; not build-tested here.

## Not verified
- Runtime behaviour of F3 (needs story 1.3 spike).
- ArchUnit 1.5.1 on JDK 25 class files (version is current; JDK 25 support unconfirmed).
- Dokploy features (no API for versions).
- GitHub-hosted runner image names/labels.
