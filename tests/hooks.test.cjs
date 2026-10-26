'use strict';

const assert = require('node:assert/strict');
const {execFileSync, spawnSync} = require('node:child_process');
const {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');

const root = path.resolve(__dirname, '..');

function fixture(t) {
  // Keep the fixture below the project so build.mjs can resolve installed dependencies.
  const base = path.join(root, '.build-test');
  mkdirSync(base, {recursive: true});
  const dir = mkdtempSync(path.join(base, 'hooks-'));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(base) + path.sep));
    rmSync(dir, {recursive: true, force: true});
  });
  for (const name of ['src', 'scripts', '.githooks', 'package.json', 'package-lock.json', 'jsconfig.json']) {
    cpSync(path.join(root, name), path.join(dir, name), {recursive: true});
  }
  const git = (...args) => execFileSync('git', args, {cwd: dir, encoding: 'utf8'}).trim();
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  git('add', '.');
  const run = name => spawnSync(process.execPath, [`scripts/${name}.mjs`], {cwd: dir, encoding: 'utf8'});
  return {dir, git, run};
}

test('pre-commit builds and stages the distribution from fully staged inputs', t => {
  const {dir, git, run} = fixture(t);
  const result = run('pre-commit');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('show', ':script.user.js'), readFileSync(path.join(dir, 'script.user.js'), 'utf8').trim());
  assert.equal(run('build').status, 0);
  assert.equal(git('diff', '--name-only'), '');
});

test('pre-commit refuses partial staging and leaves the staged bundle untouched', t => {
  const {dir, git, run} = fixture(t);
  assert.equal(run('pre-commit').status, 0);
  const before = git('show', ':script.user.js');
  const file = path.join(dir, 'src/constants.js');
  writeFileSync(file, readFileSync(file, 'utf8') + '\n// unstaged edit\n');
  const result = run('pre-commit');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unstaged or untracked/);
  assert.equal(git('show', ':script.user.js'), before);
});

test('pre-commit rejects untracked source files', t => {
  const {dir, run} = fixture(t);
  writeFileSync(path.join(dir, 'src/untracked.js'), 'export const example = 1;\n');
  const result = run('pre-commit');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unstaged or untracked/);
});

test('hook installation is repeatable and preserves a custom hooks path', t => {
  const {git, run} = fixture(t);
  assert.equal(run('install-hooks').status, 0);
  assert.equal(run('install-hooks').status, 0);
  assert.equal(git('config', '--get', 'core.hooksPath'), '.githooks');
  git('config', 'core.hooksPath', 'custom-hooks');
  assert.notEqual(run('install-hooks').status, 0);
  assert.equal(git('config', '--get', 'core.hooksPath'), 'custom-hooks');
});

test('hook installation preserves other existing Git hooks', t => {
  const {dir, run} = fixture(t);
  const hook = path.join(dir, '.git/hooks/pre-push');
  writeFileSync(hook, '#!/bin/sh\necho existing\n');
  const result = run('install-hooks');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Existing Git hooks/);
  assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\necho existing\n');
});
