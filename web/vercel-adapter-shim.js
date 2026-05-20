const fs = require('fs');
const path = require('path');
const os = require('os');

async function getVercelAdapter() {
  const p = process.env.NEXT_ADAPTER_PATH;
  if (!p) return null;
  const mod = await import(p);
  return mod.default ?? mod;
}

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
  } catch (e) {
    console.warn('[vercel-shim] writeDeterministic error:', e.message);
  }
}

function backupDir(src, dst) {
  try {
    fs.cpSync(src, dst, { recursive: true, force: true, dereference: false });
    console.log('[vercel-shim] backed up', src, '→', dst);
    return true;
  } catch (e) {
    console.warn('[vercel-shim] backup error:', e.message);
    return false;
  }
}

function restoreDir(src, dst) {
  try {
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(src, dst, { recursive: true, force: false, dereference: false });
    console.log('[vercel-shim] restored', src, '→', dst);
  } catch (e) {
    console.warn('[vercel-shim] restore error:', e.message);
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

    // Make sure the deterministic manifest exists before backup.
    writeDeterministic(distDir);

    // Back up the entire .next directory to a tmp location before Vercel's adapter runs.
    const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'next-backup-'));
    const backedUp = backupDir(distDir, backupRoot);

    try {
      const vercel = await getVercelAdapter();
      if (vercel?.onBuildComplete) {
        await vercel.onBuildComplete(ctx);
      }
    } catch (e) {
      console.warn('[vercel-shim] vercel adapter error:', e.message);
    }

    // Restore anything Vercel's adapter removed.
    if (backedUp) {
      restoreDir(backupRoot, distDir);
      // Also restore to any other path Vercel CLI might read from.
      if (process.env.VERCEL || process.env.NOW_BUILDER) {
        for (const alt of ['/vercel/path0/.next', '/vercel/path0/web/.next']) {
          if (alt !== distDir) restoreDir(backupRoot, alt);
        }
      }
    }

    // Cleanup backup
    try { fs.rmSync(backupRoot, { recursive: true, force: true }); } catch {}
  },
};

module.exports = adapter;
