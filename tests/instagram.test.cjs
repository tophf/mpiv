'use strict';

const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const source = buildSync({
  absWorkingDir: path.resolve(__dirname, '..'),
  stdin: {
    contents: `
      export * as Instagram from './src/instagram.js';
      export {Ruler} from './src/rules.js';
      export {RuleMatcher} from './src/rule-matcher.js';
      export {state} from './src/state.js';
      export {App} from './src/app.js';
      export {Events} from './src/events.js';
    `,
    resolveDir: path.resolve(__dirname, '..'),
  },
  bundle: true, format: 'iife', globalName: 'api', write: false,
}).outputFiles[0].text;
const rect = {left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300};

// Small DOM doubles keep the extraction tests runnable without a browser or dependencies.
function element(tag, props = {}, children = []) {
  const el = {
    tagName: tag.toUpperCase(), children, dataset: {}, ...props,
    getBoundingClientRect() { return props.rect || rect; },
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim();
        if (part.startsWith('.') && part.includes(' ')) {
          const [parent, tag] = part.split(' ');
          return this.matches(tag) && !!this.parentElement?.closest(parent);
        }
        if (part.startsWith('.')) return (this.className || '').split(' ').includes(part.slice(1));
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
    contains(node) {
      return node === this || this.children.some(child => child.contains(node));
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

function setup(hostname = 'www.instagram.com', path = '/', globals = {}) {
  const pageWindow = {};
  const doc = globals.doc || element('html');
  const context = vm.createContext({
    console, URL, URLSearchParams, performance,
    window: pageWindow, top: pageWindow,
    document: doc, CSS: {supports: () => false},
    GM: {getValue() {}, setValue() {}, openInTab() {}, setClipboard() {}, xmlHttpRequest() {}},
    location: new URL('https://' + hostname + path), isSecureContext: true,
    ...globals,
  });
  vm.runInContext(source, context);
  Object.assign(context.api.state, {cfg: {hosts: [], xhr: true}, ai: {rule: {}}, nonce: ''});
  if (globals.ai) context.api.state.ai = globals.ai;
  if (globals.App) Object.assign(context.api.App, globals.App);
  if (globals.Events) Object.assign(context.api.Events, globals.Events);
  context.api.Ruler.init();
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

test('direct videos and source children work; MediaSource does not masquerade as a photo', () => {
  const {Instagram} = setup();
  assert.equal(Instagram.source(element('video', {src: 'https://cdn.example/reel.mp4'})),
    'https://cdn.example/reel.mp4');
  assert.equal(Instagram.source(element('video', {}, [
    element('source', {src: 'https://cdn.example/reel.webm'}),
  ])), 'https://cdn.example/reel.webm');
  assert.equal(Instagram.source(element('video', {
    currentSrc: 'blob:https://www.instagram.com/stream', poster: 'https://cdn.example/poster.jpg',
  })), undefined);
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

test('Reel covers resolve the playable embed, and rule state resets on the next photo', () => {
  const {Instagram} = setup();
  const rule = {};
  const link = element('a', {href: 'https://www.instagram.com/reel/ABC/'}, [
    element('img', {src: 'https://cdn.example/reel.jpg'}),
  ]);
  assert.equal(Instagram.preview(null, link, rule), 'https://www.instagram.com/p/ABC/embed/captioned/');
  assert.equal(rule.follow, false);
  assert.equal(rule.q, Instagram.embedSource);
  const photo = element('img', {src: 'https://cdn.example/photo.jpg'});
  assert.equal(Instagram.preview(null, photo, rule), photo.src);
  assert.equal(rule.q, null);
  assert.equal(rule._postUrl, null);
  link.href = 'https://www.instagram.com/p/ABC/';
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
    assert.equal(info.url, 'https://www.instagram.com/p/ABC/embed/captioned/');
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

const s9eSrc = 'https://s9e.github.io/iframe/2/instagram.min.html#DeehMyFiD_7';
const embedSrc = 'https://www.instagram.com/p/DeehMyFiD_7/embed/captioned/';

test('forum iframe resolves the supplied s9e URL to Instagram embed media', () => {
  const {Instagram, RuleMatcher} = setup('forum.example');
  for (const src of [s9eSrc, embedSrc + '?cr=1&wp=540']) {
    const info = RuleMatcher.adaptiveFind(element('iframe', {src}));
    assert.equal(info.url, embedSrc);
    assert.equal(info.rule.q, Instagram.embedSource);
  }
  assert.equal(RuleMatcher.adaptiveFind(element('iframe', {src: 'https://example.org/other'})), undefined);
  assert.equal(Instagram.embedUrl('https://s9e.github.io/iframe/2/instagram.min.html#bad/code'), '');
  assert.equal(Instagram.embedUrl('https://evilinstagram.com/p/ABC/embed/'), '');
  assert.equal(Instagram.embedUrl('https://s9e.github.io/iframe/2/youtube.min.html#ABC'), '');
});

test('embed extraction selects the full-size post, not the profile picture', () => {
  const {Instagram} = setup();
  const doc = element('html', {}, [
    element('img', {src: 'https://cdn.example/avatar.jpg'}),
    element('a', {className: 'EmbeddedMedia'}, [element('img', {
      className: 'EmbeddedMediaImage', alt: 'Instagram post',
      src: 'https://cdn.example/post.jpg',
      srcset: 'https://cdn.example/full.jpg?sig=abc 3072w,https://cdn.example/small.jpg 640w',
    })]),
  ]);
  assert.equal(Instagram.embedSource('', doc), 'https://cdn.example/full.jpg?sig=abc');
  assert.equal(Instagram.embedSource('', element('html')), undefined);
});

function videoEmbed(data) {
  const context = {context: {type: 'GraphVideo', shortcode: 'Deo2oFMIa9j'},
    gql_data: {shortcode_media: {shortcode: 'Deo2oFMIa9j', is_video: true,
      display_url: 'https://cdn.example/poster.jpg', ...data}}};
  return '<script>requireLazy([], function() { bootstrap(' + JSON.stringify({require: [
    ['PolarisEmbedSimple', 'init', [], [{contextJSON: JSON.stringify(context)}]],
  ]}) + '); });</script>';
}

test('video embed JSON supplies the movie even when the HTML contains only its first frame', () => {
  const {Instagram} = setup();
  const url = 'https://cdn.example/movie.mp4?sig=abc&token=a%2Fb';
  const html = videoEmbed({video_url: url});
  const doc = element('html', {}, [
    element('img', {className: 'EmbeddedMediaImage', src: 'https://cdn.example/poster.jpg'}),
  ]);
  const frame = element('iframe', {
    src: 'https://s9e.github.io/iframe/2/instagram.min.html#Deo2oFMIa9j',
  });
  assert.equal(Instagram.embedSource(html, doc, frame), url);
  assert.equal(Instagram.gallery(html, doc, '', ['', '', 'Deo2oFMIa9j'])[0].url, url);
  assert.equal(Instagram.mediaData(html, doc, 'ANOTHER'), undefined);
});

test('video variants use the largest playable source and preserve signed URLs', () => {
  const {Instagram} = setup();
  const html = videoEmbed({video_versions: [
    {url: 'https://cdn.example/small.mp4', width: 360, height: 640},
    {url: 'https://cdn.example/full.mp4?sig=x%2By', width: 1080, height: 1920},
  ]});
  assert.equal(Instagram.embedSource(html, element('html'), {
    src: 'https://www.instagram.com/p/Deo2oFMIa9j/embed/captioned/',
  }), 'https://cdn.example/full.mp4?sig=x%2By');
});

test('a video without a playable URL reports an error instead of showing its poster', () => {
  const {Instagram} = setup();
  const html = videoEmbed({});
  const doc = element('html', {}, [
    element('img', {className: 'EmbeddedMediaImage', src: 'https://cdn.example/poster.jpg'}),
  ]);
  assert.throws(() => Instagram.embedSource(html, doc, {
    src: 'https://www.instagram.com/p/Deo2oFMIa9j/embed/captioned/',
  }), /did not provide a playable video/);
  assert.throws(() => Instagram.gallery(html, doc, '', ['', '', 'Deo2oFMIa9j']),
    /did not provide a playable video/);
});

test('a MediaSource player in the feed requests video from its own post embed', () => {
  const {Instagram} = setup();
  const player = element('video', {
    currentSrc: 'blob:https://www.instagram.com/stream', poster: 'https://cdn.example/poster.jpg',
  });
  element('article', {}, [
    player, element('a', {href: 'https://www.instagram.com/p/Deo2oFMIa9j/'}),
  ]);
  const rule = {};
  assert.equal(Instagram.preview(null, player, rule),
    'https://www.instagram.com/p/Deo2oFMIa9j/embed/captioned/');
  assert.equal(rule.q, Instagram.embedSource);
  assert.equal(rule.q(videoEmbed({video_url: 'https://cdn.example/movie.mp4'}),
    element('html'), player, rule), 'https://cdn.example/movie.mp4');
});

function message(source, action = 'mouseover', origin = 'https://s9e.github.io') {
  return {source, origin, data: {
    type: 'mpiv-instagram-embed', action, clientX: 20, clientY: 30,
    width: 540, height: 725, shiftKey: false, ctrlKey: false,
  }};
}

test('forum receives hover only from its real embed and translates coordinates', () => {
  const child = {};
  const frame = element('iframe', {src: s9eSrc, contentWindow: child,
    rect: {...rect, left: 100, top: 200, width: 540, height: 725}});
  const hovers = [];
  const {Instagram} = setup('forum.example', '/', {
    doc: element('html', {}, [frame]), Events: {onMouseOver: e => hovers.push(e)},
  });
  Instagram.onEmbedMessage(message(child));
  assert.equal(hovers.length, 1);
  assert.equal(hovers[0].target, frame);
  assert.equal(hovers[0].clientX, 120);
  assert.equal(hovers[0].clientY, 230);
  Instagram.onEmbedMessage(message({}));
  Instagram.onEmbedMessage(message(child, 'mouseover', 'https://evil.example'));
  const bad = message(child);
  bad.data.width = 0;
  Instagram.onEmbedMessage(bad);
  assert.equal(hovers.length, 1);
});

test('s9e relays the nested Instagram hover to the forum', () => {
  const child = {};
  const frame = element('iframe', {src: embedSrc, contentWindow: child,
    rect: {...rect, width: 540, height: 725}});
  const messages = [];
  const {Instagram} = setup('s9e.github.io', '/iframe/2/instagram.min.html#DeehMyFiD_7', {
    window: {}, top: {}, innerWidth: 540, innerHeight: 725,
    doc: element('html', {}, [frame]),
    parent: {postMessage: data => messages.push(data)},
  });
  Instagram.onEmbedMessage(message(child, 'mouseover', 'https://www.instagram.com'));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].clientX, 20);
  assert.equal(messages[0].clientY, 30);
  assert.equal(messages[0].action, 'mouseover');
});

test('embed sends media hover/leave while ignoring profile and caption areas', () => {
  const messages = [];
  const {Instagram} = setup('www.instagram.com', '/p/DeehMyFiD_7/embed/captioned/', {
    window: {}, top: {}, innerWidth: 540, innerHeight: 725,
    addEventListener() {}, parent: {postMessage: data => messages.push(data)},
  });
  Instagram.initEmbed();
  const img = element('img');
  const media = element('a', {className: 'EmbeddedMedia'}, [img]);
  const caption = element('div');
  const hover = target => ({type: 'mouseover', target, clientX: 10, clientY: 20});
  Instagram.relayEmbedEvent(hover(caption));
  assert.equal(messages.length, 0);
  Instagram.relayEmbedEvent(hover(img));
  Instagram.relayEmbedEvent({type: 'mouseout', target: img, relatedTarget: media});
  assert.equal(messages.length, 1);
  Instagram.relayEmbedEvent({type: 'mouseout', target: media, relatedTarget: caption});
  assert.equal(messages[1].action, 'mouseout');
});

test('embed exit cancels pending hover and active preview; Shift preserves it', () => {
  const child = {};
  const frame = element('iframe', {src: s9eSrc, contentWindow: child});
  let cancelled = 0, closed = 0;
  const {Instagram} = setup('forum.example', '/', {
    doc: element('html', {}, [frame]), ai: {node: frame},
    Events: {hoverData: {node: frame}, onMouseOutThrottled() { cancelled++; }},
    App: {canClose: () => true, deactivate() { closed++; }},
  });
  Instagram.onEmbedMessage(message(child, 'mouseout'));
  assert.equal(cancelled, 1);
  assert.equal(closed, 1);
  const shift = message(child, 'mouseout');
  shift.data.shiftKey = true;
  Instagram.onEmbedMessage(shift);
  assert.equal(closed, 1);
});
