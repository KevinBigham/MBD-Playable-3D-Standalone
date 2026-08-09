import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { serializeBallparkAsset, validateBallparkAsset } from '../../src/ballpark/contract';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGING_ROOT = path.join(REPOSITORY_ROOT, 'ballpark-staging');

function stagingApi(): Plugin {
  return {
    name: 'mbd-ballpark-staging-api',
    configureServer(server) {
      server.middlewares.use('/api/stage', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end('POST required');
          return;
        }
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 1_000_000) request.destroy(new Error('request too large'));
        });
        request.on('end', () => {
          void (async () => {
            let value: unknown;
            try {
              value = JSON.parse(body) as unknown;
            } catch {
              response.statusCode = 400;
              response.end(JSON.stringify({ ok: false, errors: [{ path: '$', message: 'Invalid JSON.' }] }));
              return;
            }
            const validation = validateBallparkAsset(value);
            if (!validation.ok) {
              response.statusCode = 422;
              response.setHeader('content-type', 'application/json');
              response.end(JSON.stringify(validation));
              return;
            }
            await mkdir(STAGING_ROOT, { recursive: true });
            const target = path.join(STAGING_ROOT, `${validation.asset.stadium.id}.json`);
            const temporary = path.join(STAGING_ROOT, `.${validation.asset.stadium.id}.${randomUUID()}.tmp`);
            try {
              await writeFile(temporary, serializeBallparkAsset(validation.asset), { encoding: 'utf8', flag: 'wx' });
              await rename(temporary, target);
            } finally {
              await rm(temporary, { force: true });
            }
            response.statusCode = 200;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: true, path: path.relative(REPOSITORY_ROOT, target) }));
          })().catch((error: unknown) => {
            response.statusCode = 500;
            response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
          });
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), stagingApi()],
  server: { port: 5184, strictPort: true },
  // The published viewer/editor sources retain Next's compile-time env reads.
  // Supply only the public values they reference; do not expose the host env.
  define: {
    'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development'),
    'process.env.NEXT_PUBLIC_ASSETS_CDN_URL': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_VERCEL_ENV': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_APP_URL': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_VERCEL_URL': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL': JSON.stringify(''),
    'process.env.PORT': JSON.stringify('5184'),
  },
  // Pascal's editor imports named exports from Howler's UMD entry point.
  // Because the published Pascal packages ship source TypeScript, Vite's
  // initial dependency scan does not discover that transitive import. Force
  // the CommonJS/UMD interop prebundle so the dev server matches production.
  optimizeDeps: {
    include: [
      'howler',
      'next/image',
      'next/link',
      'scheduler',
      'use-sync-external-store/shim/with-selector',
      'use-sync-external-store/shim/with-selector.js',
    ],
  },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'node',
    server: {
      deps: {
        inline: [/@pascal-app\//],
      },
    },
  },
}));
