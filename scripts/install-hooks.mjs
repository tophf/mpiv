import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const COPY = `Copy ".githooks/pre-commit" to your existing hooks.`;
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
let current = '';
try {
  current = git('config', '--get', 'core.hooksPath');
} catch (error) {
  if (error.status !== 1) throw error;
}
if (current && current !== '.githooks') {
  throw new Error(`Existing core.hooksPath is ${current}. ${COPY}`);
}
if (!current) {
  const hooks = git('rev-parse', '--git-path', 'hooks');
  if (existsSync(hooks) && readdirSync(hooks).some(name => !name.endsWith('.sample'))) {
    throw new Error('Existing Git hooks were found. ' + COPY);
  }
}
chmodSync('.githooks/pre-commit', 0o755);
git('config', '--local', 'core.hooksPath', '.githooks');
console.log('Installed the MPIV pre-commit build hook.');
