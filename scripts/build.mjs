import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build, context} from 'esbuild';
import pkg from '../package.json' with {type: 'json'};

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = root + '/' + pkg.main;
const metadataPath = root + '/src/metadata.js';
const DEPS = 'DEPS';

export async function buildUserscript({check = false, watch = false} = {}) {
  if (check && watch) throw new Error('--check and --watch cannot be combined.');
  const options = {
    absWorkingDir: root,
    entryPoints: ['./src', DEPS],
    outdir: root,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['firefox68', 'chrome86'],
    charset: 'utf8',
    legalComments: 'inline',
    banner: {js: "// Generated from src/ by pnpm run build. Do not edit directly.\n'use strict';"},
    write: false,
    define: {
      PREFIX: '"mpiv-"',
    },
    plugins: [{
      name: 'userscript-output',
      setup(builder) {
        const depsRE = RegExp(`^${DEPS}$`);
        const depsNS = {namespace: DEPS};
        builder.onResolve({filter: depsRE}, () => ({path: DEPS, ...depsNS}));
        builder.onLoad({filter: depsRE, ...depsNS}, () => ({
          contents: '',
          watchFiles: [metadataPath],
        }));
        builder.onEnd(result => {
          if (result.errors.length) return;
          const metadata = readFileSync(metadataPath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
          const output = `${metadata}\n\n${result.outputFiles[0].text}`;
          if (check) {
            const current = readFileSync(destination, 'utf8').replace(/\r\n/g, '\n');
            if (current !== output) throw new Error('script.user.js is stale. Run pnpm run build and commit it.');
          } else {
            writeFileSync(destination, output);
            if (watch) console.log('Built script.user.js; watching for changes.');
          }
        });
      },
    }],
  };
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    return ctx;
  } else {
    await build(options);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const ctx = await buildUserscript({
    check: process.argv.includes('--check'),
    watch: process.argv.includes('--watch'),
  });
  if (ctx) {
    const stop = async () => {
      await ctx.dispose();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}
