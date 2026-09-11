/**
 * Stitches a static page together:
 *   header + footer  <-  https://medskill.ge/
 *   <main> content   <-  https://www.skillwill.edu.ge/posts/blogs/<postId>
 *
 * Both sites run the same Next.js build, so their Emotion/MUI class names and
 * font stack are identical -- the two CSS sets can simply be merged.
 *
 * Everything is rendered in headless Chrome first, because the app is
 * client-rendered and injects all of its CSS through the CSSOM at runtime.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public');
const ASSET_DIR = path.join(OUT, 'assets');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHELL_URL = 'https://medskill.ge/';
// The homepage's fixed header sits on a transparent wrapper (it is meant to
// float over the dark hero photo there). Every interior MedSkill page uses
// the same <header> markup but with a solid dark wrapper -- that variant is
// the one that stays legible over the article body, so the header is
// sourced from here instead of the homepage.
const HEADER_URL = 'https://medskill.ge/programs/oqlikfruze0bdx8m3awuye78';
const CONTENT_URL = 'https://www.skillwill.edu.ge/posts/blogs/qz7i38sz4v5maaycm4qrqkjm';

fs.mkdirSync(ASSET_DIR, { recursive: true });

/* ------------------------------------------------------------------ *
 * asset downloading
 * ------------------------------------------------------------------ */

const EXT_BY_TYPE = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif',
  'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
  'font/ttf': '.ttf', 'font/woff': '.woff', 'font/woff2': '.woff2',
  'font/otf': '.otf', 'application/font-woff': '.woff',
  'video/mp4': '.mp4', 'video/webm': '.webm',
};

const assetCache = new Map(); // absolute url -> local path
let downloaded = 0, failed = 0;

async function localize(rawUrl, base) {
  let abs;
  try {
    abs = new URL(rawUrl, base).href;
  } catch {
    return rawUrl;
  }
  if (!/^https?:/i.test(abs)) return rawUrl;
  if (assetCache.has(abs)) return assetCache.get(abs);

  try {
    const res = await fetch(abs, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
        Referer: base,
      },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());

    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let ext = EXT_BY_TYPE[type] || path.extname(new URL(abs).pathname).split('?')[0];
    if (!ext || ext.length > 6) ext = '.bin';

    const name = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 16) + ext;
    fs.writeFileSync(path.join(ASSET_DIR, name), buf);

    const local = 'assets/' + name;
    assetCache.set(abs, local);
    downloaded++;
    return local;
  } catch (err) {
    failed++;
    console.warn('  ! asset failed:', abs.slice(0, 110), '-', err.message);
    assetCache.set(abs, abs); // fall back to hotlinking
    return abs;
  }
}

/** Rewrite one srcset value ("a.png 1x, b.png 2x"). */
async function localizeSrcset(value, base) {
  const parts = value.split(',');
  const out = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\S+)(\s+.*)?$/);
    if (!m) { out.push(trimmed); continue; }
    out.push((await localize(m[1], base)) + (m[2] || ''));
  }
  return out.join(', ');
}

/**
 * In an HTML fragment: download media, absolutise navigation links.
 */
async function processHtml(html, base) {
  // src / poster -> local file
  const srcRe = /\s(src|poster)="([^"]*)"/gi;
  const srcJobs = [];
  html.replace(srcRe, (full, attr, val) => {
    if (val && !/^(data:|blob:|#|javascript:)/i.test(val)) srcJobs.push({ full, attr, val });
    return full;
  });
  for (const job of srcJobs) {
    const local = await localize(job.val, base);
    html = html.split(job.full).join(` ${job.attr}="${local}"`);
  }

  // srcset -> local files
  const setRe = /\ssrcset="([^"]*)"/gi;
  const setJobs = [];
  html.replace(setRe, (full, val) => { if (val.trim()) setJobs.push({ full, val }); return full; });
  for (const job of setJobs) {
    const local = await localizeSrcset(job.val, base);
    html = html.split(job.full).join(` srcset="${local}"`);
  }

  // inline style="...url(...)..."
  const styleRe = /\sstyle="([^"]*url\([^"]*)"/gi;
  const styleJobs = [];
  html.replace(styleRe, (full, val) => { styleJobs.push({ full, val }); return full; });
  for (const job of styleJobs) {
    const replaced = await replaceCssUrls(job.val, base);
    html = html.split(job.full).join(` style="${replaced}"`);
  }

  // <a href> -> absolute, so nav still reaches the real sites
  html = html.replace(/\shref="([^"]*)"/gi, (full, val) => {
    if (!val || /^(https?:|mailto:|tel:|#|data:|javascript:)/i.test(val)) return full;
    try { return ` href="${new URL(val, base).href}"`; } catch { return full; }
  });

  return html;
}

