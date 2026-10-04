# Modium

Modium is a static front end with two data modes:

- **Local demo:** with `backend/supabase-config.js` left blank, accounts and projects use browser storage. Data is not shared and this mode is not suitable for real accounts.
- **Shared deployment:** configure Supabase and the app uses Supabase Auth, Postgres with row-level security (RLS), and a private Storage bucket. Cloudflare Pages can host the static front end.

## Resource packs, uploads, and languages

- Resource-pack projects require a resolution: 8x, 16x, 32x, 48x, 64x, 128x, 256x, or 512x.
- The home-page resource animation lists each resource type once.
- Project downloads accept a file or an HTTP/HTTPS URL. Embedded URL credentials and other protocols are rejected.
- Each uploaded file is limited to 25 MiB. In local demo mode, total file storage is limited to 100 MiB per account. In Supabase mode, the private bucket and RLS enforce 25 MiB per file and 100 MiB per account. The database also limits accounts to 100 projects.
- UI locales: Vietnamese, English, Latin American Spanish, Simplified Chinese, and Japanese. Translations are machine-assisted and welcome community proofreading; missing dynamic strings fall back to English.

## Configure Supabase

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) once in **SQL Editor**. It creates the profile/project tables, RLS policies, private `project-files` bucket, file-size/quota enforcement, and account functions.
2. In **Authentication → URL Configuration**, set the Site URL to the final Cloudflare Pages URL and add that URL (plus localhost if needed) to Redirect URLs.
3. Enable email confirmation, set the minimum password length to 12, enable MFA if desired, and configure a production SMTP provider before inviting public signups. Review Supabase Auth rate limits/CAPTCHA for your project.
4. Copy the project URL and the **publishable/anon key** from the Supabase API settings into `backend/supabase-config.js`:

   ```js
   window.MODIUM_SUPABASE = {
     url: 'https://YOUR-PROJECT.supabase.co',
     anonKey: 'YOUR-PUBLISHABLE-OR-ANON-KEY',
     required: true
   };
   ```

   The key is meant to be public in a browser; RLS is the security boundary. **Never put a `service_role` or `sb_secret_` key in this file.** Set `required: true` before production deploy so a forgotten/missing key fails closed instead of silently starting the local demo. Partial/invalid cloud configuration also fails closed.
5. Local demo data in browser storage is not migrated automatically. Use new cloud accounts after switching modes.

Public profiles and public projects are readable by anyone. Unlisted projects are not shown in browse results, but their human-readable links are not a secret. Private projects and their files require the owner or a collaborator. Uploaded files remain in a private bucket and are delivered using short-lived signed download links. To keep startup light, the current browser browse cache loads the latest 500 public project summaries; add server-side filtering/pagination before a large catalog grows beyond that.

## Deploy to the current GitHub Pages site

The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds and publishes **only `dist/`**. This prevents the Pages website itself from exposing the loose `/backend/*.js` and `/frontend/*.js` source files shown in the DevTools screenshot.

1. Push this project to the GitHub repository and branch used by the current Pages site (`main` or `master`).
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. Do not publish the repository root or the source branch directly.
3. In **Actions**, wait for “Build and deploy Modium Pages” to succeed. The workflow runs the obfuscating production build before uploading `dist/`.

This hides the separate source-file URLs from the deployed site, **not** from a public GitHub repository. The browser must download `assets/a.js`, so F12, Network, and de-obfuscation can still reveal what the front end does. Obfuscation is only a speed bump, not a security boundary; never put passwords, service-role keys, or other secrets in client code. Keep authorization and private data protected by Supabase Auth/RLS, or use a server for proprietary logic.

## Alternative: Cloudflare Pages

1. Push this folder to a GitHub repository you control. Do not commit private credentials; the Supabase publishable/anon key is the only key used by the browser.
2. In Cloudflare Pages, connect the repository and set the build command to `npm install && npm run build` and the output directory to `dist`.
3. Add a custom domain if desired, then update the Supabase Site URL and Redirect URLs to match the deployed URL.

Cloudflare Pages and Supabase free tiers have quotas and availability limits that can change; check both dashboards. This workspace has **not** been deployed: deployment needs your GitHub/Cloudflare/Supabase projects and account access. Do not share a Supabase secret/service-role key.

## Build locally

Requires Node.js and npm:

```sh
npm install
npm run build
```

`dist/` is the deployable output. The build combines and obfuscates the local JavaScript; obfuscation is not a security measure. Supabase JS is loaded from jsDelivr. Cloudflare Pages applies the security headers/CSP in `_headers`; GitHub Pages does not process that file. This workspace has no Node/npm executable, so its checked-in `dist/` is a runnable but **not obfuscated** bundle; the GitHub Actions and Cloudflare builds run the proper production build before publishing.

## Security notes

See [`SECURITY.md`](SECURITY.md) for the trust boundary, RLS coverage, and remaining limitations. Treat the Supabase SQL schema as part of the application security model: do not deploy the public client until it has been applied and its policies have been reviewed.
