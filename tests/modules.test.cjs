'use strict';

const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const source = buildSync({
  stdin: {
    contents: `
      export * as State from './src/state.js';
      export * as Config from './src/config.js';
      export * as App from './src/app.js';
      export * as Util from './src/util.js';
      export * as Rules from './src/rules.js';
      export * as Csp from './src/csp.js';
      export * as PopupVideo from './src/popup-video.js';
    `,
    resolveDir: path.resolve(__dirname, '..'),
  },
  bundle: true, format: 'iife', globalName: 'api', write: false,
  banner: {js: "'use strict';"},
}).outputFiles[0].text;

function setup() {
  const saved = [];
  const window = {};
  const context = vm.createContext({
    console, URL, performance, window, top: window, document: {},
    location: new URL('https://example.com/'), CSS: {supports: () => false},
    GM: {
      info: {script: {version: '1.4.21'}},
      getValue: async () => ({version: 6, css: 'color: red', scales: [2, 1, 2]}),
      setValue: (key, value) => saved.push({key, value}),
      openInTab() {}, setClipboard() {}, xmlHttpRequest() {},
    },
  });
  vm.runInContext(source, context);
  return {...context.api, context, saved};
}

test('configuration factory returns plain objects and migrates stored preferences', () => {
  const {Config, saved, context} = setup();
  const cfg = Config.create({data: JSON.stringify({
    version: 3, close: true, scales: [0, 2, 1, 2], hosts: '', obsolete: true,
  }), save: true});
  assert.equal(cfg.version, 6);
  assert.equal(cfg.zoomOut, 'auto');
  assert.deepEqual([...cfg.scales], ['0!', 1, 2]);
  assert.equal(cfg.obsolete, undefined);
  assert.equal(cfg._getCss, undefined);
  assert.equal(saved[0].key, 'cfg');
  assert.equal(saved[0].value.version, 6);
  assert.equal(vm.runInContext('Object.getPrototypeOf(api.Config.create({})) === Object.prototype', context), true);
});

test('configuration loading and CSS formatting preserve their behavior', async () => {
  const {Config, State, App} = setup();
  const cfg = await Config.load({save: true});
  assert.deepEqual([...cfg.scales], [1, 2]);
  assert.equal(Config.getCss(cfg), '#mpiv--popup {color: red}');
  assert.equal(Config.getCss({css: 'img {opacity: .5}'}), 'img {opacity: .5}');
  State.setCfg(cfg);
  App.setGlobalStyle('cached style');
  Config.create({data: {...cfg, css: 'color: blue'}});
  assert.equal(App.globalStyle, '');
});

test('setters return their values and consumers observe replaced live bindings', () => {
  const {State, Util, Rules} = setup();
  State.setCfg({uiBackgroundColor: '#112233', uiBackgroundOpacity: 100});
  assert.equal(Util.color('Background'), '#112233ff');
  const cfg = {uiBackgroundColor: '#aabbcc', uiBackgroundOpacity: 50};
  assert.equal(State.setCfg(cfg), cfg);
  assert.equal(Util.color('Background'), '#aabbcc80');
  const first = {rule: {c: text => text}, node: {}};
  const second = {rule: {c: text => text.toUpperCase()}, node: {}};
  assert.equal(State.setAi(first), first);
  Rules.runC('first', {});
  State.setAi(second);
  Rules.runC('second', {});
  assert.equal(first.caption, 'first');
  assert.equal(second.caption, 'SECOND');
  assert.equal(State.ai, second);
});

test('extracted callbacks retain their caller-provided receiver', () => {
  const {Csp, PopupVideo, saved} = setup();
  assert.equal(Csp._srcMatches.call('https://example.com/image.jpg', "'self'"), true);
  assert.equal(Csp._srcMatches.call('https://other.example/image.jpg', "'self'"), false);
  PopupVideo.rememberVolume.call({volume: 0.25});
  assert.deepEqual(saved, [{key: 'volume', value: 0.25}]);
});
