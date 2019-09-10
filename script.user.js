// ==UserScript==
// @name        Mouseover Popup Image Viewer
// @namespace   https://w9p.co/userscripts/
// @description Shows images and videos behind links and thumbnails.

// @include     http*
// @connect-src *

// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_download
// @grant       GM_openInTab
// @grant       GM_registerMenuCommand
// @grant       GM_setClipboard

// @version     1.0.6
// @author      tophf

// @original-version 2017.9.29
// @original-author  kuehlschrank

// @homepage    https://w9p.co/userscripts/mpiv/
// @icon        https://w9p.co/userscripts/mpiv/icon.png
// ==/UserScript==

'use strict';

const doc = document;
const hostname = location.hostname;
const hostnamePinned = '.' + hostname;
const trusted = ['greasyfork.org', 'w9p.co'];
const isImageTab = doc.images.length === 1 &&
                   doc.images[0].parentNode === doc.body &&
                   !doc.links.length;
const SETUP_ID = 'mpiv-setup:host';

let cfg = loadCfg();
let enabled = cfg.imgtab || !isImageTab;
let app = {};
let hostRules;
let domParser;

on(doc, 'mouseover', onMouseOver, {passive: true});
GM_registerMenuCommand('Configure', setup);

if (/(^|\.)google(\.com?)?(\.\w+)?$/.test(hostname)) {
  const node = doc.getElementById('main');
  if (node)
    on(node, 'mouseover', onMouseOver, {passive: true});
} else if (trusted.includes(hostname)) {
  on(window, 'message', onMessage);
  on(doc, 'click', e => {
    const t = e.target;
    if (e.which !== 1 || !/BLOCKQUOTE|CODE|PRE/.test(tag(t) + tag(t.parentNode)) ||
        !/^\s*{\s*".+:.+}\s*$/.test(t.textContent)) {
      return;
    }
    postMessage('mpiv-rule ' + t.textContent, '*');
    e.preventDefault();
  });
}

const simpleMatcher = {
  // string-to-regexp escaped chars
  RX_ESCAPE: /[.+*?(){}[\]^$|]/g,
  // rx for '^' symbol in simple url match
  RX_SEP: /[^\w%._-]/g,

  array: (s, arr) => {
    for (const {fn, needle} of arr)
      if (fn(s, needle))
        return true;
  },

  equals: (s, needle) =>
    s.length === needle.length ? s === needle :
      s.length === needle.length + 1 && s.startsWith(needle) && simpleMatcher.endsSep(s),

  starts: (s, needle) =>
    s.startsWith(needle),

  ends: (s, needle) =>
    s.endsWith(needle) ||
    s.length > needle.length &&
    s.indexOf(needle, s.length - needle.length - 1) >= 0 &&
    simpleMatcher.endsSep(s),

  has: (s, needle) =>
    s.includes(needle),

  rx: (s, needle) =>
    needle.test(s),

  endsSep: s => {
    simpleMatcher.RX_SEP.lastIndex = s.length - 1;
    return simpleMatcher.RX_SEP.test(s);
  },

  startsDomainPrescreen: (url, data) =>
    url.includes(data[0]) &&
    simpleMatcher.startsDomain(url, data),

  startsDomain: (url, [needle, domain, pinDomainEnd, endSep]) => {
    const [p, gap, host] = url.split('/', 3);
    if (gap || p && !p.endsWith(':'))
      return;
    let start = pinDomainEnd ? host.length - domain.length : 0;
    for (;; start++) {
      start = host.indexOf(domain, start);
      if (start < 0)
        return;
      if (!start || host[start - 1] === '.')
        break;
    }
    start += p.length + 2;
    return url.lastIndexOf(needle, start) === start &&
      (!endSep || start + needle.length === url.length);
  },
};

/*
  ||some.domain = matches some.domain, anything.some.domain, etc.
  |foo = hostname must start with foo
  ^ can be used only at the end like foo^, means that the domain must end with foo
 */
function onDomain(d) {
  if (!d)
    return true;
  const pinDomain = d.startsWith('||');
  const pinStart = !pinDomain && d.startsWith('|');
  const pinEnd = d.endsWith('^');
  const start = pinDomain * 2 + pinStart;
  const dLen = d.length - start - pinEnd;
  if (dLen > hostname.length)
    return;
  d = d.slice(start, -pinEnd || undefined);
  return (
    pinStart ? hostname.startsWith(d) && (!pinEnd || hostname.length === dLen) :
      pinDomain && pinEnd ? hostnamePinned[hostnamePinned.length - dLen - 1] === '.' &&
                            hostname.endsWith(d) :
        pinDomain ? hostnamePinned.includes('.' + d) :
          pinEnd ? hostname.endsWith(d) :
            hostname.includes(d)
  );
}

function compileSimpleUrlMatch(match) {
  const results = [];
  for (const s of ensureArray(match)) {
    const pinDomain = s.startsWith('||');
    const pinStart = !pinDomain && s.startsWith('|');
    const endSep = s.endsWith('^');
    const i = pinDomain * 2 + pinStart;
    let fn;
    let needle = i || endSep ? s.slice(i, -endSep || undefined) : s;
    if (needle.includes('^')) {
      const separator = simpleMatcher.RX_SEP.source;
      needle = new RegExp(
        (pinStart ? '^' : '') +
        (pinDomain ? '(?:\\.|//)' : '') +
        needle.replace(simpleMatcher.RX_ESCAPE, '\\$&').replace(/\\\^/g, separator) +
        (endSep ? `(?:${separator}|$)}` : ''), 'i');
      fn = simpleMatcher.rx;
    } else if (pinStart) {
      fn = endSep ? simpleMatcher.equals : simpleMatcher.starts;
    } else if (pinDomain) {
      const i = needle.indexOf('/');
      const domain = i > 0 ? needle.slice(0, i) : needle;
      needle = [needle, domain, i > 0, endSep];
      fn = simpleMatcher.startsDomainPrescreen;
    } else if (endSep) {
      fn = simpleMatcher.ends;
    } else {
      fn = simpleMatcher.has;
    }
    results.push({needle, fn});
  }
  return Array.isArray(match) ?
    {needle: results, fn: simpleMatcher.array} :
    results[0];
}

function loadCfg() {
  return fixCfg(GM_getValue('cfg'), true);
}

function fixCfg(cfg, save) {
  const def = {
    version: 5,
    delay: 500,
    start: 'auto',
    zoom: 'context',
    center: false,
    imgtab: false,
    close: true,
    preload: false,
    css: '',
    scales: [],
    hosts: [],
    scale: 1.5,
    xhr: true,
  };
  if (typeof cfg === 'string')
    cfg = tryJson(cfg);
  if (typeof cfg !== 'object' || !cfg)
    cfg = {};
  if (typeof cfg.hosts === 'string')
    cfg.hosts = cfg.hosts.split('\n')
      .map(s => tryJson(s) || s)
      .filter(Boolean);
  if (cfg.version === def.version)
    return cfg;
  for (const dp in def)
    if (def.hasOwnProperty(dp) && typeof cfg[dp] !== typeof def[dp])
      cfg[dp] = def[dp];
  if (cfg.version === 3 && cfg.scales[0] === 0)
    cfg.scales[0] = '0!';
  for (const cp in cfg)
    if (!def.hasOwnProperty(cp))
      delete cfg[cp];
  cfg.version = def.version;
  if (save)
    saveCfg(cfg);
  return cfg;
}

function saveCfg(newCfg) {
  cfg = newCfg;
  GM_setValue('cfg', JSON.stringify(cfg));
}

/*
 'u' works only with URLs so it's ignored if 'html' is true
   ||some.domain = matches some.domain, anything.some.domain, etc.
   |foo = url or text must start with foo
   ^ = separator like / or ? or : but not a letter/number, not %._-
       when used at the end like "foo^" it additionally matches when the source ends with "foo"
 'r' is checked only if 'u' matches first
*/
function loadHosts() {
  const customHosts = [];
  const rxHasCode = /(^|[^-\w])return[\W\s]/;
  for (let h of cfg.hosts || []) {
    try {
      if (typeof h === 'string')
        h = JSON.parse(h);
      if (typeof h.d !== 'string')
        h.d = undefined;
      else if (h.d && !onDomain(h.d))
        continue;
      if (h.r)
        h.r = new RegExp(h.r, 'i');
      if (rxHasCode.test(h.s))
        h.s = new Function('m', 'node', h.s); // eslint-disable-line no-new-func
      if (rxHasCode.test(h.q))
        h.q = new Function('text', 'doc', 'node', h.q); // eslint-disable-line no-new-func
      if (rxHasCode.test(h.c))
        h.c = new Function('text', 'doc', 'node', h.c); // eslint-disable-line no-new-func
      customHosts.push(h);
    } catch (e) {
      if (!e.message.includes('unsafe-eval'))
        handleError('Invalid custom host rule:', h);
    }
  }

  // rules that disable previewing
  const disablers = [
    onDomain('||stackoverflow.com^') && {
      e: '.post-tag, .post-tag img',
      s: '',
    }, {
      u: '||disqus.com/',
      s: '',
    },
  ];

  // optimization: a rule is created only when on domain
  const perDomain = [
    onDomain('startpage') && {
      r: /\boiu=(.+)/,
      s: '$1',
      follow: true,
    },
    onDomain('||4chan.org^') && {
      e: '.is_catalog .thread a[href*="/thread/"], .catalog-thread a[href*="/thread/"]',
      q: '.op .fileText a',
      css: '#post-preview{display:none}',
    },
    onDomain('||amazon.') && {
      u: 'amazon.com/images/I/',
      r: /(?:^|\/\/)(.+?\/I\/.+?\.)/,
      s: m => {
        const uh = doc.getElementById('universal-hover');
        return uh ? '' : m[1] + 'jpg';
      },
      css: '#zoomWindow{display:none!important;}',
    },
    onDomain('||bing.com^') && {
      e: 'a[m*="murl"]',
      r: /murl&quot;:&quot;(.+?)&quot;/,
      s: '$1',
      html: true,
    },
    onDomain('||deviantart.com^') && {
      e: '[data-super-full-img] *, img[src*="/th/"]',
      s: (m, node) => {
        let el = node.closest('[data-super-full-img]');
        if (el)
          return el.dataset.superFullImg;
        el = node.dataset.embedId && node.nextElementSibling;
        if (el && el.dataset.embedId)
          return el.src;
      },
    },
    onDomain('||dropbox.com^') && {
      r: /(.+?&size_mode)=\d+(.*)/,
      s: '$1=5$2',
    },
    onDomain('||facebook.com^') && {
      e: 'a[href*="ref=hovercard"]',
      s: (m, node) =>
        'https://www.facebook.com/photo.php?fbid=' +
        /\/[0-9]+_([0-9]+)_/.exec(qs('img', node).src)[1],
      follow: true,
    },
    onDomain('||facebook.com^') && {
      r: /(fbcdn|external).*?(app_full_proxy|safe_image).+?(src|url)=(http.+?)[&"']/,
      s: (m, node) =>
        node.parentNode.className.includes('video') && m[4].includes('fbcdn') ? '' :
          decodeURIComponent(m[4]),
      html: true,
      follow: true,
    },
    onDomain('||flickr.com^') &&
    tryCatch(() => unsafeWindow.YUI_config.flickr.api.site_key) && {
      u: '||flickr.com/photos/',
      r: /photos\/[^/]+\/(\d+)/,
      s: m => `https://www.flickr.com/services/rest/?${
        new URLSearchParams({
          photo_id: m[1],
          api_key: unsafeWindow.YUI_config.flickr.api.site_key,
          method: 'flickr.photos.getSizes',
          format: 'json',
          nojsoncallback: 1,
        }).toString()}`,
      q: text => JSON.parse(text).sizes.size.pop().source,
    },
    onDomain('||github.com^') && {
      u: [
        'avatars',
        'raw.github.com',
        '.png',
        '.jpg',
        '.jpeg',
        '.bmp',
        '.gif',
        '.cur',
        '.ico',
      ],
      r: new RegExp([
        /(avatars.+?&s=)\d+/,
        /(raw\.github)(\.com\/.+?\/img\/.+)$/,
        /\/(github)(\.com\/.+?\/)blob\/([^/]+\/.+?\.(?:png|jpe?g|bmp|gif|cur|ico))$/,
      ].map(rx => rx.source).join('|')),
      s: m => `https://${
        m[1] ? `${m[1]}460` :
          m[2] ? `${m[2]}usercontent${m[3]}` :
            `raw.${m[4]}usercontent${m[5]}${m[6]}`
      }`,
    },
    onDomain('||instagram.com^') && (() => {
      const LINK_SEL = 'a[href*="/p/"]';
      const getData = node => {
        const n = node.closest(`${LINK_SEL}, article`);
        if (!n)
          return;
        const a = tag(n) === 'A' ? n : qs(LINK_SEL, n);
        if (!a)
          return;
        try {
          const shortcode = a.pathname.match(/\/p\/(\w+)/)[1];
          return {
            a,
            data: unsafeWindow._sharedData.entry_data.ProfilePage[0]
              .graphql.user.edge_owner_to_timeline_media.edges
              .find(e => e.node.shortcode === shortcode)
              .node,
          };
        } catch (e) {
          return {a};
        }
      };
      const RULE = {
        e: [
          LINK_SEL,
          'a[role="button"][data-reactid*="scontent-"]',
          'article div',
          'article div div img',
        ],
        s: (m, node) => {
          const {a, data} = getData(node) || {};
          RULE.follow = !data;
          return (
            !a ? false :
              !data ? a.href :
                data.video_url || data.display_url);
        },
        c: (html, doc, node) =>
          tryCatch(() => getData(node).data.edge_media_to_caption.edges[0].node.text) || '',
        follow: true,
      };
      return RULE;
    })(),
    ...onDomain('||reddit.com^') ? [
      {
        u: '||i.reddituploads.com/',
      },
      {
        u: '||preview.redd.it/',
        r: /(redd\.it\/\w+\.(jpe?g|png|gif))/,
        s: 'https://i.$1',
      },
    ] : [],
    onDomain('||tumblr.com^') && {
      e: 'div.photo_stage_img, div.photo_stage > canvas',
      s: (m, node) => /http[^"]+/.exec(node.style.cssText + node.getAttribute('data-img-src'))[0],
      follow: true,
    },
    onDomain('||tweetdeck.twitter.com^') && {
      e: 'a.media-item, a.js-media-image-link',
      s: (m, node) => /http[^)]+/.exec(node.style.backgroundImage)[0],
      follow: true,
    },
    onDomain('||twitter.com^') && {
      e: '.grid-tweet > .media-overlay',
      s: (m, node) => node.previousElementSibling.src,
      follow: true,
    },
    onDomain('||youtube.com^') && {
      e: 'ytd-thumbnail *',
      s: '',
    },
  ];

  return [
    ...customHosts,
    ...disablers,
    ...perDomain,
    {
      r: /[/?=](https?[^&]+)/,
      s: '$1',
      follow: true,
    },
    {
      u: [
        '||500px.com/photo/',
        '||cl.ly/',
        '||cweb-pix.com/',
        '||ibb.co/',
        '||imgcredit.xyz/image/',
      ],
      r: /\.\w+\/.+/,
      q: 'meta[property="og:image"]',
    },
    {
      u: 'attachment.php',
      r: /attachment\.php.+attachmentid/,
    },
    {
      u: '||abload.de/image',
      q: '#image',
    },
    {
      u: '||deviantart.com/art/',
      s: (m, node) =>
        /\b(film|lit)/.test(node.className) || /in Flash/.test(node.title) ?
          '' :
          m.input,
      q: [
        '#download-button[href*=".jpg"]',
        '#download-button[href*=".jpeg"]',
        '#download-button[href*=".gif"]',
        '#download-button[href*=".png"]',
        '#gmi-ResViewSizer_fullimg',
        'img.dev-content-full',
      ],
    },
    {
      u: '||dropbox.com/s',
      r: /com\/sh?\/.+\.(jpe?g|gif|png)/i,
      q: (text, doc) => {
        const i = qs('img.absolute-center', doc);
        return i ? i.src.replace(/(size_mode)=\d+/, '$1=5') : false;
      },
    },
    {
      r: /[./]ebay\.[^/]+\/itm\//,
      q: text =>
        text.match(/https?:\/\/i\.ebayimg\.com\/[^.]+\.JPG/i)[0]
          .replace(/~~60_\d+/, '~~60_57'),
    },
    {
      u: '||i.ebayimg.com/',
      s: (m, node) =>
        qs('.zoom_trigger_mask', node.parentNode) ? '' :
          m.input.replace(/~~60_\d+/, '~~60_57'),
    },
    {
      u: '||fastpic.ru/view/',
      q: '.image',
    },
    {
      u: '||facebook.com/',
      r: /photo\.php|[^/]+\/photos\//,
      s: (m, node) =>
        node.id === 'fbPhotoImage' ? false :
          /gradient\.png$/.test(m.input) ? '' :
            m.input.replace('www.facebook.com', 'mbasic.facebook.com'),
      q: [
        'div + span > a:first-child:not([href*="tag_faces"])',
        'div + span > a[href*="tag_faces"] ~ a',
      ],
      rect: '#fbProfileCover',
    },
    {
      u: '||fbcdn.',
      r: /fbcdn.+?[0-9]+_([0-9]+)_[0-9]+_[a-z]\.(jpg|png)/,
      s: m =>
        onDomain('||facebook.com^') &&
        tryCatch(() => unsafeWindow.PhotoSnowlift.getInstance().stream.cache.image[m[1]].url) ||
        false,
      manual: true,
    },
    {
      u: ['||fbcdn-', 'fbcdn.net/'],
      r: /(https?:\/\/(fbcdn-[-\w.]+akamaihd|[-\w.]+?fbcdn)\.net\/[-\w/.]+?)_[a-z]\.(jpg|png)(\?[0-9a-zA-Z0-9=_&]+)?/,
      s: (m, node) => {
        if (node.id === 'fbPhotoImage') {
          const a = qs('a.fbPhotosPhotoActionsItem[href$="dl=1"]', doc.body);
          if (a)
            return a.href.includes(m.input.match(/[0-9]+_[0-9]+_[0-9]+/)[0]) ? '' : a.href;
        }
        if (m[4])
          return false;
        if (node.parentNode.outerHTML.includes('/hovercard/'))
          return '';
        const gp = node.parentNode.parentNode;
        if (node.outerHTML.includes('profile') && gp.href.includes('/photo'))
          return false;
        return m[1].replace(/\/[spc][\d.x]+/g, '').replace('/v/', '/') + '_n.' + m[3];
      },
      rect: '.photoWrap',
    },
    {
      u: '||flickr.com/photos/',
      r: /photos\/([0-9]+@N[0-9]+|[a-z0-9_-]+)\/([0-9]+)/,
      s: m =>
        m.input.indexOf('/sizes/') < 0 ?
          `https://www.flickr.com/photos/${m[1]}/${m[2]}/sizes/sq/` :
          false,
      q: (text, doc) => {
        const links = qsa('.sizes-list a', doc);
        return 'https://www.flickr.com' + links[links.length - 1].getAttribute('href');
      },
      follow: true,
    },
    {
      u: '||flickr.com/photos/',
      r: /\/sizes\//,
      q: '#allsizes-photo > img',
    },
    {
      u: '||gfycat.com/',
      r: /(gfycat\.com\/)(gifs\/detail\/|iframe\/)?([a-z]+)/i,
      s: 'https://$1$3',
      q: [
        'meta[content$=".webm"]',
        '#webmsource',
        'source[src$=".webm"]',
      ],
    },
    {
      u: [
        '||googleusercontent.com/proxy',
        '||googleusercontent.com/gadgets/proxy',
      ],
      r: /\.com\/(proxy|gadgets\/proxy.+?(http.+?)&)/,
      s: m => m[2] ? decodeURIComponent(m[2]) : m.input.replace(/w\d+-h\d+($|-p)/, 'w0-h0'),
    },
    {
      u: [
        '||googleusercontent.com/',
        '||ggpht.com/',
      ],
      s: (m, node) =>
        m.input.includes('webcache.') ||
        node.outerHTML.match(/favicons\?|\b(Ol Rf Ep|Ol Zb ag|Zb HPb|Zb Gtb|Rf Pg|ho PQc|Uk wi hE|go wi Wh|we D0b|Bea)\b/) ||
        node.matches('.g-hovercard *, a[href*="profile_redirector"] > img') ?
          '' :
          m.input.replace(/\/s\d{2,}-[^/]+|\/w\d+-h\d+/, '/s0').replace(/[?&/]\w+=[^&/]+$/, ''),
    },
    {
      u: '||gravatar.com/',
      r: /([a-z0-9]{32})/,
      s: 'https://gravatar.com/avatar/$1?s=200',
    },
    {
      u: '||gyazo.com/',
      r: /\.com\/\w{32,}/,
      q: '.image',
      xhr: true,
    },
    {
      u: '||hostingkartinok.com/show-image.php',
      q: '.image img',
    },
    {
      u: [
        '||imagecurl.com/images/',
        '||imagecurl.com/viewer.php',
      ],
      r: /(?:images\/(\d+)_thumb|file=(\d+))(\.\w+)/,
      s: 'https://imagecurl.com/images/$1$2$3',
    },
    {
      u: '||imagebam.com/image/',
      q: 'meta[property="og:image"]',
      tabfix: true,
      xhr: onDomain('||planetsuzy'),
    },
    {
      u: '||imageban.ru/thumbs',
      r: /(.+?\/)thumbs(\/\d+)\.(\d+)\.(\d+\/.*)/,
      s: '$1out$2/$3/$4',
    },
    {
      u: [
        '||imageban.ru/show',
        '||imageban.net/show',
        '||ibn.im/',
      ],
      q: '#img_main',
    },
    {
      u: '||imageshack.us/img',
      r: /img(\d+)\.(imageshack\.us)\/img\\1\/\d+\/(.+?)\.th(.+)$/,
      s: 'https://$2/download/$1/$3$4',
    },
    {
      u: '||imageshack.us/i/',
      q: '#share-dl',
    },
    {
      u: '||imageteam.org/img',
      q: 'img[alt="image"]',
    },
    {
      u: [
        '||imagetwist.com/',
        '||imageshimage.com/',
      ],
      r: /(\/\/|^)[^/]+\/[a-z0-9]{8,}/,
      q: 'img.pic',
      xhr: true,
    },
    {
      u: '||imageupper.com/i/',
      q: '#img',
      xhr: true,
    },
    {
      u: '||imagevenue.com/img.php',
      q: '#thepic',
    },
    {
      u: '||imagezilla.net/show/',
      q: '#photo',
      xhr: true,
    },
    {
      u: [
        '||images-na.ssl-images-amazon.com/images/',
        '||media-imdb.com/images/',
      ],
      r: /images\/.+?\.jpg/,
      s: '/V1\\.?_.+?\\.//g',
      distinct: true,
    },
    {
      u: '||imgbox.com/',
      r: /\.com\/([a-z0-9]+)$/i,
      q: '#img',
      xhr: hostname !== 'imgbox.com',
    },
    {
      u: '||imgclick.net/',
      r: /\.net\/(\w+)/,
      q: 'img.pic',
      xhr: true,
      post: m => `op=view&id=${m[1]}&pre=1&submit=Continue%20to%20image...`,
    },
    {
      u: [
        '||imgflip.com/i/',
        '||imgflip.com/gif/',
      ],
      r: /\/(i|gif)\/([^/?#]+)/,
      s: m => `https://i.imgflip.com/${m[2]}${m[1] === 'i' ? '.jpg' : '.mp4'}`,
    },
    {
      u: [
        '||imgur.com/a/',
        '||imgur.com/gallery/',
        '||imgur.com/t/',
      ],
      g: (text, url, cb) => {
        const mk = (o, imgs) => {
          const items = [];
          if (!o || !imgs)
            return items;
          for (const cur of imgs) {
            let iu = 'https://i.imgur.com/' + cur.hash + cur.ext;
            if (cur.ext === '.gif' && !(cur.animated === false))
              iu = [iu.replace('.gif', '.webm'), iu.replace('.gif', '.mp4'), iu];
            items.push({
              url: iu,
              desc: cur.title && cur.description ?
                cur.title + ' - ' + cur.description :
                (cur.title || cur.description),
            });
          }
          if (o.is_album && !includes(items[0].desc, o.title))
            items.title = o.title;
          return items;
        };
        // simplified extraction of JSON as it occupies only one line
        if (!/(?:mergeConfig\('gallery',\s*|Imgur\.Album\.getInstance\()[\s\S]*?[,\s{"'](?:image|album)\s*:\s*({[^\r\n]+?}),?[\r\n]/.test(text))
          return;
        const o = JSON.parse(RegExp.$1);
        const imgs = o.is_album ? o.album_images.images : [o];
        if (!o.num_images || o.num_images <= imgs.length)
          return mk(o, imgs);
        GM_xmlhttpRequest({
          method: 'GET',
          url: `https://imgur.com/ajaxalbums/getimages/${o.hash}/hit.json?all=true`,
          onload: res => cb(mk(o, ((tryJson(res.responseText) || 0).data || 0).images || [])),
        });
      },
      css: '.post > .hover { display:none!important; }',
    },
    {
      u: '||imgur.com/',
      r: /\.com\/.+,/,
      g: (text, url) =>
        /.+\/([a-z0-9,]+)/i
          .exec(url)[1]
          .split(',')
          .map(id => ({
            url: `https://i.${/([a-z]{2,}\.)?imgur\.com/.exec(url)[0]}/${id}.jpg`,
          })),
    },
    {
      u: '||imgur.com/',
      r: /([a-z]{2,}\.)?imgur\.com\/(r\/[a-z]+\/|[a-z0-9]+#)?([a-z0-9]{5,})($|\?|\.([a-z]+))/i,
      s: (m, node) => {
        if (/memegen|random|register|search|signin/.test(m.input))
          return '';
        const a = node.closest('a');
        if (a && /(i\.([a-z]+\.)?)?imgur\.com\/(a\/|gallery\/)?/.test(a.href))
          return false;
        const url = 'https://i.' + (m[1] || '').replace('www.', '') + 'imgur.com/' +
                  m[3].replace(/(.{7})[bhm]$/, '$1') + '.' +
                  (m[5] ? m[5].replace(/gifv?/, 'webm') : 'jpg');
        return url.includes('.webm') ?
          [url, url.replace('.webm', '.mp4'), url.replace('.webm', '.gif')] :
          url;
      },
    },
    {
      u: [
        '||instagr.am/p/',
        '||instagram.com/p/',
      ],
      s: m => m.input.substr(0, m.input.lastIndexOf('/')) + '/?__a=1',
      q: text => {
        const m = JSON.parse(text).graphql.shortcode_media;
        return m.video_url || m.display_url;
      },
      rect: 'div.PhotoGridMediaItem',
      c: text => {
        const m = JSON.parse(text).graphql.shortcode_media.edge_media_to_caption.edges[0];
        return m === undefined ? '(no caption)' : m.node.text;
      },
    },
    {
      u: [
        '||livememe.com/',
        '||lvme.me/',
      ],
      r: /\.\w+\/([^.]+)$/,
      s: 'http://i.lvme.me/$1.jpg',
    },
    {
      u: '||lostpic.net/image',
      q: '.image-viewer-image img',
    },
    {
      u: '||makeameme.org/meme/',
      r: /\/meme\/([^/?#]+)/,
      s: 'https://media.makeameme.org/created/$1.jpg',
    },
    {
      u: '||photobucket.com/',
      r: /(\d+\.photobucket\.com\/.+\/)(\?[a-z=&]+=)?(.+\.(jpe?g|png|gif))/,
      s: 'https://i$1$3',
      xhr: !onDomain('||photobucket.com^'),
    },
    {
      u: '||piccy.info/view3/',
      r: /(.+?\/view3)\/(.*)\//,
      s: '$1/$2/orig/',
      q: '#mainim',
    },
    {
      u: '||pimpandhost.com/image/',
      r: /(.+?\/image\/[0-9]+)/,
      s: '$1?size=original',
      q: 'img.original',
    },
    {
      u: [
        '||pixroute.com/',
        '||imgspice.com/',
      ],
      r: /\.html$/,
      q: 'img[id]',
      xhr: true,
    },
    {
      u: '||postima',
      r: /postima?ge?\.org\/image\/\w+/,
      q: [
        'a[href*="dl="]',
        '#main-image',
      ],
    },
    {
      u: [
        '||prntscr.com/',
        '||prnt.sc/',
      ],
      r: /\.\w+\/.+/,
      q: 'meta[property="og:image"]',
      xhr: true,
    },
    {
      u: '||radikal.ru/',
      r: /\.ru\/(fp|.+\.html)/,
      q: text => text.match(/http:\/\/[a-z0-9]+\.radikal\.ru[a-z0-9/]+\.(jpg|gif|png)/i)[0],
    },
    {
      u: '||twimg.com/',
      r: /\/profile_images/i,
      s: '/_(reasonably_small|normal|bigger|\\d+x\\d+)\\././g',
    },
    {
      u: '||twimg.com/media/',
      r: /(?:^|\/\/)(.+?\.(jpe?g|png|gif))/i,
      s: 'https://$1:orig',
      rect: 'div.tweet a.twitter-timeline-link, div.TwitterPhoto-media',
    },
    {
      u: '||tumblr.com',
      r: /_500\.jpg/,
      s: ['/_500/_1280/', ''],
    },
    {
      u: '||twimg.com/1/proxy',
      r: /t=([^&_]+)/i,
      s: m => atob(m[1]).match(/http.+/),
    },
    {
      u: '||pic.twitter.com/',
      r: /\.com\/[a-z0-9]+/i,
      q: text => text.match(/https?:\/\/twitter\.com\/[^/]+\/status\/\d+\/photo\/\d+/i)[0],
      follow: true,
    },
    {
      u: '||twitpic.com/',
      r: /\.com(\/show\/[a-z]+)?\/([a-z0-9]+)($|#)/i,
      s: 'https://twitpic.com/show/large/$2',
    },
    {
      u: '||twitter.com/',
      r: /\/status\/.+\/photo\//,
      q: [
        '.OldMedia img',
        '.media img',
        'video.animated-gif',
        '.AdaptiveMedia-singlePhoto img',
        '.AdaptiveMedia-halfWidthPhoto img',
        '.AdaptiveMedia-twoThirdsWidthPhoto img',
        '.AdaptiveMedia-threeQuartersWidthPhoto img',
      ],
      follow: url => !/\.mp4$/.test(url),
    },
    {
      u: '||upix.me/files',
      s: '/#//',
    },
    {
      u: '||wiki',
      r: /\/(thumb|images)\/.+\.(jpe?g|gif|png|svg)\/(revision\/)?/i,
      s: '/\\/thumb(?=\\/)|\\/scale-to-width(-[a-z]+)?\\/[0-9]+|\\/revision\\/latest|\\/[^\\/]+$/' +
         '/g',
      xhr: !onDomain('||wiki'),
    },
    {
      u: '||ytimg.com/vi/',
      r: /(.+?\/vi\/[^/]+)/,
      s: '$1/0.jpg',
      rect: '.video-list-item',
    },
    {
      u: '/viewer.php?file=',
      r: /(.+?)\/viewer\.php\?file=(.+)/,
      s: '$1/images/$2',
      xhr: true,
    },
    {
      u: '/thumb_',
      r: /\/albums.+\/thumb_[^/]/,
      s: '/thumb_//',
    },
    {
      u: [
        '.th.jp',
        '.th.gif',
        '.th.png',
      ],
      r: /(.+?\.)th\.(jpe?g?|gif|png|svg|webm)$/i,
      s: '$1$2',
      follow: true,
    },
    {
      u: [
        '.jp',
        '.jpg',
        '.jpe',
        '.jpeg',
        '.gif',
        '.png',
        '.svg',
        '.webm',
      ],
      r: /[^?:]+\.(jpe?g?|gif|png|svg|webm)($|\?)/i,
      distinct: true,
    },
  ].filter(Boolean);
}

function onMouseOver(e) {
  if (!enabled || e.shiftKey || app.zoom)
    return;
  let node = e.target;
  if (node === app.popup ||
      node === doc.body ||
      node === doc.documentElement)
    return;
  if (node.shadowRoot)
    node = pierceShadow(node, e.clientX, e.clientY);
  if (!activate(node, e.ctrlKey))
    return;
  updateMouse(e);
  if (e.ctrlKey) {
    startPopup();
  } else if (cfg.start === 'auto' && !app.manual) {
    schedulePopup();
  } else {
    setStatus('ready');
  }
}

function pierceShadow(node, x, y) {
  for (let root; (root = node.shadowRoot);) {
    on(root, 'mouseover', onMouseOver, {passive: true});
    on(root, 'mouseout', onMouseOutShadow);
    const inner = root.elementFromPoint(x, y);
    if (!inner || inner === node)
      break;
    node = inner;
  }
  return node;
}

function onMouseOut(e) {
  if (!e.relatedTarget && !e.shiftKey)
    deactivate();
}

function onMouseOutShadow(e) {
  const root = e.target.shadowRoot;
  if (root) {
    off(root, 'mouseover', onMouseOver);
    off(root, 'mouseout', onMouseOutShadow);
  }
}

function onMouseMove(e) {
  updateMouse(e);
  if (e.shiftKey)
    return (app.lazyUnload = true);
  if (!app.zoomed && !app.cr)
    return deactivate();
  if (app.zoom) {
    placePopup();
    const {height: h, width: w} = app.view;
    const bx = w / 6;
    const by = h / 6;
    setStatus('edge',
      app.cx < bx || app.cx > w - bx || app.cy < by || app.cy > h - by ?
        'add' :
        'remove');
  }
}

function onMouseDown(e) {
  if (e.button !== 2 && !e.shiftKey) {
    deactivate(true);
  } else if (e.shiftKey && e.button === 0 && app.popup && app.popup.controls) {
    app.controlled = app.zoomed = true;
  }
}

function onMouseScroll(e) {
  const dir = (e.deltaY || -e.wheelDelta) > 0 ? 1 : -1;
  if (app.zoom) {
    drop(e);
    const idx = app.scales.indexOf(app.scale) - dir;
    if (idx >= 0 && idx < app.scales.length)
      app.scale = app.scales[idx];
    if (idx === 0 && cfg.close) {
      if (!app.gItems || app.gItems.length < 2)
        return deactivate(true);
      app.zoom = false;
      showFileInfo();
    }
    if (app.zooming)
      app.popup.classList.add('mpiv-zooming');
    placePopup();
    updateTitle();
  } else if (app.gItems && app.gItems.length > 1 && app.popup) {
    drop(e);
    nextGalleryItem(dir);
  } else if (cfg.zoom === 'wheel' && dir < 0 && app.popup) {
    drop(e);
    toggleZoom();
  } else {
    deactivate();
  }
}

function onKeyDown(e) {
  if (e.key === 'Shift') {
    setStatus('shift', 'add');
    if (app.popup && 'controls' in app.popup)
      app.popup.controls = true;
  } else if (e.key === 'Control' && (cfg.start !== 'auto' || app.manual) && !app.popup) {
    startPopup();
  }
}

function onKeyUp(e) {
  switch (e.key.length > 1 ? e.key : e.code) {
    case 'Shift':
      setStatus('shift', 'remove');
      if (app.popup.controls)
        app.popup.controls = false;
      if (app.controlled)
        return (app.controlled = false);
      if (app.popup && (app.zoomed || !('cr' in app) || app.cr))
        toggleZoom();
      else
        deactivate(true);
      break;
    case 'Control':
      break;
    case 'Escape':
      deactivate(true);
      break;
    case 'ArrowRight':
    case 'KeyJ':
      drop(e);
      nextGalleryItem(1);
      break;
    case 'ArrowLeft':
    case 'KeyK':
      drop(e);
      nextGalleryItem(-1);
      break;
    case 'KeyD': {
      drop(e);
      let name = (app.iurl || app.popup.src).split('/').pop().replace(/[:#?].*/, '');
      if (!name.includes('.'))
        name += '.jpg';
      GM_download({
        name,
        url: app.popup.src,
        onerror: () => setBar(`Could not download ${name}.`, 'error'),
      });
      break;
    }
    case 'KeyT':
      app.lazyUnload = true;
      if (app.tabfix && !app.xhr && tag(app.popup) === 'IMG' &&
          navigator.userAgent.includes('Gecko/')) {
        GM_openInTab('data:text/html;,' + encodeURIComponent(`
          <style>
            body {
              margin: 0;
              padding: 0;
              background: #222
            }
            .fit {
              overflow: hidden
            }
            .fit > img {
              max-width: 100vw;
              max-height: 100vh
            }
            body > img {
              margin: auto;
              position: absolute;
              left: 0;
              right: 0;
              top: 0;
              bottom: 0
            }
          </style>
          <body class="fit">
            <img onclick="document.body.classList.toggle('fit')" src="${app.popup.src}">
          </body>
        `.replace(/[\r\n]+\s*/g, '')));
      } else {
        GM_openInTab(app.popup.src);
      }
      deactivate();
      break;
    default:
      deactivate(true);
  }

}

function onContext(e) {
  if (e.shiftKey)
    return;
  if (cfg.zoom === 'context' && app.popup && toggleZoom()) {
    drop(e);
    return;
  }
  if (
    !app.status &&
    !app.popup && (
      cfg.start === 'context' ||
      (cfg.start === 'auto' && app.manual)
    )
  ) {
    startPopup();
    drop(e);
    return;
  }
  setTimeout(deactivate, 50, true);
}

function onMessage(e) {
  if (typeof e.data !== 'string' ||
      !trusted.includes(e.origin.substr(e.origin.indexOf('//') + 2)) ||
      !e.data.startsWith('mpiv-rule '))
    return;
  if (!doc.getElementById(SETUP_ID))
    setup();
  const el = doc.getElementById(SETUP_ID).shadowRoot.getElementById('hosts').firstElementChild;
  el.value = e.data.substr(10).trim();
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.parentNode.scrollTop = 0;
  el.select();
}

function schedulePopup() {
  if (cfg.preload) {
    app.preloadStart = Date.now();
    startPopup();
    setStatus('preloading', 'add');
  } else {
    app.timeout = setTimeout(startPopup, cfg.delay);
  }
  if (cfg.preload)
    setTimeout(setStatus, cfg.delay, 'preloading', 'remove');
}

function startPopup() {
  updateStyles();
  setStatus(false);
  if (app.g)
    startGalleryPopup();
  else
    startSinglePopup(app.url);
}

function startSinglePopup(url) {
  setStatus('loading');
  delete app.iurl;
  if (app.follow && !app.q && !app.s) {
    return findRedirect(app.url, url => {
      const info = findInfo(url, app.node, {noHtml: true});
      if (!info || !info.url)
        throw 'Couldn\'t follow redirection target: ' + url;
      restartSinglePopup(info);
    });
  }
  if (!app.q || Array.isArray(app.urls)) {
    switch (typeof app.c) {
      case 'function':
        app.caption = app.c(doc.documentElement.outerHTML, doc, app.node);
        break;
      case 'string':
        app.caption = findCaption(qsMany(app.c, doc));
        break;
    }
    app.iurl = url;
    return app.xhr ? downloadImage(url, app.url) : setPopup(url);
  }
  downloadPage(url, (html, url) => {
    let iurl;
    const doc = createDoc(html);
    if (typeof app.q === 'function') {
      iurl = app.q(html, doc, app.node);
      if (Array.isArray(iurl)) {
        app.urls = iurl.slice();
        iurl = app.urls.shift();
      }
    } else {
      const inode = qsMany(app.q, doc);
      iurl = inode ? findFile(inode, url) : false;
    }
    if (!iurl)
      throw 'File not found.';
    switch (typeof app.c) {
      case 'function':
        app.caption = app.c(html, doc, app.node);
        break;
      case 'string':
        app.caption = findCaption(qsMany(app.c, doc));
        break;
    }
    if (app.follow === true || typeof app.follow === 'function' && app.follow(iurl)) {
      const info = findInfo(iurl, app.node, {noHtml: true});
      if (!info || !info.url)
        throw 'Couldn\'t follow URL: ' + iurl;
      return restartSinglePopup(info);
    }
    app.iurl = iurl;
    if (app.xhr) {
      downloadImage(iurl, url);
    } else {
      setPopup(iurl);
    }
  });
}

function restartSinglePopup(info) {
  Object.assign(app, info);
  startSinglePopup(app.url);
}

function startGalleryPopup() {
  setStatus('loading');
  const startUrl = app.url;
  downloadPage(app.url, (text, url) => {
    try {
      const cb = items => {
        if (!app.url || app.url !== startUrl)
          return;
        app.gItems = items;
        if (app.gItems.length === 0) {
          app.gItems = false;
          throw 'empty';
        }
        app.gIndex = findGalleryPosition(app.url);
        setTimeout(nextGalleryItem, 0);
      };
      const items = app.g(text, url, cb);
      if (typeof items !== 'undefined')
        cb(items);
    } catch (e) {
      handleError('Parsing error: ' + e);
    }
  });
}

function findGalleryPosition(gUrl) {
  let dir = 0;
  const sel = gUrl.split('#')[1];
  if (sel) {
    if (/^[0-9]+$/.test(sel)) {
      dir += parseInt(sel);
    } else {
      for (let i = app.gItems.length; i--;) {
        const url = ensureArray(app.gItems[i].url)[0];
        const file = url.substr(url.lastIndexOf('/') + 1);
        if (file.includes(sel)) {
          dir += i;
          break;
        }
      }
    }
  }
  return dir;
}

function loadGalleryParser(g) {
  if (typeof g === 'function')
    return g;
  if (typeof g === 'string')
    // eslint-disable-next-line no-new-func
    return new Function('text', 'url', 'cb', g);
  return (text, url) => {
    const qE = g.entry;
    const qC = ensureArray(g.caption);
    const qI = g.image;
    const qT = g.title;
    const fix =
      // eslint-disable-next-line no-new-func
      (typeof g.fix === 'string' ? new Function('s', 'isURL', g.fix) : g.fix) ||
      (s => s.trim());
    const doc = createDoc(text);
    const items = [];
    const nodes = qsa(qE || qI, doc);
    for (const node of nodes) {
      const item = {};
      try {
        item.url = fix(findFile(qE ? qs(qI, node) : node, url), true);
        item.desc = qC.reduce((prev, q) => {
          let n = qs(q, node);
          if (!n) {
            for (const es of [node.previousElementSibling, node.nextElementSibling]) {
              if (es && es.matches(qE) === false)
                n = es.matches(q) ? es : qs(q, es);
            }
          }
          return n ? (prev ? prev + ' - ' : '') + fix(n.textContent) : prev;
        }, '');
      } catch (e) {}
      if (item.url)
        items.push(item);
    }
    const title = qs(qT, doc);
    if (title)
      items.title = fix(title.getAttribute('content') || title.textContent);
    return items;
  };
}

function nextGalleryItem(dir) {
  if (dir > 0 && (app.gIndex += dir) >= app.gItems.length) {
    app.gIndex = 0;
  } else if (dir < 0 && (app.gIndex += dir) < 0) {
    app.gIndex = app.gItems.length - 1;
  }
  const item = app.gItems[app.gIndex];
  if (Array.isArray(item.url)) {
    app.urls = item.url.slice();
    app.url = app.urls.shift();
  } else {
    delete app.urls;
    app.url = item.url;
  }
  setPopup(false);
  startSinglePopup(app.url);
  showFileInfo();
  preloadNextGalleryItem(dir);
}

function preloadNextGalleryItem(dir) {
  const idx = app.gIndex + dir;
  if (app.popup && idx >= 0 && idx < app.gItems.length) {
    const url = ensureArray(app.gItems[idx].url)[0];
    on(app.popup, 'load', () => {
      doc.createElement('img').src = url;
    }, {once: true});
  }
}

function activate(node, force) {
  const info = parseNode(node);
  if (!info || !info.url || info.node === app.node)
    return;
  if (info.distinct && !force) {
    const scale = findScale(info.url, info.node.parentNode);
    if (scale && scale < cfg.scale)
      return;
  }
  if (app.node)
    deactivate();
  app = info;
  app.view = viewRect();
  app.zooming = includes(cfg.css, 'mpiv-zooming');
  for (const n of [app.node.parentNode, app.node, app.node.firstElementChild]) {
    if (n && n.title && n.title !== n.textContent && !doc.title.includes(n.title) &&
        !/^http\S+$/.test(n.title)) {
      app.tooltip = {
        node: n,
        text: n.title,
      };
      n.title = '';
      break;
    }
  }
  on(doc, 'mousemove', onMouseMove, {passive: true});
  on(doc, 'mouseout', onMouseOut, {passive: true});
  on(doc, 'mousedown', onMouseDown, {passive: true});
  on(doc, 'contextmenu', onContext);
  on(doc, 'keydown', onKeyDown);
  on(doc, 'keyup', onKeyUp);
  on(doc, 'onwheel' in doc ? 'wheel' : 'mousewheel', onMouseScroll, {passive: false});
  return true;
}

function deactivate(wait) {
  clearTimeout(app.timeout);
  try {
    app.req.abort();
  } catch (e) {}
  if (app.tooltip)
    app.tooltip.node.title = app.tooltip.text;
  updateTitle(true);
  setStatus(false);
  setPopup(false);
  setBar(false);
  app = {};
  off(doc, 'mousemove', onMouseMove);
  off(doc, 'mouseout', onMouseOut);
  off(doc, 'mousedown', onMouseDown);
  off(doc, 'contextmenu', onContext);
  off(doc, 'keydown', onKeyDown);
  off(doc, 'keyup', onKeyUp);
  off(doc, 'onwheel' in doc ? 'wheel' : 'mousewheel', onMouseScroll);
  if (wait) {
    enabled = false;
    setTimeout(() => {
      enabled = true;
    }, 200);
  }
}

function parseNode(node) {
  let a, img, url, info;
  if (!hostRules)
    hostRules = loadHosts();
  if (tag(node) === 'A') {
    a = node;
  } else {
    if (tag(node) === 'IMG') {
      img = node;
      if (!img.src.startsWith('data:'))
        url = rel2abs(img.src, location.href);
    }
    info = findInfo(url, node);
    if (info)
      return info;
    a = node.closest('a') || false;
  }
  if (a) {
    url =
      a.getAttribute('data-expanded-url') || a.getAttribute('data-full-url') ||
      a.getAttribute('data-url') || a.href;
    if (url.length > 750 || url.startsWith('data:')) {
      url = false;
    } else if (url.includes('//t.co/')) {
      url = 'http://' + a.textContent;
    }
    info = findInfo(url, a);
    if (info)
      return info;
  }
  if (img) {
    return lazyGetRect({
      url: img.src,
      node: img,
      distinct: true,
    }, img);
  }
}

function findInfo(url, node, {noHtml, skipRule} = {}) {
  const tn = tag(node);
  let m, html, urls;
  for (const rule of hostRules) {
    if (rule === skipRule || rule.e && !node.matches(rule.e))
      continue;
    if (!noHtml && rule.r && rule.html && (tn === 'A' || tn === 'IMG' || rule.e))
      m = rule.r.exec(html || (html = node.outerHTML));
    else if (url)
      m = (rule.r || rule.u) ?
        makeUrlMatch(url, node, rule) :
        makeDummyMatch(url);
    if (!m ||
        // a rule with follow:true for the currently hovered IMG produced a URL,
        // but we'll only allow it to match rules without 's' in the nested findInfo call
        tn === 'IMG' && !('s' in rule) && !skipRule)
      continue;
    urls = rule.s ? makeSubstitution(node, rule, m) : [m.input];
    if (!urls.skipRule) {
      const url = urls[0];
      return !url ? null :
        isFollowableUrl(url, rule) ?
          findInfo(url, node, {skipRule: rule}) :
          makeInfo(urls, node, rule, m);
    }
  }
}

function makeUrlMatch(url, node, rule) {
  let {r, u} = rule;
  let m;
  if (u) {
    u = rule._u || (rule._u = compileSimpleUrlMatch(u));
    m = u.fn(url, u.needle) && (r || makeDummyMatch(url));
  }
  return (m || !u) && r ? r.exec(url) : m;
}

function makeDummyMatch(url) {
  const m = [url];
  m.index = 0;
  m.input = url;
  return m;
}

function makeSubstitution(node, rule, m) {
  let urls = [];
  for (const s of ensureArray(rule.s))
    urls.push(
      typeof s === 'string' ? decodeURIComponent(replace(s, m)) :
        typeof s === 'function' ? s(m, node) :
          s);
  if (rule.q && urls.length > 1) {
    console.warn('Rule %o discarded: "s" array is not allowed with "q"', rule);
    return 'skipRule';
  }
  if (Array.isArray(urls[0]))
    urls = urls[0];
  // `false` returned by "s" property means "skip this rule"
  // any other falsy value (like say "") means "cancel all rules"
  return urls[0] === false ?
    {skipRule: true} :
    urls.map(u => u ? decodeURIComponent(u) : u);
}

function makeInfo(urls, node, rule, m) {
  const url = urls[0];
  const info = {
    node,
    url,
    urls: urls.length > 1 ? urls.slice(1) : null,
    c: rule.c,
    g: rule.g ? loadGalleryParser(rule.g) : rule.g,
    q: rule.q,
    r: rule.r,
    u: rule.u,
    css: rule.css,
    distinct: rule.distinct,
    follow: rule.follow,
    manual: rule.manual,
    post: typeof rule.post === 'function' ? rule.post(m) : rule.post,
    tabfix: rule.tabfix,
    xhr: cfg.xhr && rule.xhr,
  };
  lazyGetRect(info, node, rule.rect);
  if (
    onDomain('||twitter.com^') && !/(facebook|google|twimg|twitter)\.com\//.test(url) ||
    onDomain('||github.com^') && !/github/.test(url) ||
    onDomain('||facebook.com^') && /\bimgur\.com/.test(url)
  ) {
    info.xhr = 'data';
  }
  return info;
}

function isFollowableUrl(url, {s, q, follow}) {
  return s && !q && (typeof follow === 'function' ? follow(url) : follow);
}

function downloadPage(url, cb) {
  let req;
  const opts = {
    url,
    method: 'GET',
    onload: res => {
      try {
        if (req !== app.req)
          return;
        app.req = null;
        if (res.status >= 400)
          throw 'Server error: ' + res.status;
        cb(res.responseText, res.finalUrl || url);
      } catch (e) {
        handleError(e);
      }
    },
    onerror: res => {
      if (req === app.req)
        handleError(res);
    },
  };
  if (app.post) {
    opts.method = 'POST';
    opts.data = app.post;
    opts.headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': url,
    };
  }
  app.req = req = GM_xmlhttpRequest(opts);
}

function downloadImage(url, referer) {
  const start = Date.now();
  let bar;
  let req;
  app.req = req = GM_xmlhttpRequest({
    url,
    method: 'GET',
    responseType: 'blob',
    headers: {
      'Accept': 'image/png,image/*;q=0.8,*/*;q=0.5',
      'Referer': referer,
    },
    onprogress: e => {
      if (req !== app.req)
        return;
      if (!bar && Date.now() - start > 3000 && e.loaded / e.total < 0.5)
        bar = true;
      if (bar) {
        setBar(
          `${(e.loaded / e.total * 100).toFixed()}% of ${(e.total / 1000000).toFixed(1)} MB`,
          'xhr');
      }
    },
    onload: res => {
      try {
        if (req !== app.req)
          return;
        app.req = null;
        setBar(false);
        if (res.status >= 400)
          throw 'HTTP error ' + res.status;
        let type;
        if (/Content-Type:\s*(.+)/i.exec(res.responseHeaders) &&
            !RegExp.$1.includes('text/plain'))
          type = RegExp.$1;
        if (!type) {
          const ext = /\.([a-z0-9]+?)($|\?|#)/i.exec(url) ? RegExp.$1.toLowerCase() : 'jpg';
          const types = {
            bmp: 'image/bmp',
            gif: 'image/gif',
            jpe: 'image/jpeg',
            jpeg: 'image/jpeg',
            jpg: 'image/jpeg',
            mp4: 'video/mp4',
            png: 'image/png',
            svg: 'image/svg+xml',
            tif: 'image/tiff',
            tiff: 'image/tiff',
            webm: 'video/webm',
          };
          type = types[ext] || 'application/octet-stream';
        }
        let b = res.response;
        if (b.type !== type)
          b = b.slice(0, b.size, type);
        if (URL && app.xhr !== 'data')
          return setPopup(URL.createObjectURL(b));
        const fr = new FileReader();
        fr.onload = () => {
          setPopup(fr.result);
        };
        fr.onerror = handleError;
        fr.readAsDataURL(b);
      } catch (e) {
        handleError(e);
      }
    },
    onerror: res => {
      if (req === app.req)
        handleError(res);
    },
  });
}

function findRedirect(url, cb) {
  let req;
  app.req = req = GM_xmlhttpRequest({
    url,
    method: 'HEAD',
    headers: {Referer: location.href.replace(location.hash, '')},
    onload: res => {
      if (req === app.req)
        cb(res.finalUrl);
    },
  });
}

function findFile(n, url) {
  const base = qs('base[href]', n.ownerDocument);
  const path =
    n.getAttribute('src') ||
    n.getAttribute('data-m4v') ||
    n.getAttribute('href') ||
    n.getAttribute('content') ||
    /https?:\/\/[./a-z0-9_+%-]+\.(jpe?g|gif|png|svg|webm|mp4)/i.exec(n.outerHTML) &&
      RegExp.lastMatch;
  return path ? rel2abs(path.trim(), base ? base.getAttribute('href') : url) : false;
}

function findCaption(n) {
  return !n ? '' :
    n.getAttribute('content') ||
    n.getAttribute('title') ||
    n.textContent;
}

function checkProgress(start) {
  const {interval} = checkProgress;
  if (start === true) {
    clearInterval(interval);
    checkProgress.interval = setInterval(checkProgress, 150);
    return;
  }
  const p = app.popup;
  if (!p) {
    clearInterval(interval);
    return;
  }
  if (!updateSize())
    return;
  clearInterval(interval);
  if (app.preloadStart) {
    const wait = app.preloadStart + cfg.delay - Date.now();
    if (wait > 0) {
      app.timeout = setTimeout(checkProgress, wait);
      return;
    }
  }
  if (app.urls && app.urls.length && Math.max(app.nheight, app.nwidth) < 130) {
    handleError({type: 'error'});
    return;
  }
  setStatus(false);
  // do a forced layout
  p.clientHeight;
  p.className = 'mpiv-show';
  updateSpacing();
  updateScales();
  updateTitle();
  placePopup();
  if (!app.bar)
    showFileInfo();
  app.large = app.nwidth > p.clientWidth + app.mbw ||
              app.nheight > p.clientHeight + app.mbh;
  if (app.large)
    setStatus('large');
  if (cfg.imgtab && isImageTab || cfg.zoom === 'auto')
    toggleZoom();
}

function updateSize() {
  const p = app.popup;
  app.nheight = p.naturalHeight || p.videoHeight || p.__loaded && 800;
  app.nwidth = p.naturalWidth || p.videoWidth || p.__loaded && 1200;
  return !!app.nheight;
}

function updateSpacing() {
  const s = getComputedStyle(app.popup);
  app.outline = (parseFloat(s['outline-offset']) || 0) +
                (parseFloat(s['outline-width']) || 0);
  app.pw = (parseFloat(s['padding-left']) || 0) +
           (parseFloat(s['padding-right']) || 0);
  app.ph = (parseFloat(s['padding-top']) || 0) +
           (parseFloat(s['padding-bottom']) || 0);
  app.mbw = (parseFloat(s['margin-left']) || 0) +
            (parseFloat(s['margin-right']) || 0) +
            (parseFloat(s['border-left-width']) || 0) +
            (parseFloat(s['border-right-width']) || 0);
  app.mbh = (parseFloat(s['margin-top']) || 0) +
            (parseFloat(s['margin-bottom']) || 0) +
            (parseFloat(s['border-top-width']) || 0) +
            (parseFloat(s['border-bottom-width']) || 0);
}

function updateScales() {
  const scales = cfg.scales.length ? cfg.scales :
    ['0!', 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8, 16];
  const fit = Math.min(
    (app.view.width - app.mbw - app.outline * 2) / app.nwidth,
    (app.view.height - app.mbh - app.outline * 2) / app.nheight);
  let cutoff = app.scale = Math.min(1, fit);
  app.scales = [];
  for (let i = scales.length; i--;) {
    const val = parseFloat(scales[i]) || fit;
    const opt = typeof scales[i] === 'string' ? scales[i].slice(-1) : 0;
    if (opt === '!')
      cutoff = val;
    if (opt === '*')
      app.zscale = val;
    if (val !== app.scale)
      app.scales.push(val);
  }
  app.scales = app.scales.filter(x => x >= cutoff);
  app.scales.sort((a, b) => a - b);
  app.scales.unshift(app.scale);
}

function updateMouse(e) {
  app.cx = e.clientX;
  app.cy = e.clientY;
  const r = app.rect;
  if (r)
    app.cr = app.cx < r.right + 2 &&
             app.cx > r.left - 2 &&
             app.cy < r.bottom + 2 &&
             app.cy > r.top - 2;
}

function showFileInfo() {
  const gi = app.gItems;
  if (gi) {
    const item = gi[app.gIndex];
    let c = gi.length > 1 ? '[' + (app.gIndex + 1) + '/' + gi.length + '] ' : '';
    if (app.gIndex === 0 && gi.title && (!item.desc || !includes(item.desc, gi.title)))
      c += gi.title + (item.desc ? ' - ' : '');
    if (item.desc)
      c += item.desc;
    if (c)
      setBar(c.trim(), 'gallery', true);
  } else if ('caption' in app) {
    setBar(app.caption, 'caption');
  } else if (app.tooltip) {
    setBar(app.tooltip.text, 'tooltip');
  }
}

function updateTitle(reset) {
  if (reset) {
    if (typeof app.title === 'string' && doc.title !== app.title)
      doc.title = app.title;
  } else {
    if (typeof app.title !== 'string')
      app.title = doc.title;
    doc.title = `${Math.round(app.scale * 100)}% - ${app.nwidth}x${app.nheight}`;
  }
}

function placePopup() {
  const p = app.popup;
  if (!p)
    return;
  let x, y;
  const w = Math.round(app.scale * app.nwidth);
  const h = Math.round(app.scale * app.nheight);
  const cx = app.cx;
  const cy = app.cy;
  const vw = app.view.width - app.outline * 2;
  const vh = app.view.height - app.outline * 2;
  if (!app.zoom && (!app.gItems || app.gItems.length < 2) && !cfg.center) {
    const r = app.rect;
    const rx = (r.left + r.right) / 2;
    const ry = (r.top + r.bottom) / 2;
    if (vw - r.right - 40 > w + app.mbw || w + app.mbw < r.left - 40) {
      if (h + app.mbh < vh - 60)
        y = clamp(ry - h / 2, 30, vh - h - 30);
      x = rx > vw / 2 ? r.left - 40 - w : r.right + 40;
    } else if (vh - r.bottom - 40 > h + app.mbh || h + app.mbh < r.top - 40) {
      if (w + app.mbw < vw - 60)
        x = clamp(rx - w / 2, 30, vw - w - 30);
      y = ry > vh / 2 ? r.top - 40 - h : r.bottom + 40;
    }
  }
  if (x === undefined) {
    const mid = vw > w ?
      vw / 2 - w / 2 :
      -1 * clamp(5 / 3 * (cx / vw - 0.2), 0, 1) * (w - vw);
    x = Math.round(mid - (app.pw + app.mbw) / 2);
  }
  if (y === undefined) {
    const mid = vh > h ?
      vh / 2 - h / 2 :
      -1 * clamp(5 / 3 * (cy / vh - 0.2), 0, 1) * (h - vh);
    y = Math.round(mid - (app.ph + app.mbh) / 2);
  }
  p.style.cssText = `
    width: ${w}px !important;
    height: ${h}px !important;
    left: ${x + app.outline}px !important;
    top: ${y + app.outline}px !important;
  `;
}

function toggleZoom() {
  const p = app.popup;
  if (!p || !app.scales || app.scales.length < 2)
    return;
  app.zoom = !app.zoom;
  app.zoomed = true;
  const z = app.scales.indexOf(app.zscale);
  app.scale = app.scales[app.zoom ? (z > 0 ? z : 1) : 0];
  if (app.zooming)
    p.classList.add('mpiv-zooming');
  placePopup();
  updateTitle();
  setStatus(app.zoom ? 'zoom' : false);
  if (cfg.zoom !== 'auto')
    setBar(false);
  if (!app.zoom)
    showFileInfo();
  return app.zoom;
}

function handleError(o) {
  const error = o.message || (
    o.readyState ?
      'Request failed.' :
      (o.type === 'error' ?
        'File can\'t be displayed.' +
        (qs('div[bgactive*="flashblock"]', doc) ? ' Check Flashblock settings.' : '') :
        o));
  const m = [
    [`${GM_info.script.name}: %c${error}%c`, 'font-weight:bold;color:yellow'],
    ['', 'font-weight:normal;color:unset'],
  ];
  try {
    if (o.stack)
      m.push(['@ %s', o.stack.replace(/<?@file:.+?\.js/g, '')]);
    if (app.u)
      m.push(['Url simple match: %o', app.u]);
    if (app.r)
      m.push(['RegExp match: %o', app.r]);
    if (app.url)
      m.push(['URL: %s', app.url]);
    if (app.iurl && app.iurl !== app.url)
      m.push(['File: %s', app.iurl]);
    m.push(['Node: %o', app.node]);
    const control = m.map(([k]) => k).filter(Boolean).join('\n');
    console.log(control, ...m.map(([, v]) => v));
  } catch (e) {}
  if (onDomain('||google.') &&
      location.search.includes('tbm=isch') &&
      !app.xhr && cfg.xhr) {
    app.xhr = true;
    startSinglePopup(app.url);
  } else if (app.urls && app.urls.length) {
    app.url = app.urls.shift();
    if (!app.url) {
      deactivate();
    } else {
      startSinglePopup(app.url);
    }
  } else if (app.node) {
    setStatus('error');
    setBar(error, 'error');
  }
}

function setStatus(status, flag) {
  const el = doc.documentElement;
  let cls = el.className.split(/\s+/);
  if (flag === 'remove') {
    const i = cls.indexOf('mpiv-' + status);
    i >= 0 && cls.splice(i, 1);
  } else {
    if (flag !== 'add')
      cls = cls.filter(c => !/^mpiv-\w+$/.test(c));
    if (status && !cls.includes('mpiv-' + status))
      cls.push('mpiv-' + status);
  }
  const s = cls.join(' ');
  if (el.className !== s)
    el.className = s;
}

function setPopup(src) {
  let p = app.popup;
  if (p) {
    app.zoom = false;
    off(p, 'error', handleError);
    if (typeof p.pause === 'function')
      p.pause();
    if (!app.lazyUnload) {
      if (p.src.startsWith('blob:'))
        URL.revokeObjectURL(p.src);
      p.src = '';
    }
    p && p.remove();
    delete app.popup;
  }
  if (!src)
    return;
  if (src.startsWith('data:video') ||
      !src.startsWith('data:') && /\.(webm|mp4)($|\?)/.test(src)) {
    const start = Date.now();
    let bar;
    const onProgress = e => {
      const p = e.target;
      if (!p.duration || !p.buffered.length || Date.now() - start < 2000)
        return;
      const per = Math.round(p.buffered.end(0) / p.duration * 100);
      if (!bar && per > 0 && per < 50)
        bar = true;
      if (bar)
        setBar(per + '% of ' + Math.round(p.duration) + 's', 'xhr');
    };
    p = app.popup = doc.createElement('video');
    p.autoplay = true;
    p.loop = true;
    p.volume = 0.5;
    p.controls = false;
    on(p, 'progress', onProgress);
    on(p, 'canplaythrough', e => {
      off(e.target, 'progress', onProgress);
      if (app.bar && app.bar.classList.contains('mpiv-xhr')) {
        setBar(false);
        showFileInfo();
      }
    });
  } else {
    p = app.popup = doc.createElement('img');
  }
  p.id = 'mpiv-popup';
  p.src = src;
  on(p, 'error', handleError);
  on(p, 'load', ({target}) => (target.__loaded = true), {once: true});
  if (app.zooming)
    on(p, 'transitionend', e =>
      e.target.classList.remove('mpiv-zooming'));
  app.bar ? doc.body.insertBefore(p, app.bar) : doc.body.appendChild(p);
  p = null;
  checkProgress(true);
}

function setBar(label, cn) {
  let b = app.bar;
  if (!label) {
    b && b.remove();
    delete app.bar;
    return;
  }
  if (!b) {
    b = app.bar = doc.createElement('div');
    b.id = 'mpiv-bar';
  }
  updateStyles();
  b.innerHTML = label;
  if (!b.parentNode) {
    doc.body.appendChild(b);
    // do a forced layout
    b.clientHeight;
  }
  b.className = 'mpiv-show mpiv-' + cn;
}

function rel2abs(rel, abs) {
  if (rel.startsWith('data:'))
    return rel;
  const rx = /^([a-z]+:)\/\//;
  if (rx.test(rel))
    return rel;
  if (!rx.exec(abs))
    return;
  if (rel.indexOf('//') === 0)
    return RegExp.$1 + rel;
  if (rel[0] === '/')
    return abs.substr(0, abs.indexOf('/', RegExp.lastMatch.length)) + rel;
  return abs.substr(0, abs.lastIndexOf('/')) + '/' + rel;
}

function replace(s, m) {
  if (!m)
    return s;
  if (s.startsWith('/') && !s.startsWith('//')) {
    const mid = /[^\\]\//.exec(s).index + 1;
    const end = s.lastIndexOf('/');
    const re = new RegExp(s.slice(1, mid), s.slice(end + 1));
    return m.input.replace(re, s.slice(mid + 1, end));
  }
  if (m.length && s.includes('$')) {
    const maxLength = Math.floor(Math.log10(m.length)) + 1;
    s = s.replace(/\$(\d{1,3})/g, (text, num) => {
      for (let i = maxLength; i >= 0; i--) {
        const part = num.slice(0, i) | 0;
        if (part < m.length)
          return (m[part] || '') + num.slice(i);
      }
      return text;
    });
  }
  return s;
}

function findScale(url, parent) {
  const imgs = qsa('img, video', parent);
  for (let i = imgs.length, img; (img = imgs[--i]);) {
    if ((img.src || img.currentSrc) !== url)
      continue;
    const s = Math.max((img.naturalHeight || img.videoHeight) / img.offsetHeight,
      (img.naturalWidth || img.videoWidth) / img.offsetWidth);
    if (isFinite(s))
      return s;
  }
}

function viewRect() {
  const node = doc.compatMode === 'BackCompat' ? doc.body : doc.documentElement;
  return {
    width: node.clientWidth,
    height: node.clientHeight,
  };
}

function rect(node, q) {
  let n;
  if (q && (n = node.closest(q)))
    return n.getBoundingClientRect();
  const nodes = qsa('*', node);
  for (let i = nodes.length; i-- && (n = nodes[i]);) {
    if (n.offsetHeight > node.offsetHeight)
      node = n;
  }
  return node.getBoundingClientRect();
}

function lazyGetRect(obj, ...args) {
  return Object.defineProperty(obj, 'rect', {
    configurable: true,
    get() {
      const value = rect(...args);
      Object.defineProperty(obj, 'rect', {value, configurable: true});
      return value;
    },
  });
}

function tag(n) {
  return n && n.tagName || '';
}

function createDoc(text) {
  if (!domParser)
    domParser = new DOMParser();
  return domParser.parseFromString(text, 'text/html');
}

function on(n, e, f, options) {
  n.addEventListener(e, f, options);
}

function off(n, e, f, options) {
  n.removeEventListener(e, f, options);
}

function drop(e) {
  e.preventDefault();
  e.stopPropagation();
}

function qs(s, n) {
  return n.querySelector(s);
}

function qsa(s, n) {
  return n.querySelectorAll(s);
}

function qsMany(q, doc) {
  for (const selector of q ? ensureArray(q) : []) {
    const el = qs(selector, doc);
    if (el)
      return el;
  }
}

function includes(a, b) {
  return typeof a === 'string' && a.includes(b);
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [v];
}

function tryCatch(fn, ...args) {
  try {
    return fn.apply(this, args);
  } catch (e) {}
}

function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch (e) {}
}

function setup() {
  let div, root;

  function $(s) {
    return root.getElementById(s);
  }

  function close() {
    const el = doc.getElementById(SETUP_ID);
    el && el.remove();
    if (!trusted.includes(hostname))
      off(window, 'message', onMessage);
  }

  function update() {
    $('delay').parentNode.style.display =
      $('preload').parentNode.style.display = $('start-auto').selected ? '' : 'none';
  }

  function check(e) {
    const t = e.target;
    let ok, json;
    try {
      const pes = t.previousElementSibling;
      if (t.value) {
        if (!pes) {
          const inp = t.cloneNode();
          inp.value = '';
          t.insertAdjacentElement('beforebegin', inp);
        }
        json = JSON.parse(t.value);
        if (json.r)
          new RegExp(json.r);
      } else if (pes) {
        pes.focus();
        t && t.remove();
      }
      ok = 1;
    } catch (e) {}
    t.__json = json;
    t.style.backgroundColor = ok ? '' : '#ffaaaa';
  }

  function exp(e) {
    drop(e);
    const s = JSON.stringify(getCfg());
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(s);
      alert('Settings copied to clipboard!');
    } else {
      alert(s);
    }
  }

  function imp(e) {
    drop(e);
    const s = prompt('Paste settings:');
    if (s)
      init(fixCfg(s));
  }

  function install(e) {
    drop(e);
    e.target.parentNode.innerHTML = `
      <span>Loading...</span>
      <iframe
          src="https://w9p.co/userscripts/mpiv/more_host_rules.html"
          onload="
            this.style.display = '';
            this.previousElementSibling.style.display = 'none';
          "
          style="
            width: 100%;
            height: 26px;
            border: 0;
            margin: 0;
            display: none;
          "></iframe>
    `;
  }

  function getCfg() {
    const cfg = {};
    const delay = parseInt($('delay').value);
    if (!isNaN(delay) && delay >= 0)
      cfg.delay = delay;
    const scale = parseFloat($('scale').value.replace(',', '.'));
    if (!isNaN(scale))
      cfg.scale = Math.max(1, scale);
    cfg.start =
      $('start-context').selected ? 'context' : ($('start-ctrl').selected ? 'ctrl' : 'auto');
    cfg.zoom =
      $('zoom-context').selected ?
        'context' :
        ($('zoom-wheel').selected ? 'wheel' : ($('zoom-shift').selected ? 'shift' : 'auto'));
    cfg.center = $('center').checked;
    cfg.imgtab = $('imgtab').checked;
    cfg.close = $('close').selected;
    cfg.preload = $('preload').checked;
    cfg.css = $('css').value.trim();
    cfg.scales = $('scales').value
      .trim()
      .split(/[,;]*\s+/)
      .map(x => x.replace(',', '.'))
      .filter(x => !isNaN(parseFloat(x)));
    cfg.xhr = $('xhr').checked;
    cfg.hosts = [...$('hosts').children]
      .map(el => [el.value.trim(), el.__json])
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      .map(([s, json]) => json || s)
      .filter(Boolean);
    return fixCfg(cfg);
  }

  function init(cfg) {
    close();
    if (!trusted.includes(hostname))
      on(window, 'message', onMessage);
    div = doc.createElement('div');
    div.id = SETUP_ID;
    div.contentEditable = true;
    root = div.attachShadow({mode: 'open'});
    root.innerHTML = `
      <style>
        :host {
          all: initial !important;
          position: fixed !important;
          z-index: 2147483647 !important;
          top: 20px !important;
          right: 20px !important;
          padding: 20px 30px !important;
          color: #000 !important;
          background: #eee !important;
          box-shadow: 5px 5px 25px 2px #000 !important;
          width: 640px !important;
          border: 1px solid black !important;
          display: flex !important;
          flex-direction: column !important;
        }
        main {
          font: 12px/15px sans-serif;
        }
        ul {
          max-height: calc(100vh - 200px);
          margin: 10px 0 15px 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
        }
        li {
          margin: 0;
          padding: 2px 0;
          vertical-align: middle;
        }
        input, select, #css {
          border: 1px solid gray;
          padding: 2px;
        }
        textarea {
          resize: vertical;
          width: 98%;
          margin: 1px 0;
          font-family: Consolas, monospace;
        }
        #scales {
          width: 130px;
        }
        #zoom {
          margin-right: 18px;
        }
        #delay, #scale {
          width: 36px;
        }
        #cursor, #imgtab, #xhr, #preload {
          margin-left: 18px;
        }
        #hosts {
          padding: 2px;
          margin: 4px 0;
          clear: both;
        }
        #hosts textarea {
          word-break: break-all;
        }
        #search {
          float: right;
        }
        button {
          width: 150px;
          margin: 0 10px;
        }
        @media (prefers-color-scheme: dark) {
          :host {
            color: #aaa !important;
            background: #333 !important;
          }
          a {
            color: deepskyblue;
          }
        }
      </style>
      <main>
        <div>
          <a href="https://w9p.co/userscripts/mpiv/">Mouseover Popup Image Viewer</a>
          <span style="float:right">
            <a href="#" id="import">Import</a> |
            <a href="#" id="export">Export</a>
          </span>
        </div>
        <ul>
          <li>
            <label>
              Popup:
              <select>
                <option id="start-auto">automatically
                <option id="start-context">right click or ctrl
                <option id="start-ctrl">ctrl
              </select>
            </label>
            <label>after <input id="delay"> ms</label>
            <label><input type="checkbox" id="preload"> Start loading immediately</label>
          </li>
          <li>
            <label>
              Only show popup over scaled-down image when natural size is
              <input id="scale"> times larger
            </label>
          </li>
          <li>
            <label><input type="checkbox" id="center"> Always centered</label>
            <label><input type="checkbox" id="imgtab"> Run in image tabs</label>
            <label><input type="checkbox" id="xhr" onclick="
              return this.checked ||
                     confirm('Do not disable this unless you spoof the HTTP headers yourself.')">
              Anti-hotlinking workaround
            </label>
          </li>
          <li>
            <label>
              Zoom:
              <select id="zoom">
                <option id="zoom-context">right click or shift
                <option id="zoom-wheel">wheel up or shift
                <option id="zoom-shift">shift
                <option id="zoom-auto">automatically
              </select>
            </label>
            <label>
              Custom scale factors: <input id="scales" placeholder="e.g. 0 0.5 1* 2">
            </label>
            <span title="values smaller than non-zoomed size are ignored,
                         0 = fit to window, 0! = same as 0 but also removes smaller values,
                         asterisk after value marks default zoom factor (e.g. 1*)"
                  style="cursor:help">(?)</span>
          </li>
          <li>
            <label>
              If zooming out further is not possible,
              <select>
                <option>stay in zoom mode
                <option id="close">close popup
              </select>
            </label>
          </li>
          <li>
            <a href="https://w9p.co/userscripts/mpiv/css.html" target="_blank">Custom CSS:</a>
            <div><textarea id="css" spellcheck="false"></textarea></div>
          </li>
          <li style="overflow-y:auto">
            <a href="https://w9p.co/userscripts/mpiv/host_rules.html"
               target="_blank">Custom host rules:</a>
            <input id="search" type="search" placeholder="Search">
            <div id="hosts"><textarea rows="1" spellcheck="false"></textarea></div>
          </li>
          <li>
            <a href="#" id="install">Install rule from repository...</a>
          </li>
        </ul>
        <div style="text-align:center">
          <button id="ok">OK</button>
          <button id="cancel">Cancel</button>
        </div>
      </main>
    `;
    if (cfg.hosts) {
      const parent = $('hosts');
      const template = parent.firstElementChild;
      for (const rule of cfg.hosts) {
        const el = template.cloneNode();
        el.value = typeof rule === 'string' ? rule : JSON.stringify(rule);
        parent.appendChild(el);
        check({target: el});
      }
      on(parent, 'focusin', ({target: el}) => {
        if (el !== parent) {
          const h = clamp(el.scrollHeight, 15, div.clientHeight / 4);
          if (h > el.offsetHeight)
            el.style.height = h + 'px';
        }
      });
      on(parent, 'focusout', ({target: el}) => {
        if (el !== parent && el.style.height)
          el.style.height = '';
      });
      const se = $('search');
      const doSearch = () => {
        const s = se.value.toLowerCase();
        setup.search = s;
        for (const el of $('hosts').children)
          el.hidden = s && !el.value.toLowerCase().includes(s);
      };
      let timer;
      on(se, 'input', e => {
        clearTimeout(timer);
        setTimeout(doSearch, 200);
      });
      se.value = setup.search || '';
      if (se.value)
        doSearch();
    }
    // prevent the main page from interpreting key presses in inputs as hotkeys
    // which may happen since it sees only the outer <div> in the event |target|
    on(root, 'keydown', e => !e.altKey && !e.ctrlKey && !e.metaKey && e.stopPropagation(), true);
    on($('start-auto').parentNode, 'change', update);
    on($('cancel'), 'click', close);
    on($('export'), 'click', exp);
    on($('import'), 'click', imp);
    on($('hosts'), 'input', check);
    on($('install'), 'click', install);
    on($('ok'), 'click', () => {
      saveCfg(getCfg());
      hostRules = loadHosts();
      close();
    });
    $('delay').value = cfg.delay;
    $('scale').value = cfg.scale;
    $('center').checked = cfg.center;
    $('imgtab').checked = cfg.imgtab;
    $('close').selected = cfg.close;
    $('preload').checked = cfg.preload;
    $('css').value = cfg.css;
    $('scales').value = cfg.scales.join(' ');
    $('xhr').checked = cfg.xhr;
    $('zoom-' + cfg.zoom).selected = true;
    $('start-' + cfg.start).selected = true;
    update();
    doc.body.appendChild(div);
    requestAnimationFrame(() => {
      $('css').style.height = clamp($('css').scrollHeight, 40, div.clientHeight / 4) + 'px';
    });
  }

  init(loadCfg());
}

function addStyle(name, css) {
  const id = 'mpiv-style:' + name;
  const el = doc.getElementById(id) ||
             css && Object.assign(doc.createElement('style'), {id});
  if (!el)
    return;
  if (el.textContent !== css)
    el.textContent = css;
  if (el.parentElement !== doc.head)
    doc.head.appendChild(el);
  return el;
}

function updateStyles() {
  addStyle('global', /*language=CSS*/ `
    #mpiv-bar {
      position: fixed;
      z-index: 2147483647;
      left: 0;
      right: 0;
      top: 0;
      transform: scaleY(0);
      -webkit-transform: scaleY(0);
      transform-origin: top;
      -webkit-transform-origin: top;
      transition: transform 500ms ease 1000ms;
      -webkit-transition: -webkit-transform 500ms ease 1000ms;
      text-align: center;
      font-family: sans-serif;
      font-size: 15px;
      font-weight: bold;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      padding: 4px 10px;
    }
    #mpiv-bar.mpiv-show {
      transform: scaleY(1);
      -webkit-transform: scaleY(1);
    }
    #mpiv-popup.mpiv-show {
      display: inline;
    }
    #mpiv-popup {
      display: none;
      border: 1px solid gray;
      box-sizing: content-box;
      background-color: white;
      position: fixed;
      z-index: 2147483647;
      margin: 0;
      max-width: none;
      max-height: none;
      will-change: display, width, height, left, top;
      cursor: none;
    }
    .mpiv-loading:not(.mpiv-preloading) * {
      cursor: wait !important;
    }
    .mpiv-edge #mpiv-popup {
      cursor: default;
    }
    .mpiv-error * {
      cursor: not-allowed !important;
    }
    .mpiv-ready *, .mpiv-large * {
      cursor: zoom-in !important;
    }
    .mpiv-shift * {
      cursor: default !important;
    }
  `);
  addStyle('config', includes(cfg.css, '{') ? cfg.css : '#mpiv-popup {' + cfg.css + '}');
  addStyle('rule', app.css || '');
}
