# SQ Core login theme resource recovery — 6 October 2026

**Status:** resolved in production.

## Symptom

The public Akun SQ login HTML and organization mark loaded, while all CSS and the password-visibility JavaScript returned empty HTTP 404 responses. The result was an unstyled form and an oversized mark.

## Root cause

The Mi8 public edge proxy forwarded the browser's `Accept-Encoding: gzip, br` header to Keycloak 26.7.2. In the deployed optimized runtime, Keycloak returned an empty 404 for compressible theme resources when that header was present. Non-compressible image resources still returned 200.

Cloudflare cached the resource 404 responses for four hours, which made the symptom persist after the origin was otherwise healthy.

## Correction

- `scripts/sq-core/mi8-directory-tls-proxy.mjs` now removes `Accept-Encoding` only for requests proxied to Keycloak. Cloudflare remains responsible for browser-facing edge compression.
- The production proxy copy was backed up to `/data/local/mi8vps/backups/directory-proxy.mjs.pre-css-fix-20261006T070742Z`.
- Only the `directory-proxy` process was restarted through the existing supervisor.
- The Cloudflare cache prefix `login.sabilulquran.or.id/resources/qes8a/` was purged after owner confirmation.

## Verification

- Keycloak CSS with browser-style `Accept-Encoding: gzip, br`: HTTP 200, `text/css`.
- Public PatternFly CSS, Akun SQ CSS, password-visibility JavaScript, and organization mark: HTTP 200 with correct content types.
- Clean-browser visual verification shows the accepted Akun SQ card layout and branding.
- SQ Core remained at one supervisor and 8/8 live processes; PostgreSQL, Keycloak, HCIS, Hub, Aset, machine auth, and fresh Organization Directory checks remained healthy.

Browsers that loaded the old cached 404 before correction may need one manual `Ctrl+F5` refresh or may retain the old response until its four-hour browser-cache TTL expires.
