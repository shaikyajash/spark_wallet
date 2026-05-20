const fs = require('fs');
const path = require('path');

const sort = (o) =>
  Array.isArray(o) ? o.map(sort) :
  o && typeof o === 'object'
    ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]))
    : o;

function readManifest(dir) {
  const src = path.join(dir, 'routes-manifest.json');
  if (!fs.existsSync(src)) return null;
  try {
    return JSON.parse(fs.readFileSync(src, 'utf8'));
  } catch {
    return null;
  }
}

function readDeterministic(dir) {
  const p = path.join(dir, 'routes-manifest-deterministic.json');
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

const cwdNext = path.join(process.cwd(), '.next');

let content = null;
const m = readManifest(cwdNext);
if (m) {
  content = JSON.stringify(sort(m));
} else {
  // Manifest already moved? Try to reuse an existing deterministic file we wrote earlier.
  content = readDeterministic(cwdNext);
}

if (!content) {
  console.log('[postbuild] no source manifest found, skipping');
  process.exit(0);
}

const targets = new Set([cwdNext]);
if (process.env.VERCEL || process.env.NOW_BUILDER) {
  targets.add('/vercel/path0/.next');
  targets.add('/vercel/path0/web/.next');
  targets.add('/vercel/output/.next');
}

for (const dir of targets) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'routes-manifest-deterministic.json'), content);
    console.log('[postbuild] wrote', path.join(dir, 'routes-manifest-deterministic.json'));
  } catch (e) {
    console.warn('[postbuild] failed to write', dir, ':', e.message);
  }
}
