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

    const sort = (o) =>
      Array.isArray(o) ? o.map(sort) :
      o && typeof o === 'object'
        ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]))
        : o;

    // Read content before Vercel's adapter can move/delete distDir.
    let content;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'routes-manifest.json'), 'utf8'));
      content = JSON.stringify(sort(manifest));
    } catch (e) {
      console.warn('[vercel-shim] read error:', e.message);
    }

    const write = () => {
      if (!content) return;
      try {
        fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(path.join(distDir, 'routes-manifest-deterministic.json'), content);
        console.log('[vercel-shim] wrote routes-manifest-deterministic.json to', distDir);
      } catch (e) {
        console.warn('[vercel-shim] write error:', e.message);
      }
    };

    // Write BEFORE so Vercel's adapter finds the file if it reads it.
    write();

    try {
      const vercel = await getVercelAdapter();
      if (vercel?.onBuildComplete) {
        await vercel.onBuildComplete(ctx);
      }
    } catch (e) {
      console.warn('[vercel-shim] vercel adapter error:', e.message);
    }

    // Write AGAIN after in case Vercel's adapter deleted distDir.
    write();
  },
};

module.exports = adapter;
