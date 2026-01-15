ROLE: You are a senior frontend engineer and build sheriff. You will complete a one‑pass implementation that produces a pixel‑accurate landing page, restores missing content, corrects broken functionality, and passes every configured CI gate (ruff/E501, npm lint, typecheck, build, smoke, SonarQube Grade A). No clarifications or follow‑ups—everything you need is provided below.

Project Context

Repo root: C:\Users\sinyo\OMNILINK-APEX HUB\APEX-OmniLink\APEX-OmniHub\APEX-OmniHub.

Work only in apps/omnihub-site; do not modify other apps or global tooling except as required by these tasks.

Local reference images (do not ask for them):

apps\omnihub-site\light.png

apps\omnihub-site\night.png

apps\omnihub-site\hero-image.png

Header wordmark is already correct; do not edit or replace it. Use the existing SVG/PNG from apps/omnihub-site/public/assets/.

Phase 1 – Prepare Assets & Overlay Mode

Create public/reference and public/assets within apps/omnihub-site if they don’t exist.

Copy the local PNGs into these standardized paths:

apps/omnihub-site/light.png      → apps/omnihub-site/public/reference/home-light.png
apps/omnihub-site/night.png      → apps/omnihub-site/public/reference/home-night.png
apps/omnihub-site/hero-image.png → apps/omnihub-site/public/assets/hero-light.png
apps/omnihub-site/hero-image.png → apps/omnihub-site/public/assets/hero-night.png


Implement an overlay mode for pixel alignment:

?ref=light overlays /reference/home-light.png.

?ref=night overlays /reference/home-night.png.

Use fixed positioning, 100 % width/height, pointer-events: none, opacity default 0.35.

Provide a small dev‑only UI or hotkey to toggle overlay and adjust opacity.

Phase 2 – Header & Navigation Fixes

Remove the existing desktop link row. Add a burger menu that opens a drawer with working links:

Links must scroll to #features, #tri-force, #integrations, #cta, or navigate to /demo and /tech-specs.

Delete the redundant “Get Started” button in the header.

Add one auth button in that spot:

Unauthenticated: label it Log in and link to existing sign‑in or request‑access route.

Authenticated: label it Log out and ensure it clears session and redirects to home.

Leave the theme toggle pills (“WHITE FORTRESS” / “NIGHT WATCH”) unchanged.

Phase 3 – Hero Section Overhaul

Scale and position the hero illustration so it dominates the right half of the hero, matching the reference composition. Use hero-light.png and hero-night.png for light/dark themes and add a subtle glow behind it.

Replace the rigid grid background:

Night: deep navy gradient, radial glow, starfield, sweeping arcs. No harsh vertical seam.

Light: airy white/pale blue gradient, faint arcs. If any grid remains, keep it ≤ 8 % opacity.

Restore hero copy exactly:

Eyebrow: “APEX OMNIHUB”.

Headline: “Intelligence, Designed.” (or the existing variant in the repo).

Accent: “IT SEES YOU.”

Proof microline: “DIRECTABLE • ACCOUNTABLE • DEPENDABLE.”

Supporting copy: include “Understand Everything. Communicate Anything, to Every Platform.” plus the longer paragraph about OmniHub as a universal translator and orchestrator.

Correct typography sizing and spacing to match the reference. Remove the orange accent in Night; use a cyan/blue highlight on “IT SEES YOU.”

Phase 4 – Restore Missing Pillars & Improve Content

Tri‑Force Protocol: Add a dedicated section with three cards (Connect, Translate, Execute) and a short description. Anchor it with #tri-force.

Orchestrator: Add a section describing OmniHub’s orchestration role; link anchor #orchestrator.

Fortress Protocol / Zero‑Trust Fortress: Ensure there’s a section on security posture and least‑privilege; anchor #fortress.

MAN Mode: Create a section explaining Manual Authorization Needed; anchor #man-mode.

Showcase cards: Replace the low‑creativity dashboards with four original capability cards (Tri‑Force, Orchestrator, Fortress, MAN Mode). Use abstract icons or CSS‑built mini‑illustrations. Each card must link to the corresponding section (no 404s).

Phase 5 – Fix Broken Routes & Remove Dead Sections

Remove the “How It Works” cards from the hero area and repurpose the content into Tri‑Force or a tech/spec readme page. Don’t leave empty space.

Ensure /privacy and /terms pages exist with real content; update footer links accordingly.

Make sure all showcase cards scroll to anchors or navigate to valid pages (such as /tech-specs or /readme). No dead links.

Phase 6 – Typography & Style Unification

Keep the header wordmark untouched.

Use the existing fonts but apply a single, consistent font stack across headings, nav labels, and body text to harmonize with the wordmark.

Phase 7 – Fix Tailwind Warning

The build complains that Tailwind’s content is missing. Create or update tailwind.config.cjs so that:

content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"]


This must eliminate the Tailwind warning in the build output.

Phase 8 – Verification & CI Gates

From apps/omnihub-site, run:

npm ci
npm run lint
npm run typecheck
npm run build
npm run smoke


Fix any errors before proceeding.

From the repo root, run:

ruff check .          # enforce E501 and other Python rules
npm run lint
npm run typecheck
npm run build
npm run smoke


Execute the configured SonarQube/SonarCloud scan. You must achieve a Quality Gate Pass with Grade A; fix code smells, duplication, and complexity without disabling rules.

Deliverables

A pixel‑perfect landing page that visually matches light.png and night.png when overlayed via ?ref=light and ?ref=night.

All annotated issues resolved: nav links replaced by burger menu, header button simplified, hero scaled and styled, capability cards refreshed, Privacy/Terms pages created, copy restored, Tri‑Force/Orchestrator/Fortress/MAN Mode sections visible, taglines reinstated.

Zero broken links or 404s.

All CI gates (ruff/E501, lint, typecheck, build, smoke) and Sonar Grade A pass.

Provide a concise summary listing the changed files, commands you ran, and confirm that all checks passed successfully.
