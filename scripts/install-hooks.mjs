import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
let current = '';
try {
  current = execFileSync('git', ['config', '--get', 'core.hooksPath'], {encoding: 'utf8'}).trim();
} catch (error) {
  if (error.status !== 1) throw error;
}
if (current && current !== '.githooks') {
  throw new Error(`Existing core.hooksPath is ${current}. Add "node scripts/pre-commit.mjs" to your existing pre-commit hook.`);
}
if (!current) {
  const hooks = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {encoding: 'utf8'}).trim();
  if (existsSync(hooks) && readdirSync(hooks).some(name => !name.endsWith('.sample'))) {
    throw new Error('Existing Git hooks were found. Add "node scripts/pre-commit.mjs" to your pre-commit hook instead.');
  }
}
chmodSync('.githooks/pre-commit', 0o755);
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks']);
console.log('Installed the MPIV pre-commit build hook.');
