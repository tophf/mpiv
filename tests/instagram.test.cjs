'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../script.user.js'), 'utf8');
const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const rect = {left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300};

// Small DOM doubles keep the extraction tests runnable without a browser or dependencies.
function element(tag, props = {}, children = []) {
  const el = {
    tagName: tag.toUpperCase(), children, dataset: {}, ...props,
    getBoundingClientRect() { return props.rect || rect; },
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim();
        if (/^[a-z]+$/i.test(part)) return this.tagName === part.toUpperCase();
        if (part.startsWith('a[href*='))
          return this.tagName === 'A' && this.href.includes(part.match(/"([^"]+)"/)[1]);
        if (part === '[role="dialog"]') return this.role === 'dialog';
        if (part.startsWith('meta['))
          return this.tagName === 'META' && this.property === part.match(/"([^"]+)"/)[1];
        if (part.startsWith('script[')) return this.tagName === 'SCRIPT';
        return false;
      });
    },
    closest(selector) {
      return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
    },
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  children.forEach(child => { child.parentElement = el; });
  return el;
}

function setup(hostname = 'www.instagram.com') {
  const context = vm.createContext({
    console, URL, URLSearchParams, performance,
    doc: element('html'), cfg: {hosts: [], xhr: true}, ai: {rule: {}}, nonce: '',
    hostname, dotDomain: '.' + hostname,
    location: new URL('https://' + hostname + '/'), isSecureContext: true,
    arrayFrom: Array.from, isArray: Array.isArray, SYM_U: Symbol('u'),
    RX_MEDIA_URL: /\.(?:jpg|png|mp4|webm)(?:[?#]|$)/i,
    Util: {
      isVideoUrlExt: url => /\.(?:mp4|webm)(?:[?#]|$)/i.test(url),
      decodeUrl: url => url,
      rel2abs: url => new URL(url, 'https://' + hostname + '/').href,
    },
    Gallery: {makeParser: fn => fn},
  });
  vm.runInContext([
    section('const Instagram = {', 'const Req = {'),
    section('const UrlMatcher =', 'const Util = {'),
    section('const clamp =', '//#region Init'),
    'Ruler.init(); globalThis.api = {Instagram, Ruler, RuleMatcher};',
  ].join('\n'), context);
  return context.api;
}

test('largest srcset candidate wins regardless of order; signed query is preserved', () => {
  const {Instagram} = setup();
  const big = 'https://cdn.example/big.jpg?sig=abc&size=1080';
  assert.equal(Instagram.source(element('img', {
    src: 'https://cdn.example/small.jpg',
    srcset: `${big} 1080w, https://cdn.example/small.jpg 320w`,
  })), big);
  assert.equal(Instagram.source(element('img', {
    srcset: `${big} 2x, https://cdn.example/small.jpg 1x`,
  })), big);
});

test('currentSrc fallback and placeholder rejection', () => {
  const {Instagram} = setup();
  assert.equal(Instagram.source(element('img', {
    currentSrc: 'https://cdn.example/photo.jpg', src: 'data:image/gif;base64,AA',
  })), 'https://cdn.example/photo.jpg');
  assert.equal(Instagram.source(element('img', {src: 'data:image/gif;base64,AA'})), undefined);
});

test('direct videos and source children work; MediaSource falls back to the poster', () => {
  const {Instagram} = setup();
  assert.equal(Instagram.source(element('video', {src: 'https://cdn.example/reel.mp4'})),
    'https://cdn.example/reel.mp4');
  assert.equal(Instagram.source(element('video', {}, [
    element('source', {src: 'https://cdn.example/reel.webm'}),
  ])), 'https://cdn.example/reel.webm');
  assert.equal(Instagram.source(element('video', {
    currentSrc: 'blob:https://www.instagram.com/stream', poster: 'https://cdn.example/poster.jpg',
  })), 'https://cdn.example/poster.jpg');
});

test('overlay resolves its sibling image but a caption below it does not', () => {
  const {Instagram} = setup();
  const img = element('img', {src: 'https://cdn.example/post.jpg'});
  const overlay = element('div');
  const caption = element('div', {rect: {...rect, top: 310, bottom: 350, height: 40}});
  element('article', {}, [element('div', {}, [img, overlay]), caption]);
  const rule = {};
  assert.equal(Instagram.preview(null, overlay, rule), img.src);
  assert.equal(rule._img, img);
  assert.equal(Instagram.preview(null, caption, rule), false);
  assert.equal(rule._img, undefined);
});

test('local Reel thumbnails avoid a remote request; empty links follow the post rule', () => {
  const {Instagram} = setup();
  const rule = {};
  const link = element('a', {href: 'https://www.instagram.com/reel/ABC/'}, [
    element('img', {src: 'https://cdn.example/reel.jpg'}),
  ]);
  assert.equal(Instagram.preview(null, link, rule), 'https://cdn.example/reel.jpg');
  assert.equal(rule.follow, false);
  link.children = [];
  assert.equal(Instagram.preview(null, link, rule), link.href);
  assert.equal(rule.follow, true);
});

test('post/TV/Reel URLs normalize without a trailing slash, including username paths', () => {
  const {RuleMatcher} = setup('example.org');
  for (const path of ['p/ABC', 'tv/ABC/', 'reel/ABC?igsh=123', 'reels/ABC/#x', 'user/p/ABC']) {
    const url = 'https://www.instagram.com/' + path;
    const info = RuleMatcher.adaptiveFind(element('a', {href: url}));
    assert.ok(info.gallery, path);
    assert.equal(info.url, 'https://www.instagram.com/' + path.match(/(p|tv|reels?)\/ABC/)[0] + '/');
  }
  assert.ok(RuleMatcher.adaptiveFind(element('a', {href: 'https://instagr.am/p/ABC'})).gallery);
  assert.equal(RuleMatcher.adaptiveFind(element('a', {href: 'https://evilinstagram.com/p/ABC'})), undefined);
  assert.equal(RuleMatcher.adaptiveFind(element('a', {href: 'https://instagram.com/reels/audio/123/'})), undefined);
  assert.equal(RuleMatcher.adaptiveFind(element('a', {href: 'https://instagram.com/accounts/login/?next=/p/ABC/'})), undefined);
});

test('Instagram registration previews images without affecting another site', () => {
  const img = element('img', {
    src: 'https://cdn.example/small.jpg',
    srcset: 'https://cdn.example/large.jpg 1080w, https://cdn.example/small.jpg 320w',
  });
  assert.equal(setup().RuleMatcher.adaptiveFind(img).url, 'https://cdn.example/large.jpg');
  assert.equal(setup('example.org').RuleMatcher.adaptiveFind(img).url, img.src);
});

test('embedded modern carousel data keeps image/video order and chooses largest versions', () => {
  const {Instagram} = setup();
  const data = {data: {xdt_shortcode_media: {
    code: 'ABC', caption: {text: 'Album caption'}, carousel_media: [
      {image_versions2: {candidates: [
        {url: 'https://cdn.example/small.jpg', width: 100, height: 100},
        {url: 'https://cdn.example/large.jpg', width: 1080, height: 1080},
      ]}},
      {video_versions: [{url: 'https://cdn.example/video.mp4', width: 1080, height: 1920}]},
      {},
    ],
  }}};
  const doc = element('html', {}, [element('script', {textContent: JSON.stringify(data)})]);
  const items = Instagram.gallery('<html>', doc, '', ['', '', 'ABC']);
  assert.deepEqual(Array.from(items, item => item.url), [
    'https://cdn.example/large.jpg', 'https://cdn.example/video.mp4',
  ]);
  assert.equal(items.title, 'Album caption');
});

test('legacy GraphQL carousel and a single JSON post are parsed', () => {
  const {Instagram} = setup();
  const data = {graphql: {shortcode_media: {shortcode: 'ABC',
    edge_sidecar_to_children: {edges: [
      {node: {display_url: 'https://cdn.example/photo.jpg'}},
      {node: {video_url: 'https://cdn.example/video.mp4'}},
    ]},
  }}};
  assert.equal(Instagram.gallery(JSON.stringify(data), element('html'), '', ['', '', 'ABC']).length, 2);
  const single = {items: [{code: 'ABC', display_url: 'https://cdn.example/single.jpg'}]};
  assert.equal(Instagram.gallery(JSON.stringify(single), element('html'), '', ['', '', 'ABC'])[0].url,
    'https://cdn.example/single.jpg');
});

test('unrelated posts are ignored; Open Graph video takes precedence over its image', () => {
  const {Instagram} = setup();
  const doc = element('html', {}, [
    element('script', {textContent: JSON.stringify({code: 'OTHER', display_url: 'https://cdn.example/wrong.jpg'})}),
    element('meta', {property: 'og:image', content: 'https://cdn.example/poster.jpg'}),
    element('meta', {property: 'og:video', content: 'https://cdn.example/video.mp4'}),
    element('meta', {property: 'og:description', content: 'Video caption'}),
  ]);
  const items = Instagram.gallery('', doc, '', ['', '', 'ABC']);
  assert.equal(items[0].url, 'https://cdn.example/video.mp4');
  assert.equal(items.title, 'Video caption');
});

test('login pages and malformed/empty responses yield an empty gallery without throwing', () => {
  const {Instagram} = setup();
  for (const text of ['<html>Log in</html>', '{}', '{broken', 'null']) {
    const items = Instagram.gallery(text, element('html'), '', ['', '', 'ABC']);
    assert.equal(items.length, 0);
  }
});
