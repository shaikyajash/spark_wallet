// Belt-and-suspenders postbuild: ensure routes-manifest-deterministic.json
// exists in .next, and on Vercel also mirror the full .next directory to
// any alternate path Vercel CLI might read from.
const fs = require('fs');
const path = require('path');

const cwdNext = path.join(process.cwd(), '.next');

if (!fs.existsSync(cwdNext)) {
  console.log('[postbuild] .next missing, skipping');
  process.exit(0);
}

// Generate routes-manifest-deterministic.json if missing.
const det = path.join(cwdNext, 'routes-manifest-deterministic.json');
if (!fs.existsSync(det)) {
  const src = path.join(cwdNext, 'routes-manifest.json');
  if (fs.existsSync(src)) {
    const sort = (o) =>
      Array.isArray(o) ? o.map(sort) :
      o && typeof o === 'object'
        ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]))
        : o;
    const m = JSON.parse(fs.readFileSync(src, 'utf8'));
    fs.writeFileSync(det, JSON.stringify(sort(m)));
    console.log('[postbuild] wrote', det);
  }
}

// On Vercel, mirror the .next directory to alternate paths.
if (process.env.VERCEL || process.env.NOW_BUILDER) {
  for (const alt of ['/vercel/path0/.next', '/vercel/path0/web/.next']) {
    if (path.resolve(alt) === path.resolve(cwdNext)) continue;
    try {
      fs.mkdirSync(alt, { recursive: true });
      fs.cpSync(cwdNext, alt, { recursive: true, force: false, dereference: false });
      console.log('[postbuild] mirrored .next →', alt);
    } catch (e) {
      console.warn('[postbuild] mirror failed for', alt, ':', e.message);
    }
  }
}
