'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const bundle = readFileSync(path.join(root, 'script.user.js'), 'utf8');
const metadata = readFileSync(path.join(root, 'src/metadata.js'), 'utf8').trimEnd();

function browser({legacy = false, frame = false, body = true} = {}) {
  const listeners = [];
  const menus = [];
  const saved = [];
  const window = {};
  const document = {body: body ? {} : null};
  let observer;
  const context = {
    console, URL, performance, window, top: frame ? {} : window, document,
    location: new URL(frame ? 'https://www.instagram.com/p/ABC/embed/' : 'https://example.com/'),
    CSS: {supports: () => false},
    addEventListener: (type, handler) => listeners.push({type, handler}),
    MutationObserver: class {
      constructor(callback) { observer = callback; }
      observe(target, options) {
        assert.equal(target, document);
        assert.equal(options.subtree, true);
      }
      disconnect() {}
    },
  };
  const api = {
    info: {script: {name: 'MPIV', version: '1.4.21'}},
    getValue: () => undefined,
    setValue: (key, value) => saved.push({key, value}),
    openInTab() {}, setClipboard() {}, xmlHttpRequest() {},
    registerMenuCommand: (label, handler) => menus.push({label, handler}),
    unregisterMenuCommand() {},
  };
  if (legacy) {
    Object.assign(context, {
      GM_info: api.info,
      GM_getValue: api.getValue, GM_setValue: api.setValue,
      GM_openInTab: api.openInTab, GM_setClipboard: api.setClipboard,
      GM_xmlhttpRequest: api.xmlHttpRequest,
      GM_registerMenuCommand: api.registerMenuCommand,
      GM_unregisterMenuCommand: api.unregisterMenuCommand,
    });
  } else {
    context.GM = {...api, getValue: async () => undefined};
  }
  return {context, listeners, menus, saved, ready() {
    document.body = {};
    observer([], {disconnect() {}});
  }};
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('distribution retains metadata first and is valid standalone JavaScript', () => {
  assert.ok(bundle.startsWith(metadata + '\n'));
  assert.equal((bundle.match(/==UserScript==/g) || []).length, 1);
  assert.match(bundle, /\n'use strict';\n/);
  assert.doesNotMatch(bundle, /\bstate\.(cfg|ai|elSetup|nonce|timerProgress|trustedHTML|trustedScript)\b/);
  assert.doesNotThrow(() => new vm.Script(bundle));
});

for (const legacy of [false, true]) {
  test(`built userscript starts with ${legacy ? 'legacy' : 'modern'} GM APIs`, async () => {
    const {context, listeners, menus, saved} = browser({legacy});
    vm.runInNewContext(bundle, context);
    await settle();
    assert.deepEqual(listeners.map(e => e.type), [
      'mouseover', 'contextmenu', 'keydown', 'visibilitychange', 'blur', 'message',
    ]);
    assert.equal(menus[0].label, 'MPIV: configure');
    assert.equal(typeof menus[0].handler, 'function');
    assert.equal(saved[0].key, 'cfg');
    assert.equal(saved[0].value.version, 6);
    for (const name of ['App', 'Events', 'state', 'Instagram']) {
      assert.equal(context[name], undefined, `${name} must stay inside the bundle`);
    }
  });
}

test('document-start initialization waits for the body', async () => {
  const env = browser({body: false});
  vm.runInNewContext(bundle, env.context);
  await settle();
  assert.equal(env.listeners.length, 0);
  env.ready();
  await settle();
  assert.ok(env.listeners.some(e => e.type === 'mouseover'));
});

test('Instagram iframe startup registers the embed relays without a top-level menu', async () => {
  const env = browser({frame: true});
  vm.runInNewContext(bundle, env.context);
  await settle();
  assert.deepEqual(env.listeners.slice(0, 3).map(e => e.type), [
    'mousemove', 'mouseout', 'mousedown',
  ]);
  assert.equal(env.menus.length, 0);
});

test('native ES modules initialize without relying on bundler variable hoisting', () => {
  execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict'; await (${async () => {
    const listeners = [];
    const window = {};
    Object.assign(globalThis, {
      window, top: window, document: {body: {}},
      location: new URL('https://example.com/'), CSS: {supports: () => false},
      addEventListener: type => listeners.push(type),
      GM: {
        info: {script: {version: '1.4.21'}},
        getValue() {}, setValue() {}, openInTab() {}, setClipboard() {}, xmlHttpRequest() {},
      },
    });
    await import('./src/index.js');
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(listeners.includes('message'));
  }})()`], {cwd: root, stdio: 'pipe'});
});
