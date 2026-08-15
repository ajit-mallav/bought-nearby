# Bought Nearby

An iPhone-first Expo app prototype for discovering local NYC purchases through personal ranked shelves. Think Beli, but for things people buy nearby.

## What is built

- **Log a purchase** with photo, item name, store/link, price, category, and notes.
- **Binary comparison ranking** after save: the app asks simple “was this better than X?” questions and inserts the item into the category shelf in `O(log n)` comparisons.
- **Beli-style score** from rank position; users do not manually enter a 0–10 score.
- **Feed** with friend activity such as “Sarah ranked AirPods Pro #2 in Tech.”
- **Profile shelves** with top 10 per category and a lifetime “worth it” list.
- **Search** across your purchases, friend activity, and local stores.
- **Nearby map** with seeded NYC stores, category filters, distance sorting, optional location permission, and directions links.
- **Supabase persistence** with per-user row-level security and local offline fallback.

## Tech stack

- Expo + React Native + TypeScript
- React Native Web for the browser demo
- Supabase for cloud persistence and AsyncStorage for offline fallback
- Expo Image Picker and Location for native/device capabilities

## Run locally

```bash
pnpm install
pnpm web
```

## Supabase setup

1. Create a Supabase project and enable **Anonymous Sign-Ins** under Authentication → Providers.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env` and add the project URL and anon key from Project Settings → API.
4. Restart Expo after changing environment variables.

The anon key is intended for client apps. Row-level security ensures each anonymous or signed-in user can only access their own saved app state. Without environment variables, the app continues to work using AsyncStorage only.

The web demo opens through Expo. For iPhone, install Expo Go, then run:

```bash
pnpm start
```

Scan the QR code with the Expo Go app.

## Build/export a web demo

```bash
pnpm export:web
```

This writes a static single-page web build to `dist/`.

## Useful scripts

```bash
pnpm typecheck   # TypeScript validation
pnpm web         # Run the live browser demo
pnpm ios         # Open in iOS simulator if full Xcode is installed
pnpm start       # Expo dev server / QR code
```

## Demo flow

1. Open **Log**.
2. Enter a purchase like “Ceramic pour-over” from “Coming Soon NY,” choose **Kitchen** or **Home**, and tap **Use sample** or choose a real photo.
3. Tap **Save & rank**.
4. Answer comparison prompts until the item lands in the ranked shelf.
5. View the activity in **Feed**, ranked shelves in **Shelf**, related items in **Search**, and nearby NYC stores in **Map**.

## Notes

- The map is a lightweight in-app NYC store map so the demo works without Google/Apple Maps API keys.
- Store data is seeded in `src/data/seed.ts`; replacing it with live store inventory or a backend search service would be the next step.
- This repo is intentionally standalone and does not depend on Shopify infrastructure.
