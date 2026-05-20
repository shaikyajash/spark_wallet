// Minimal shim adapter: generates routes-manifest-deterministic.json and
// intentionally does NOT call Vercel's adapter. Vercel's adapter has been
// aggressively cleaning up node_modules and .next files that Vercel CLI
// later expects to read, causing chained ENOENT errors. By skipping it,
// the original file tree stays intact for Vercel CLI to deploy.
const fs = require('fs');
const path = require('path');

const sort = (o) =>
  Array.isArray(o) ? o.map(sort) :
  o && typeof o === 'object'
    ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]))
    : o;

function writeDeterministic(distDir) {
  try {
    const src = path.join(distDir, 'routes-manifest.json');
    if (!fs.existsSync(src)) return;
    const m = JSON.parse(fs.readFileSync(src, 'utf8'));
    fs.writeFileSync(
      path.join(distDir, 'routes-manifest-deterministic.json'),
      JSON.stringify(sort(m))
    );
    console.log('[vercel-shim] wrote routes-manifest-deterministic.json in', distDir);
  } catch (e) {
    console.warn('[vercel-shim] writeDeterministic error:', e.message);
  }
}

/** @type {import('next').NextAdapter} */
const adapter = {
  name: 'vercel-shim',

  async modifyConfig(config) {
    // Take over as the adapter; do NOT chain to Vercel's adapter.
    return { ...config, adapterPath: __filename };
  },

  async onBuildComplete(ctx) {
    const { distDir } = ctx;
    console.log('[vercel-shim] onBuildComplete distDir:', distDir);
    writeDeterministic(distDir);
  },
};

module.exports = adapter;
