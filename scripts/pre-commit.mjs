import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildUserscript} from './build.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const inputs = ['src', 'scripts', 'package.json', 'package-lock.json', 'jsconfig.json', 'script.user.js'];
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});

// Never pull unstaged source edits into the generated file being committed.
if (git('diff', '--name-only', '--', ...inputs).trim() ||
    git('ls-files', '--others', '--exclude-standard', '--', ...inputs).trim()) {
  throw new Error('Build inputs have unstaged or untracked changes. Stage them or stash them before committing.');
}
await buildUserscript();
git('add', '--', 'script.user.js');
