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

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return false;
  try {
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(src, dst, { recursive: true, force: true, dereference: false });
    return true;
  } catch (e) {
    console.warn('[vercel-shim] copy error', src, '->', dst, ':', e.message);
    return false;
  }
}

function restoreDir(src, dst) {
  if (!fs.existsSync(src)) return;
  try {
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(src, dst, { recursive: true, force: false, dereference: false });
    console.log('[vercel-shim] restored →', dst);
  } catch (e) {
    console.warn('[vercel-shim] restore error:', e.message);
  }
}

function findNextAdapterDir(projectDir) {
  const candidates = [
    path.join(projectDir, 'node_modules/next/dist/build/adapter'),
    path.join(process.cwd(), 'node_modules/next/dist/build/adapter'),
  ];
  if (process.env.VERCEL || process.env.NOW_BUILDER) {
    candidates.push('/vercel/path0/node_modules/next/dist/build/adapter');
    candidates.push('/vercel/path0/web/node_modules/next/dist/build/adapter');
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
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
    const { distDir, projectDir } = ctx;
    console.log('[vercel-shim] onBuildComplete distDir:', distDir, 'projectDir:', projectDir, 'cwd:', process.cwd());

    writeDeterministic(distDir);

    // Back up .next AND the next adapter directory.
    const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'next-backup-'));
    const distBackup = path.join(backupRoot, 'dist');
    const adapterBackup = path.join(backupRoot, 'adapter');

    const distOK = copyDir(distDir, distBackup);
    const adapterSrc = findNextAdapterDir(projectDir || process.cwd());
    const adapterOK = adapterSrc ? copyDir(adapterSrc, adapterBackup) : false;
    console.log('[vercel-shim] backed up dist:', distOK, 'adapter:', adapterOK, 'from', adapterSrc);

    try {
      const vercel = await getVercelAdapter();
      if (vercel?.onBuildComplete) {
        await vercel.onBuildComplete(ctx);
      }
    } catch (e) {
      console.warn('[vercel-shim] vercel adapter error:', e.message);
    }

    // Restore .next
    if (distOK) {
      restoreDir(distBackup, distDir);
      if (process.env.VERCEL || process.env.NOW_BUILDER) {
        for (const alt of ['/vercel/path0/.next', '/vercel/path0/web/.next']) {
          if (alt !== distDir) restoreDir(distBackup, alt);
        }
      }
    }

    // Restore the next adapter directory (setup-node-env.external.js etc.)
    if (adapterOK && adapterSrc) {
      restoreDir(adapterBackup, adapterSrc);
      if (process.env.VERCEL || process.env.NOW_BUILDER) {
        for (const alt of [
          '/vercel/path0/node_modules/next/dist/build/adapter',
          '/vercel/path0/web/node_modules/next/dist/build/adapter',
        ]) {
          if (alt !== adapterSrc) restoreDir(adapterBackup, alt);
        }
      }
    }

    try { fs.rmSync(backupRoot, { recursive: true, force: true }); } catch {}
  },
};

module.exports = adapter;
