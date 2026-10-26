import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildUserscript({check = false} = {}) {
  const metadata = (await readFile(new URL('../src/metadata.txt', import.meta.url), 'utf8'))
    .replace(/\r\n/g, '\n').trimEnd();
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2018',
    charset: 'utf8',
    legalComments: 'inline',
    banner: {js: `${metadata}\n\n// Generated from src/ by npm run build. Do not edit directly.\n'use strict';`},
    write: false,
  });
  const output = result.outputFiles[0].text;
  const destination = new URL('../script.user.js', import.meta.url);
  if (check) {
    const current = (await readFile(destination, 'utf8')).replace(/\r\n/g, '\n');
    if (current !== output) throw new Error('script.user.js is stale. Run npm run build and commit it.');
  } else {
    await writeFile(destination, output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildUserscript({check: process.argv.includes('--check')});
}
