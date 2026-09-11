# MedSkill Shadow Page

A static snapshot page that combines:

- **Header + footer** from https://medskill.ge/
- **Article content** from https://www.skillwill.edu.ge/posts/blogs/qz7i38sz4v5maaycm4qrqkjm

Both sites run the same underlying Next.js/MUI build, so fonts, colors, and
components match exactly with no manual restyling.

**Live URL:** https://medskill-shadow.vercel.app/
(unlisted — not linked anywhere, and served with `X-Robots-Tag: noindex` /
`robots.txt` so it won't be indexed by search engines)

## How it was built

`scripts/build.mjs` drives headless Chrome to:

1. Render `https://medskill.ge/programs/oqlikfruze0bdx8m3awuye78` and grab its
   `<header>` (an interior MedSkill page is used instead of the homepage,
   because the homepage header sits on a transparent background meant to
   float over its own hero photo — the interior pages use the solid dark
   variant that stays legible over article content).
2. Render `https://medskill.ge/` and grab its `<footer>`.
3. Render the SKILLWILL blog post and grab its `<main>` (hero + article +
   "similar posts" sidebar, all included).
4. Extract every CSS rule from the live stylesheets (this app injects all of
   its styling via Emotion/MUI at runtime, so there is no static CSS file to
   copy), merge the two rule sets, and download every referenced image/font
   asset locally into `public/assets/`.
5. Stitch it all into one `public/index.html`.

This produced a **one-time snapshot**. Editing `public/index.html` directly is
the easiest way to make changes from here — it's a single self-contained
static file plus a `public/assets/` folder, no build step required to view it.

If you ever want to re-pull fresh copies from the live sites (this overwrites
any hand edits you've made), run:

```bash
npm install
npm run snapshot
```

## Editing

Just edit `public/index.html` (and files in `public/assets/`) directly, then
redeploy:

```bash
vercel deploy --prod
```

## Notes on links

Header/footer nav links point to medskill.ge; links inside the article point
to skillwill.edu.ge — both are live, real destinations (per your choice, not
placeholders).
