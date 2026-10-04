# Security notes

## Modes and trust boundary

- If the Supabase URL and key are blank, the site deliberately runs its local demo API. Its accounts/projects are editable through browser storage and are not secure or shared.
- With Supabase configured, authentication and data use Supabase Auth/Postgres/Storage. The browser contains only a publishable/anon key; the database RLS policies in `supabase/schema.sql` enforce who can read or mutate each record. Never expose a service-role/secret key.
- Cloudflare Pages serves static assets only. It does not provide the database, account service, or upload storage; those are provided by Supabase.

## Protections in the Supabase schema

- Profiles expose only public profile fields; users can update only their own display name, bio, and avatar. Handles are lower-case and unique.
- Project reads are restricted to public projects, or to an owner/collaborator for private projects. Unlisted projects are fetched by slug and omitted from browse results; an unlisted slug is not a secret token.
- Only an authenticated owner can create/delete their projects or add up to 10 collaborators. Database checks require valid project types, slugs, download modes, URLs, and resource-pack resolutions; accounts are limited to 100 projects.
- Uploads use a private Storage bucket. RLS ties an object path to its owner and project; signed download links are short-lived. The bucket caps individual files at 25 MiB and the RLS upload policy enforces 100 MiB per account.
- Account deletion removes owned objects through the Storage API before deleting the Auth user and cascading its profile/projects.
- Passwords and email confirmation are handled by Supabase Auth. TOTP enrollment is optional; the UI requests a second factor at sign-in, and RLS requires AAL2 for private project access and profile/project/storage mutations for users with a verified factor. Recovery links lead to a new-password form and also require TOTP for enrolled accounts. Set password length, email confirmation, SMTP, rate limits, and CAPTCHA in the Supabase dashboard.
- Cloudflare Pages `_headers` adds a restrictive CSP, frame protection, MIME sniffing protection, and a referrer policy.

## Remaining risks and launch checklist

- Browser-based Supabase sessions are stored by the Supabase SDK in browser storage. A same-origin XSS or compromised browser can act as the signed-in user; output escaping and CSP reduce risk but are not a substitute for an HttpOnly-cookie server architecture.
- The public profile fields and projects marked public are intentionally readable by anyone. Do not put private data in public project descriptions, URLs, images, or profiles.
- Download counters are approximate and can be called directly; do not use them for billing, rewards, or abuse decisions.
- Free service tiers have quotas, may pause/limit inactive projects, and do not promise production SLA. Monitor database/storage usage and configure backups before relying on the service.
- Before launch, apply and review `supabase/schema.sql`, set Auth redirect URLs to the exact Pages domain, require email confirmation, configure SMTP and rate limits/CAPTCHA, verify the Supabase bucket remains private, and deploy only the built `dist/` output.
- Any migration from an existing local-demo account is manual; old local passwords/hashes are not uploaded.
