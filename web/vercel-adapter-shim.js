const fs = require('fs');
const path = require('path');

async function getVercelAdapter() {
  const p = process.env.NEXT_ADAPTER_PATH;
  if (!p) return null;
  const mod = await import(p);
  return mod.default ?? mod;
}

function buildContent(distDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(distDir, 'routes-manifest.json'), 'utf8'));
    const sort = (o) =>
      Array.isArray(o) ? o.map(sort) :
      o && typeof o === 'object'
        ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]))
        : o;
    return JSON.stringify(sort(m));
  } catch (e) {
    console.warn('[vercel-shim] buildContent error:', e.message);
    return null;
  }
}

function writeFile(dir, content) {
  if (!content) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'routes-manifest-deterministic.json'), content);
    console.log('[vercel-shim] wrote to', dir);
  } catch (e) {
    console.warn('[vercel-shim] write error at', dir, ':', e.message);
  }
}

function writeEverywhere(distDir, content) {
  const targets = new Set();
  targets.add(distDir);
  targets.add(path.join(process.cwd(), '.next'));
  // Vercel hardcoded fallback — covers any rootDirectory mismatch.
  if (process.env.VERCEL || process.env.NOW_BUILDER) {
    targets.add('/vercel/path0/.next');
    targets.add('/vercel/path0/web/.next');
    targets.add('/vercel/output/.next');
  }
  for (const t of targets) writeFile(t, content);
}

/** @type {import('next').NextAdapter} */
const adapter = {
  name: 'vercel-shim',

  async modifyConfig(config, ctx) {
    const vercel = await getVercelAdapter();
    let cfg = vercel?.modifyConfig ? await vercel.modifyConfig(config, ctx) : config;
    cfg.adapterPath = __filename;
    return cfg;
  },

  async onBuildComplete(ctx) {
    const { distDir } = ctx;
    console.log('[vercel-shim] onBuildComplete distDir:', distDir, 'cwd:', process.cwd(), 'VERCEL:', !!process.env.VERCEL);

    const content = buildContent(distDir);
    console.log('[vercel-shim] content ready:', !!content);

    writeEverywhere(distDir, content);

    try {
      const vercel = await getVercelAdapter();
      if (vercel?.onBuildComplete) {
        await vercel.onBuildComplete(ctx);
      }
    } catch (e) {
      console.warn('[vercel-shim] vercel adapter error:', e.message);
    }

    writeEverywhere(distDir, content);
  },
};

module.exports = adapter;
