# Security notes

## Current demo hardening

- Handle `@` is unique, normalized case-insensitively, and cannot be changed after account creation.
- Display names are separate from handles and are always escaped before being inserted into HTML.
- New passwords are 12–128 characters and use PBKDF2-SHA-256 with a random salt and 310,000 iterations.
- Existing 150,000-iteration hashes are upgraded after a successful login.
- Login failures are rate-limited for 30 seconds and sessions expire after seven days.
- Project fields, collaborator handles, visibility, categories, and image data are validated again in the API layer.
- Project download URLs are restricted to HTTP/HTTPS and reject embedded credentials; uploaded files are kept as opaque IndexedDB Blobs, limited to 25 MB each/100 MB per local account, and downloaded with an attachment filename rather than rendered as page content.

## Not production-ready

The application is static and stores users, hashes, sessions, TOTP secrets, and projects in browser `localStorage`; uploaded file Blobs are stored in browser IndexedDB. This is not an authentication boundary: a user can edit it with DevTools, and an XSS vulnerability would expose it. Files are not uploaded to a shared server, so a public project's uploaded file is only available in the browser profile that created it. Never store real credentials, payment information, or private customer data in this version.

## Required production architecture

1. Move registration, login, password reset, 2FA, project creation, uploads, and authorization to a server.
2. Store users/projects in a database; use an immutable user ID for ownership instead of a mutable handle.
3. Hash passwords on the server with Argon2id (or a carefully configured bcrypt/PBKDF2 fallback). Never send or store plaintext passwords.
4. Use short-lived, rotated, revocable `HttpOnly; Secure; SameSite` cookies and CSRF protection.
5. Enforce authorization server-side for every project read/write/upload, not only in the browser.
6. Add email verification, password reset tokens with expiry, audit logs, IP/account rate limits, upload scanning, strict content-size limits, and storage quotas.
7. Store user uploads in object storage with server-side ownership checks, malware/content scanning, randomized object keys, and download responses using `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
8. Send a restrictive Content-Security-Policy and keep all dependencies updated.