async function replaceCssUrls(css, base) {
  const re = /url\((['"]?)([^'")]+)\1\)/gi;
  const jobs = [];
  css.replace(re, (full, q, val) => {
    if (val && !/^(data:|blob:|#)/i.test(val)) jobs.push({ full, q, val });
    return full;
  });
  for (const job of jobs) {
    const local = await localize(job.val, base);
    css = css.split(job.full).join(`url(${job.q}${local}${job.q})`);
  }
  return css;
}

/* ------------------------------------------------------------------ *
 * page scraping
 * ------------------------------------------------------------------ */

async function scrape(browser, url, label) {
  console.log(`\n> rendering ${label}: ${url}`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
  );
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForSelector('footer', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));

  // scroll through so lazy images and reveal-on-scroll sections commit
  await page.evaluate(async () => {
    await new Promise((res) => {
      let y = 0;
      const t = setInterval(() => {
        window.scrollBy(0, 700);
        y += 700;
        if (y > document.body.scrollHeight + 2500) { clearInterval(t); window.scrollTo(0, 0); res(); }
      }, 90);
    });
  });
  await new Promise((r) => setTimeout(r, 3500));

  const data = await page.evaluate(() => {
    const header = document.querySelector('header');
    const footer = document.querySelector('footer');
    const main = document.querySelector('main');

    // the wrapper that holds the header also holds the announcement bar
    const headerShell = header && header.parentElement ? header.parentElement : header;

    // one entry per rule -- @media/@font-face cssText spans several lines,
    // so these must never be split on newlines later
    const css = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) css.push(rule.cssText);
      } catch {
        /* cross-origin sheet - skipped */
      }
    }

    const icon = document.querySelector('link[rel~="icon"]');

    return {
      header: headerShell ? headerShell.outerHTML : '',
      footer: footer ? footer.outerHTML : '',
      main: main ? main.outerHTML : '',
      css,
      title: document.title,
      lang: document.documentElement.lang || 'ka',
      bodyClass: document.body.className || '',
      icon: icon ? icon.getAttribute('href') : null,
    };
  });

  await page.close();
  console.log(`  header ${data.header.length}b | main ${data.main.length}b | footer ${data.footer.length}b | css ${data.css.length} rules`);
  return data;
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const shell = await scrape(browser, SHELL_URL, 'medskill (footer)');
const headerPage = await scrape(browser, HEADER_URL, 'medskill (header, solid variant)');
const content = await scrape(browser, CONTENT_URL, 'skillwill (content)');
await browser.close();

if (!headerPage.header) throw new Error('medskill header not found');
if (!shell.footer) throw new Error('medskill footer not found');
if (!content.main) throw new Error('skillwill <main> not found');

console.log('\n> localising assets');
const headerHtml = await processHtml(headerPage.header, HEADER_URL);
const footerHtml = await processHtml(shell.footer, SHELL_URL);
const mainHtml = await processHtml(content.main, CONTENT_URL);

// Merge stylesheets: medskill first, then any skillwill rule not already present.
const seen = new Set();
const merged = [];
for (const [rules, base] of [
  [shell.css, SHELL_URL],
  [headerPage.css, HEADER_URL],
  [content.css, CONTENT_URL],
]) {
  for (const rule of rules) {
    const r = rule.trim();
    if (!r || seen.has(r)) continue;
    seen.add(r);
    merged.push(await replaceCssUrls(r, base));
  }
}
const mergedCss = merged.join('\n');

const favicon = shell.icon ? await localize(shell.icon, SHELL_URL) : null;

console.log(`  ${downloaded} assets saved, ${failed} failed`);

const html = `<!DOCTYPE html>
<html lang="${content.lang || 'ka'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">
<meta name="googlebot" content="noindex, nofollow">
<title>${content.title.replace(/</g, '&lt;')}</title>
${favicon ? `<link rel="icon" href="${favicon}">` : ''}
<style>
${mergedCss}
</style>
<style>
/* keep the stitched shell behaving like the original document */
html, body { margin: 0; padding: 0; }
body { font-family: TBCContractica, sans-serif; overflow-x: hidden; }
img { max-width: 100%; }
</style>
</head>
<body class="${shell.bodyClass}">
${headerHtml}
${mainHtml}
${footerHtml}
</body>
</html>
`;

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
fs.writeFileSync(
  path.join(OUT, 'robots.txt'),
  'User-agent: *\nDisallow: /\n',
  'utf8'
);

console.log(`\n> wrote public/index.html (${(html.length / 1024).toFixed(0)} KB)`);
