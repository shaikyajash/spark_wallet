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
    console.log('[vercel-shim] onBuildComplete distDir:', distDir, 'cwd:', process.cwd());

    // Read manifest content before Vercel's adapter can move/delete distDir.
    const content = buildContent(distDir);
    console.log('[vercel-shim] content ready:', !!content);

    // Write before Vercel's adapter (in case it reads the file).
    writeFile(distDir, content);

    // Always also write to cwd-relative .next (covers rootDirectory mismatches).
    const cwdNext = path.join(process.cwd(), '.next');
    if (cwdNext !== distDir) writeFile(cwdNext, content);

    try {
      const vercel = await getVercelAdapter();
      if (vercel?.onBuildComplete) {
        await vercel.onBuildComplete(ctx);
      }
    } catch (e) {
      console.warn('[vercel-shim] vercel adapter error:', e.message);
    }

    // Write again after in case Vercel's adapter deleted distDir.
    writeFile(distDir, content);
    if (cwdNext !== distDir) writeFile(cwdNext, content);

    // Confirm final state.
    const target = path.join(distDir, 'routes-manifest-deterministic.json');
    console.log('[vercel-shim] file exists at distDir after all writes:', fs.existsSync(target));
  },
};

module.exports = adapter;
