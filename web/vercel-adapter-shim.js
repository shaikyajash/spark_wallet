// Shim adapter: generates routes-manifest-deterministic.json (expected by
// Vercel's post-build tooling but not emitted by Next.js 16.2.6), then
// delegates to Vercel's real adapter so nothing else changes.
const fs = require('fs');
const path = require('path');

async function getVercelAdapter() {
  const p = process.env.NEXT_ADAPTER_PATH;
  if (!p) return null;
  const mod = await import(p);
  return mod.default ?? mod;
}

/** @type {import('next').NextAdapter} */
const adapter = {
  name: 'vercel-shim',

  async modifyConfig(config, ctx) {
    const vercel = await getVercelAdapter();
    let cfg = vercel?.modifyConfig ? await vercel.modifyConfig(config, ctx) : config;
    // Keep our shim as the active adapter so our onBuildComplete runs.
    cfg.adapterPath = __filename;
    return cfg;
  },

  async onBuildComplete(ctx) {
    const { distDir } = ctx;

    // Generate the deterministic manifest before Vercel's adapter runs.
    try {
      const src = path.join(distDir, 'routes-manifest.json');
      const manifest = JSON.parse(fs.readFileSync(src, 'utf8'));
      const sort = (o) =>
        Array.isArray(o) ? o.map(sort) :
        o && typeof o === 'object'
          ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]))
          : o;
      fs.writeFileSync(
        path.join(distDir, 'routes-manifest-deterministic.json'),
        JSON.stringify(sort(manifest))
      );
    } catch (e) {
      console.warn('[vercel-shim] could not write routes-manifest-deterministic.json:', e.message);
    }

    const vercel = await getVercelAdapter();
    if (vercel?.onBuildComplete) {
      await vercel.onBuildComplete(ctx);
    }
  },
};

module.exports = adapter;
