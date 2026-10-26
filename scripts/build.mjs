import {readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build, context} from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildUserscript({check = false, watch = false} = {}) {
  if (check && watch) throw new Error('--check and --watch cannot be combined.');
  const metadataPath = resolve(root, 'src/metadata.js');
  const options = {
    absWorkingDir: root,
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2018',
    charset: 'utf8',
    legalComments: 'inline',
    banner: {js: "// Generated from src/ by npm run build. Do not edit directly.\n'use strict';"},
    write: false,
    plugins: [{
      name: 'userscript-output',
      setup(builder) {
        // Include the metadata file in esbuild's dependency watcher.
        builder.onLoad({filter: /[/\\]src[/\\]main\.js$/}, async args => ({
          contents: await readFile(args.path, 'utf8'),
          resolveDir: dirname(args.path),
          watchFiles: [metadataPath],
        }));
        builder.onEnd(async result => {
          if (result.errors.length) return;
          const metadata = (await readFile(metadataPath, 'utf8')).replace(/\r\n/g, '\n').trimEnd();
          const output = `${metadata}\n\n${result.outputFiles[0].text}`;
          const destination = new URL('../script.user.js', import.meta.url);
          if (check) {
            const current = (await readFile(destination, 'utf8')).replace(/\r\n/g, '\n');
            if (current !== output) throw new Error('script.user.js is stale. Run npm run build and commit it.');
          } else {
            await writeFile(destination, output);
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
