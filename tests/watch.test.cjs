'use strict';

const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');

test('watch rebuilds source and metadata, preserves good output on error, and recovers', async t => {
  const root = path.resolve(__dirname, '..');
  const base = path.join(root, '.build-test');
  mkdirSync(base, {recursive: true});
  const dir = mkdtempSync(path.join(base, 'watch-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      await closed;
    }
    assert.ok(path.resolve(dir).startsWith(path.resolve(base) + path.sep));
    rmSync(dir, {recursive: true, force: true});
  });
  for (const name of ['src', 'scripts', 'package.json', 'jsconfig.json']) {
    cpSync(path.join(root, name), path.join(dir, name), {recursive: true});
  }
  child = spawn(process.execPath, ['scripts/build.mjs', '--watch'], {cwd: dir});
  let output = '';
  let check;
  child.stdout.on('data', data => { output += data; check?.(); });
  child.stderr.on('data', data => { output += data; check?.(); });
  async function waitFor(predicate) {
    if (predicate(output)) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        check = undefined;
        reject(new Error(`Watcher did not reach expected state:\n${output}`));
      }, 15000);
      check = () => {
        if (predicate(output)) {
          clearTimeout(timer);
          check = undefined;
          resolve();
        }
      };
    });
  }
  const built = count => text => text.split('Built script.user.js;').length - 1 >= count;
  const bundle = () => readFileSync(path.join(dir, 'script.user.js'), 'utf8');
  await waitFor(built(1));
  const src = path.join(dir, 'src/index.js');
  const originalSrc = readFileSync(src, 'utf8');
  writeFileSync(src, originalSrc + '\nconsole.info("watch-source-change");\n');
  await waitFor(built(2));
  assert.match(bundle(), /watch-source-change/);
  const metadata = path.join(dir, 'src/metadata.js');
  writeFileSync(metadata, readFileSync(metadata, 'utf8')
    .replace(/^(\/\/ @version\s+).+$/m, (_, prefix) => prefix + '99.0.0'));
  await waitFor(built(3));
  assert.match(bundle(), /@version\s+99\.0\.0/);
  const good = bundle();
  writeFileSync(src, 'export const = ;\n');
  await waitFor(text => text.includes('ERROR'));
  assert.equal(bundle(), good);
  writeFileSync(src, originalSrc);
  await waitFor(built(4));
  assert.doesNotMatch(bundle(), /watch-source-change/);
  assert.match(bundle(), /@version\s+99\.0\.0/);
});
