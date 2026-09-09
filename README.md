# Chairul Huda — Pusat Ilmu Hukum Pidana

Node.js application for a public criminal-law knowledge library, member accounts, premium material access, and an editorial administration dashboard. Built with Express 5, EJS and native SQLite, with server-rendered pages and minimal client JavaScript.

## Run

Use **Node.js 22.16+ (Node 24 recommended)**.

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:3000`. Native `node:sqlite` is used; no external database service is required for one Node process. Data persists in `DATA_DIR`, defaulting to `./data`. Back up the entire data directory, including uploads. Do not run multiple application replicas against separate copies of this directory.

## Deployment on Hostinger Node.js hosting

1. Import GitHub repository `cchandra/chairulhuda`, branch `main` as a Node.js application.
2. Select Node 24 (or Node 22.16+), root directory `/`, install `npm ci`, build `npm run build`, start `npm start`.
3. Set `NODE_ENV=production` and `BASE_URL` to the **exact public HTTPS origin**, without a path. Hostinger supplies `PORT`; the app binds `0.0.0.0`.
4. Set `DATA_DIR` to a persistent writable directory **outside the replaceable application release**. Verify Hostinger preserves this directory across rebuilds before accepting real users. If the hosting plan cannot provide persistent storage, use a separate database/object-storage implementation before production.
5. Set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 14 characters for the first startup. No default administrator exists. Remove `ADMIN_PASSWORD` after provisioning; existing accounts are not overwritten by the bootstrap.
6. Check `/health` and `/`, sign in through `/masuk`, and open `/admin`. Verify a sample draft and upload survive a restart and rebuild.

The app reads environment variables from the hosting platform. `.env.example` is documentation; `.env` is not automatically loaded by `npm start`.

## Functional scope

- Responsive home, professor introduction, searchable library, topics and material types, article detail pages, class listing, professional program, expert-services requests.
- Registration/login/logout, scrypt password hashes, hashed session tokens, HttpOnly secure production cookies, password changes with other-session revocation.
- Member bookmarks and request history.
- Administrator create/edit/publish/unpublish materials, declare author, attach a PDF, DOCX, PPTX, MP4 or MP3, and choose public or premium access.
- Server-enforced premium article, document and media protection, with membership expiry checked on every request.
- Administrator manual membership activation/expiry and inquiry status management.
- Same-origin mutation checks, request limits, upload limits/signature checks, CSP, escaped output, and private storage outside public assets.
- SEO page titles/descriptions, sitemap, robots, accessible navigation/forms, keyboard focus and reduced-motion support.

## Editorial and launch status

The three seed articles are brief **editorial reading guides**, explicitly marked as not authored by Prof. Chairul Huda. They are not case-specific advice, invented quotes, or unapproved publications. No fabricated CV, credentials, testimonials, course dates, or student counts are included. Replace/expand materials after editorial approval. Seed entries are created only when the materials table is empty.

The program prices are visibly marked as **initial proposals**. Membership begins with an interest request; there is no automatic checkout or payment collection. An admin can activate an individual member after offline agreement/payment verification. The firm offer is an inquiry workflow; automatic seat billing and team invitations are not implemented.

Classes support published text materials, downloadable PDFs/Word/slides, and uploaded MP4/MP3 playback (100 MB per file). The initial class page is honestly empty until materials are added. External video streaming, automatic transcription, Google login, payment gateway, email verification/reset, outbound email, and AI research are not integrated. No automatic email is claimed or sent. Inquiries persist in the administration dashboard. Initial forms ask users not to submit confidential case files.

Review identity/contact information, membership prices, legal notices and retention processes with the professor before a public commercial launch. Deployment still needs live hosting access and a verified persistent data path.

## Maintenance

- Run `npm test` for isolated integration tests using a temporary database.
- Take consistent SQLite backups through SQLite's online backup facility, or stop the application while copying the database and WAL files; include uploads.
- Restore the database and uploads together. Do not commit data, user documents, environment files or passwords.
- Keep dependencies current and keep `package-lock.json` committed.
- Rate limits intentionally key on the socket address without trusting spoofable proxy headers. Behind a shared reverse proxy this may group users; configure an audited trusted-proxy setup if per-client limits are needed at scale.

## Media

`public/library.webp` is an original AI-generated editorial library photograph. It depicts no actual person and is used as atmosphere, not as an image of Prof. Chairul Huda or his office. The CH monogram is a provisional typographic identity.

## Bali visual direction

The v2 design uses Balinese residential architecture as inspiration: limestone, dark teak, warm paper and terracotta. Homepage composition is photographic, with an asymmetric reading-room introduction and journal-style article rows. `public/bali-courtyard.webp` and `public/bali-study.webp` are original AI-generated architectural illustrations, visibly identified as illustrations, not photographs of the professor or his actual home. Layout, styles, and assets only; runtime data and authorization are unchanged.

Real portrait: `public/chairul-huda.jpg` is the unmodified photograph of Chairul Huda published by Republika. Source: https://news.republika.co.id/berita/rw7cce451/kasus-ksp-sejahtera-bersama-bukan-penggelapan-dan-tppu-ini-kata-ahli . The original image is https://static.republika.co.id/uploads/images/inpicture_slide/dr-chairul-huda-sh-mh-dosen-umj-pakar-_160127132610-174.jpg . Source credits appear by the portrait. This public article does not provide an explicit reusable-image licence; rights remain with the rights holder. Replace with the professor's own authorized portrait when available.
