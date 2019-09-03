// ==UserScript==
// @name        Mouseover Popup Image Viewer
// @namespace   https://w9p.co/userscripts/
// @description Shows images and videos behind links and thumbnails.

// @include     http*
// @connect-src *

// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_openInTab
// @grant       GM_registerMenuCommand
// @grant       GM_setClipboard

// @version     1.0.3
// @author      tophf

// @original-version 2017.9.29
// @original-author  kuehlschrank

// @homepage    https://w9p.co/userscripts/mpiv/
// @icon        https://w9p.co/userscripts/mpiv/icon.png
// ==/UserScript==

'use strict';
/*
global unsafeWindow
global GM_info
global GM_getValue
global GM_setValue
global GM_xmlhttpRequest
global GM_openInTab
global GM_registerMenuCommand
global GM_setClipboard
*/
/* eslint-disable no-eval, no-new-func */
/* eslint camelcase: [2, {properties: never, allow: ["^GM_\w+"]}] */

const d = document;
const hostname = location.hostname;
const trusted = ['greasyfork.org', 'w9p.co'];
const imgtab = d.images.length === 1 && d.images[0].parentNode === d.body && !d.links.length;

// string-to-regexp escaped chars
const RX_ESCAPE = /[.+*?(){}[\]^$|]/g;
// rx for '^' symbol in simple url match
const RX_SEP = /[^\w%._-]/g;
const testEndSep = s => {
  RX_SEP.lastIndex = s.length - 1;
  return RX_SEP.test(s);
};

let cfg = loadCfg();
let enabled = cfg.imgtab || !imgtab;
let _ = {};
let hosts;

on(d, 'mouseover', onMouseOver, {passive: true});

if (contains(hostname, 'google')) {
  const node = d.getElementById('main');
  if (node)
    on(node, 'mouseover', onMouseOver, {passive: true});
} else if (contains(trusted, hostname)) {
  on(window, 'message', onMessage);
  on(d, 'click', e => {
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

  array: (s, arr) => {
    for (const {fn, needle} of arr)
      if (fn(s, needle))
        return true;
  },

  equals: (s, needle) =>
    s.length === needle.length ? s === needle :
      s.length === needle.length + 1 && s.startsWith(needle) && testEndSep(s),

  starts: (s, needle) =>
    s.startsWith(needle),

  ends: (s, needle) =>
    s.endsWith(needle) ||
    s.length > needle.length &&
    s.indexOf(needle, s.length - needle.length - 1) >= 0 &&
    testEndSep(s),

  has: (s, needle) =>
    s.includes(needle),

  rx: (s, needle) =>
    needle.test(s),

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

function compileSimpleUrlMatch(match) {
  const results = [];
  for (const s of (Array.isArray(match) ? match : [match])) {
    const pinDomain = s.startsWith('||');
    const pinStart = !pinDomain && s.startsWith('|');
    const endSep = s.endsWith('^');
    const i = pinDomain * 2 + pinStart;
    let fn;
    let needle = i || endSep ? s.slice(i, -endSep || undefined) : s;
    if (needle.includes('^')) {
      needle = new RegExp(
        (pinStart ? '^' : '') +
        (pinDomain ? '(?:\\.|//)' : '') +
        needle.replace(RX_ESCAPE, '\\$&').replace(/\\\^/g, RX_SEP.source) +
        (endSep ? `(?:${RX_SEP.source}|$)}` : ''), 'i');
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

function loadHosts() {
  const customHosts = [];
  for (let h of cfg.hosts || []) {
    try {
      if (typeof h === 'string')
        h = JSON.parse(h);
      if (typeof h.d !== 'string')
        h.d = undefined;
      if (h.r)
        h.r = new RegExp(h.r, 'i');
      if (h.s && typeof h.s === 'string' && contains(h.s, 'return '))
        h.s = new Function('m', 'node', h.s);
      if (h.q && typeof h.q === 'string' && contains(h.q, 'return '))
        h.q = new Function('text', 'doc', 'node', h.q);
      if (contains(h.c, 'return '))
        h.c = new Function('text', 'doc', 'node', h.c);
      customHosts.push(h);
    } catch (ex) {
      handleError('Invalid custom host rule:', h);
    }
  }
  // 'u' works only with URLs so it's ignored if 'html' is true
  // 'r' is checked only if 'u' matches first
  const hosts = [...customHosts, {
    d: 'startpage',
    r: /\boiu=(.+)/,
    s: '$1',
    follow: true,
  }, {
    r: /[/?=](https?[^&]+)/,
    s: '$1',
    follow: true,
  }, {
    d: '||4chan.org^',
    e: '.is_catalog .thread a[href*="/thread/"], .catalog-thread a[href*="/thread/"]',
    q: '.op .fileText a',
    css: '#post-preview{display:none}',
  }, {
    u: '||500px.com/photo/',
    q: 'meta[property="og:image"]',
  }, {r: /attachment\.php.+attachmentid/},
  {
    u: '||abload.de/image',
    q: '#image',
  }, {
    d: '||amazon.',
    u: 'amazon.com/images/I/',
    r: /(https?:\/\/[.a-z-]+amazon\.com\/images\/I\/.+?)\./,
    s: m => {
      const uh = d.getElementById('universal-hover');
      return uh ? '' : m[1] + '.jpg';
    },
    css: '#zoomWindow{display:none!important;}',
  }, {
    u: [
      '||chronos.to/t/',
      '||coreimg.net/t/',
    ],
    r: /([^/]+)\/t\/([0-9]+)\/([0-9]+)\/([a-z0-9]+)/,
    s: 'http://i$2.$1/i/$3/$4.jpg',
  }, {
    u: 'pic.me/',
    r: /de?pic\.me\/[0-9a-z]{8,}/,
    q: '#pic',
  }, {
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
  }, {
    u: '||disqus.com/',
    s: '',
  }, {
    u: '||dropbox.com/s',
    r: /com\/sh?\/.+\.(jpe?g|gif|png)/i,
    q: (text, doc) => {
      const i = qs('img.absolute-center', doc);
      return i ? i.src.replace(/(size_mode)=\d+/, '$1=5') : false;
    },
  }, {
    d: '||dropbox.com^',
    r: /(.+?&size_mode)=\d+(.*)/,
    s: '$1=5$2',
  }, {
    r: /[./]ebay\.[^/]+\/itm\//,
    q: text =>
      text.match(/https?:\/\/i\.ebayimg\.com\/[^.]+\.JPG/i)[0]
        .replace(/~~60_\d+/, '~~60_57'),
  }, {
    u: '||i.ebayimg.com/',
    s: (m, node) =>
      qs('.zoom_trigger_mask', node.parentNode) ? '' :
        m.input.replace(/~~60_\d+/, '~~60_57'),
  }, {
    u: '||fastpic.ru/view/',
    q: '#image',
  }, {
    d: '||facebook.com^',
    e: 'a[href*="ref=hovercard"]',
    s: (m, node) =>
      'https://www.facebook.com/photo.php?fbid=' +
      /\/[0-9]+_([0-9]+)_/.exec(qs('img', node).src)[1],
    follow: true,
  }, {
    d: '||facebook.com^',
    r: /(fbcdn|fbexternal).*?(app_full_proxy|safe_image).+?(src|url)=(http.+?)[&"']/,
    s: (m, node) =>
      contains(node.parentNode.className, 'video') && contains(m[4], 'fbcdn') ? '' :
        decodeURIComponent(m[4]),
    html: true,
    follow: true,
  }, {
    u: '||facebook.com/',
    r: /[./]facebook\.com\/(photo\.php|[^/]+\/photos\/)/,
    s: (m, node) =>
      node.id === 'fbPhotoImage' ? false :
        /gradient\.png$/.test(m.input) ? '' :
          m.input.replace('www.facebook.com', 'mbasic.facebook.com'),
    q: 'div + span > a:first-child:not([href*="tag_faces"]), div + span > a[href*="tag_faces"] ~ a',
    rect: '#fbProfileCover',
  }, {
    u: '||fbcdn.',
    r: /fbcdn.+?[0-9]+_([0-9]+)_[0-9]+_[a-z]\.(jpg|png)/,
    s: m => {
      if (/[.^]facebook\.com$/.test(hostname)) {
        try {
          return unsafeWindow.PhotoSnowlift.getInstance().stream.cache.image[m[1]].url;
        } catch (ex) {}
      }
      return false;
    },
    manual: true,
  }, {
    u: ['||fbcdn-', 'fbcdn.net/'],
    r: /(https?:\/\/(fbcdn-[-\w.]+akamaihd|[-\w.]+?fbcdn)\.net\/[-\w/.]+?)_[a-z]\.(jpg|png)(\?[0-9a-zA-Z0-9=_&]+)?/,
    s: (m, node) => {
      if (node.id === 'fbPhotoImage') {
        const a = qs('a.fbPhotosPhotoActionsItem[href$="dl=1"]', d.body);
        if (a)
          return contains(a.href, m.input.match(/[0-9]+_[0-9]+_[0-9]+/)[0]) ? '' : a.href;
      }
      if (m[4])
        return false;
      if (contains(node.parentNode.outerHTML, '/hovercard/'))
        return '';
      const gp = node.parentNode.parentNode;
      if (contains(node.outerHTML, 'profile') && contains(gp.href, '/photo'))
        return false;
      return m[1].replace(/\/[spc][\d.x]+/g, '').replace('/v/', '/') + '_n.' + m[3];
    },
    rect: '.photoWrap',
  }, {
    u: '||firepic.org/?v=',
    q: '.well img[src*="firepic.org"]',
  }, {
    u: '||flickr.com/photos/',
    r: /photos\/([0-9]+@N[0-9]+|[a-z0-9_-]+)\/([0-9]+)/,
    s: m =>
      m.input.indexOf('/sizes/') < 0 ?
        `https://www.flickr.com/photos/${m[1]}/${m[2]}/sizes/sq/` :
        false,
    q: (text, doc) =>
      'https://www.flickr.com' + qsa('.sizes-list a', doc).pop().getAttribute('href'),
    follow: true,
  }, {
    u: '||flickr.com/photos/',
    r: /\/sizes\//,
    q: '#allsizes-photo > img',
  }, {
    u: [
      '||gallerynova.se/site/v/',
      '||gallerysense.se/site/v/',
    ],
    q: 'a[href*="/upload/"]',
  }, {
    u: '||gifbin.com/',
    r: /[./]gifbin\.com\/.+\.gif$/,
    xhr: true,
  }, {
    u: '||gfycat.com/',
    r: /(gfycat\.com\/)(gifs\/detail\/|iframe\/)?([a-z]+)/i,
    s: 'https://$1$3',
    q: [
      'meta[content$=".webm"]',
      '#webmsource',
      'source[src$=".webm"]',
    ],
  }, {
    u: [
      '||googleusercontent.com/proxy',
      '||googleusercontent.com/gadgets/proxy',
    ],
    r: /\.com\/(proxy|gadgets\/proxy.+?(http.+?)&)/,
    s: m => m[2] ? decodeURIComponent(m[2]) : m.input.replace(/w\d+-h\d+($|-p)/, 'w0-h0'),
  }, {
    u: [
      '||googleusercontent.com/',
      '||ggpht.com/',
    ],
    s: (m, node) =>
      contains(m.input, 'webcache.') ||
      node.outerHTML.match(/favicons\?|\b(Ol Rf Ep|Ol Zb ag|Zb HPb|Zb Gtb|Rf Pg|ho PQc|Uk wi hE|go wi Wh|we D0b|Bea)\b/) ||
      matches(node, '.g-hovercard *, a[href*="profile_redirector"] > img') ?
        '' :
        m.input.replace(/\/s\d{2,}-[^/]+|\/w\d+-h\d+/, '/s0').replace(/=[^/]+$/, ''),
  }, {
    u: '||heberger-image.fr/images',
    q: '#myimg',
  }, {
    u: '||hostingkartinok.com/show-image.php',
    q: '.image img',
  }, {
    u: '||imagearn.com/image',
    q: '#img',
    xhr: true,
  }, {
    u: [
      '||imagefap.com/image',
      '||imagefap.com/photo',
    ],
    q: (text, doc) => qs('*[itemprop="contentUrl"]', doc).textContent,
  }, {
    u: '||imagebam.com/image/',
    q: 'meta[property="og:image"]',
    tabfix: true,
    xhr: contains(hostname, 'planetsuzy'),
  }, {
    u: [
      '||cweb-pix.com/',
      '||imageban.ru/show',
      '||imageban.net/show',
      '||imgnova.com/',
      '||imagebunk.com/image',
    ],
    q: '#img_obj',
    xhr: true,
  }, {
    u: [
      '||freeimgup.com/xxx/?v=',
      '||imagepdb.com/?v=',
      '||imgsure.com/?v=',
      '||imgwiki.org/?v=',
      '||www.pixoverflow.com/?v=',
    ],
    r: /\/\?v=([0-9]+$|.+(?=\.[a-z]+))/,
    s: 'http://$1/images/$2.jpg',
    xhr: true,
  }, {
    u: '||imageshack.us/img',
    r: /img(\d+)\.(imageshack\.us)\/img\\1\/\d+\/(.+?)\.th(.+)$/,
    s: 'https://$2/download/$1/$3$4',
  }, {
    u: '||imageshack.us/i/',
    q: '#share-dl',
  }, {
    u: '||imageshost.ru/photo/',
    q: '#bphoto',
  }, {
    u: '||imageteam.org/img',
    q: 'img[alt="image"]',
  }, {
    u: [
      '||imagetwist.com/',
      '||imageshimage.com/',
      '||imgflare.com/',
      '||imgearn.net/',
    ],
    r: /(\/\/|^)[^/]+\/[a-z0-9]{8,}/,
    q: 'img.pic',
    xhr: true,
  }, {
    u: '||imageupper.com/i/',
    q: '#img',
    xhr: true,
  }, {
    u: '||imagepix.org/image/',
    r: /\/image\/(.+)\.html$/,
    s: 'http://imagepix.org/full/$1.jpg',
    xhr: true,
  }, {
    u: '||imageporter.com/i/',
    s: '/_t//',
    xhr: true,
  }, {
    u: '||imagevenue.com/img.php',
    q: '#thepic',
  }, {
    u: '||imagezilla.net/show/',
    q: '#photo',
    xhr: true,
  }, {
    u: [
      '||images-na.ssl-images-amazon.com/images/',
      '||media-imdb.com/images/',
    ],
    r: /[./](images-na\.ssl-images-amazon.com|media-imdb\.com)\/images\/.+?\.jpg/,
    s: '/V1\\.?_.+?\\.//g',
    distinct: true,
  }, {
    u: '||imgbox.com/',
    r: /[./]imgbox\.com\/([a-z0-9]+)$/i,
    q: '#img',
    xhr: hostname !== 'imgbox.com',
  }, {
    u: [
      '||imgchili.net/show',
      '||imgchili.com/show',
    ],
    q: '#show_image',
    xhr: true,
  }, {
    u: [
      '||hosturimage.com/img-',
      '||imageboom.net/img-',
      '||imageon.org/img-',
      '||imageontime.org/img-',
      '||img.yt/img-',
      '||img4ever.net/img-',
      '||imgcandy.net/img-',
      '||imgcredit.xyz/img-',
      '||imgdevil.com/img-',
      '||imggoo.com/img-',
      '||imgrun.net/img-',
      '||imgtrial.com/img-',
      '||imgult.com/img-',
      '||imgwel.com/img-',
      '||picspornfree.me/img-',
      '||pixliv.com/img-',
      '||pixxx.me/img-',
      '||uplimg.com/img-',
      '||xxxscreens.com/img-',
      '||xxxupload.org/img-',
      '||imgbb.net/v-',
    ],
    s: m =>
      m.input
        .replace(/\/(v-[0-9a-f]+)_.+/, '$1')
        .replace('http://img.yt', 'https://img.yt'),
    q: [
      'img.centred_resized, #image',
      'img[src*="/upload/big/"]',
    ],
    xhr: true,
    post: 'imgContinue=Continue%20to%20image%20...%20',
  }, {
    u: [
      '||foxyimg.link/',
      '||imageeer.com/',
      '||imgclick.net/',
      '||imgdiamond.com/',
      '||imgdragon.com/',
      '||imgmaid.net/',
      '||imgmega.com/',
      '||imgpaying.com/',
      '||imgsee.me/',
      '||imgtiger.org/',
      '||imgtrex.com/',
      '||pic-maniac.com/',
      '||picexposed.com/',
    ],
    r: /(?:\/\/|^)[^/]+\/(\w+)/,
    q: 'img.pic',
    xhr: true,
    post: m => `op=view&id=${m[1]}&pre=1&submit=Continue%20to%20image...`,
  }, {
    u: [
      '||imgflip.com/i/',
      '||imgflip.com/gif/',
    ],
    r: /\/(i|gif)\/([^/?#]+)/,
    s: m => `https://i.imgflip.com/${m[2]}${m[1] === 'i' ? '.jpg' : '.mp4'}`,
  }, {
    u: '||imgsen.se/upload/',
    s: '/small/big/',
    xhr: false,
  }, {
    u: '||imgtheif.com/image/',
    q: 'a > img[src*="/pictures/"]',
  }, {
    u: [
      '||imgur.com/a/',
      '||imgur.com/gallery/',
      '||imgur.com/t/',
    ],
    r: /\/(a|gallery|t\/[a-z0-9_-]+)\/([a-z0-9]+)(#[a-z0-9]+)?/i,
    s: m => `https://imgur.com/${m[1]}/${m[2]}${m[3] || ''}`,
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
        if (o.is_album && !contains(items[0].desc, o.title))
          items.title = o.title;
        return items;
      };
      const m = /(mergeConfig\('gallery',\s*|Imgur\.Album\.getInstance\()({[\s\S]+?})\);/.exec(text);
      const o1 = eval('(' + m[2].replace(/analytics\s*:\s*analytics/, 'analytics:null')
        .replace(/decodeURIComponent\(.+?\)/, 'null') + ')');
      const o = o1.image || o1.album;
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
  }, {
    u: '||imgur.com/',
    r: /\.com\/.+,/,
    g: (text, url) =>
      /.+\/([a-z0-9,]+)/i
        .exec(url)[1]
        .split(',')
        .map(id => ({
          url: `https://i.${/([a-z]{2,}\.)?imgur\.com/.exec(url)[0]}/${id}.jpg`,
        })),
  }, {
    u: '||imgur.com/',
    r: /([a-z]{2,}\.)?imgur\.com\/(r\/[a-z]+\/|[a-z0-9]+#)?([a-z0-9]{5,})($|\?|\.([a-z]+))/i,
    s: (m, node) => {
      if (/memegen|random|register|search|signin/.test(m.input))
        return '';
      if (/(i\.([a-z]+\.)?)?imgur\.com\/(a\/|gallery\/)?/
          .test(node.parentNode.href || node.parentNode.parentNode.href))
        return false;
      const url = 'https://i.' + (m[1] || '').replace('www.', '') + 'imgur.com/' +
                m[3].replace(/(.{7})[bhm]$/, '$1') + '.' +
                (m[5] ? m[5].replace(/gifv?/, 'webm') : 'jpg');
      return contains(url, '.webm') ?
        [url, url.replace('.webm', '.mp4'), url.replace('.webm', '.gif')] :
        url;
    },
  }, (() => {
    const LINK_SEL = 'a[href*="/p/"]';
    const getInstagramData = node => {
      const n = closest(node, `${LINK_SEL}, article`);
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
      } catch (e) {}
      return {a};
    };
    const RULE = {
      d: 'instagram.com^',
      e: [
        LINK_SEL,
        'a[role="button"][data-reactid*="scontent-"]',
        'article div',
        'article div div img',
      ],
      s: (m, node) => {
        const {a, data} = getInstagramData(node) || {};
        RULE.follow = !data;
        return (
          !a ? false :
            !data ? a.href :
              data.video_url || data.display_url.replace(/\/[sp]\d+x\d+\//, '/'));
      },
      c: (html, doc, node) => {
        try {
          return getInstagramData(node).data.edge_media_to_caption.edges[0].node.text;
        } catch (e) {
          return '';
        }
      },
      follow: true,
    };
    return RULE;
  })(),
  {
    u: [
      '||instagr.am/p/',
      '||instagram.com/p/',
    ],
    s: m => m.input.substr(0, m.input.lastIndexOf('/')) + '/?__a=1',
    q: text => {
      const m = JSON.parse(text).graphql.shortcode_media;
      return m.video_url || m.display_url.replace(/\/[sp]\d+x\d+\//, '/');
    },
    rect: 'div.PhotoGridMediaItem',
    c: text => {
      const m = JSON.parse(text).graphql.shortcode_media.edge_media_to_caption.edges[0];
      return m === undefined ? '(no caption)' : m.node.text;
    },
  }, {
    u: [
      '||istoreimg.com/i/',
      '||itmages.ru/image/view/',
    ],
    q: '#image',
  }, {
    d: '||kat.cr^',
    u: 'confirm/url/',
    r: /confirm\/url\/([^/]+)/,
    s: m => atob(decodeURIComponent(m[1])),
    follow: true,
  }, {
    u: '||lazygirls.info/',
    r: /(lazygirls\.info\/.+_.+?\/[a-z0-9_]+)($|\?)/i,
    s: 'http://www.$1?display=fullsize',
    q: 'img.photo',
    xhr: hostname !== 'www.lazygirls.info',
  }, {
    u: '||ld-host.de/show',
    q: '#image',
  }, {
    u: [
      '||listal.com/',
      '||lisimg.com/',
    ],
    r: /\/(view)?image\/([0-9]+)/,
    s: 'http://iv1.lisimg.com/image/$2/0full.jpg',
  }, {
    u: [
      '||livememe.com/',
      '||lvme.me/',
    ],
    r: /(livememe\.com|lvme\.me)\/([^.]+)$/,
    s: 'http://i.lvme.me/$2.jpg',
  }, {
    u: [
      '||lostpic.net/?photo',
      '||lostpic.net/?view',
    ],
    q: [
      '#cool > img',
      '.casem img',
    ],
  }, {
    u: '||makeameme.org/meme/',
    r: /\/meme\/([^/?#]+)/,
    s: 'https://media.makeameme.org/created/$1.jpg',
  }, {
    u: '||modelmayhem.com/photos/',
    s: '/_m//',
  }, {
    u: '||modelmayhem.com/avatars/',
    s: '/_t/_m/',
  }, {
    u: [
      '||min.us/',
      '||minus.com/',
    ],
    r: /\/(i\/|l)([a-z0-9]+)$/i,
    s: 'https://i.minus.com/i$2.jpg',
  }, {
    u: [
      '||min.us/m',
      '||minus.com/m',
    ],
    r: /\/m[a-z0-9]+$/i,
    g: text => {
      const m = /gallerydata = ({[\w\W]+?});/.exec(text);
      const o = JSON.parse(m[1]);
      const items = [];
      items.title = o.name;
      for (const cur of o.items) {
        items.push({
          url: `https://i.minus.com/i${cur.id}.jpg`,
          desc: cur.caption,
        });
      }
      return items;
    },
  }, {
    u: [
      '||panoramio.com/',
      '||google.com/mw-panoramio/photos/',
    ],
    r: /[./](photo(\/|_id=)|\/photos\/[a-z]+\/)(\d+)/,
    s: 'http://static.panoramio.com/photos/original/$3.jpg',
  }, {
    u: '||photobucket.com/',
    r: /(\d+\.photobucket\.com\/.+\/)(\?[a-z=&]+=)?(.+\.(jpe?g|png|gif))/,
    s: 'http://i$1$3',
    xhr: !contains(hostname, 'photobucket.com'),
  }, {
    u: [
      '||photosex.biz',
      '||posteram.ru/',
    ],
    r: /id=/i,
    q: 'img[src*="/pic_b/"]',
    xhr: true,
  }, {
    u: '||pic4all.eu/view.php?filename=',
    r: /filename=(.+)/,
    s: 'http://pic4all.eu/images/$1',
  }, {
    u: '||piccy.info/view3/',
    r: /(.+?\/view3)\/(.*)\//,
    s: '$1/$2/orig/',
    q: '#mainim',
  }, {
    u: '||picsee.net/',
    r: /[./]picsee\.net\/([\d-]+)\/(.+?)\.html/,
    s: 'http://picsee.net/upload/$1/$2',
  }, {
    u: '||picturescream.com/?v=',
    q: '#imagen img',
  }, {
    u: [
      '||picturescream.',
      '||imagescream.com/img/',
    ],
    r: /\/(soft|x)/,
    q: 'a > img[src*="/images/"]',
  }, {
    u: '||pimpandhost.com/image/',
    r: /(.+?\/image\/[0-9]+)/,
    s: '$1?size=original',
    q: 'img.original',
  }, {
    u: '||pixhost.org/show/',
    q: '#image',
    xhr: true,
  }, {
    u: '||pixhub.eu/images',
    q: '.image-show img',
    xhr: true,
  }, {
    u: [
      '||pixroute.com/',
      '||imgspice.com/',
    ],
    r: /\.html$/,
    q: 'img[id]',
    xhr: true,
  }, {
    u: [
      '||pixsor.com/share-',
      '||euro-pic.eu/share-',
    ],
    r: /(pixsor\.com|euro-pic\.eu)\/share-([a-z0-9_]+)/i,
    s: 'http://www.$1/image.php?id=$2',
    xhr: true,
  }, {
    u: '||postima',
    r: /postima?ge?\.org\/image\/\w+/,
    q: [
      'a[href*="dl="]',
      '#main-image',
    ],
  }, {
    u: '||radikal.ru/',
    r: /\.ru\/(fp|.+\.html)/,
    q: text => text.match(/http:\/\/[a-z0-9]+\.radikal\.ru[a-z0-9/]+\.(jpg|gif|png)/i)[0],
  }, {
    d: '||reddit.com^',
    u: '||i.reddituploads.com/',
  }, {
    u: '||screenlist.ru/details',
    q: '#picture',
  }, {
    u: '||sharenxs.com/',
    r: /original$/,
    q: 'img.view_photo',
    xhr: true,
  }, {
    u: [
      '||sharenxs.com/gallery/',
      '||sharenxs.com/view/',
    ],
    q: 'a[href$="original"]',
    follow: true,
  }, {
    u: '||stooorage.com/show/',
    q: '#page_body div div img',
    xhr: true,
  }, {
    u: [
      '||awsmpic.com/img-',
      '||damimage.com/img-',
      '||dragimage.org/img-',
      '||gogoimage.org/img-',
      '||image.re/img-',
      '||imagedecode.com/img-',
      '||imgflash.net/img-',
      '||imgget.net/img-',
      '||imghit.com/img-',
      '||imgproof.net/img-',
      '||imgs.it/img-',
      '||imgserve.net/img-',
      '||imgspot.org/img-',
      '||imgstudio.org/img-',
      '||madimage.org/img-',
      '||ocaload.com/img-',
      '||swoopic.com/img-',
    ],
    q: 'img.centred_resized, img.centred',
    xhr: true,
  }, {
    u: '||turboimagehost.com/p/',
    q: '#imageid',
    xhr: true,
  }, {
    u: '||twimg.com/',
    r: /\/profile_images/i,
    s: '/_(reasonably_small|normal|bigger|\\d+x\\d+)\\././g',
  }, {
    u: '||twimg.com/media/',
    r: /([a-z0-9-]+\.twimg\.com\/media\/[a-z0-9_-]+\.(jpe?g|png|gif))/i,
    s: 'https://$1:orig',
    rect: 'div.tweet a.twitter-timeline-link, div.TwitterPhoto-media',
  }, {
    d: '||tumblr.com^',
    e: 'div.photo_stage_img, div.photo_stage > canvas',
    s: (m, node) => /http[^"]+/.exec(node.style.cssText + node.getAttribute('data-img-src'))[0],
    follow: true,
  }, {
    u: '||tumblr.com',
    r: /_500\.jpg/,
    s: ['/_500/_1280/', ''],
  }, {
    u: '||twimg.com/1/proxy',
    r: /t=([^&_]+)/i,
    s: m => atob(m[1]).match(/http.+/),
  }, {
    u: '||pic.twitter.com/',
    r: /\.com\/[a-z0-9]+/i,
    q: text => text.match(/https?:\/\/twitter\.com\/[^/]+\/status\/\d+\/photo\/\d+/i)[0],
    follow: true,
  }, {
    d: '||tweetdeck.twitter.com^',
    e: 'a.media-item, a.js-media-image-link',
    s: (m, node) => /http[^)]+/.exec(node.style.backgroundImage)[0],
    follow: true,
  }, {
    u: '||twitpic.com/',
    r: /\.com(\/show\/[a-z]+)?\/([a-z0-9]+)($|#)/i,
    s: 'https://twitpic.com/show/large/$2',
  }, {
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
  }, {
    d: '||twitter.com^',
    e: '.grid-tweet > .media-overlay',
    s: (m, node) => node.previousElementSibling.src,
    follow: true,
  }, {
    u: '||upix.me/files',
    s: '/#//',
  }, {
    u: [
      '||vine.co/v/',
      '||vine.com/v/',
      '||seenive.co/v/',
      '||seenive.com/v/',
    ],
    q: 'video source, meta[property="twitter:player:stream"]',
  }, {
    u: [
      '||web.stagram.com/p/',
      '||web.stagr.am/p/',
      '||web.sta.me/p/',
    ],
    q: (text, doc) => {
      const node = findNode(['div.jp-jplayer', 'meta[property="og:image"]'], doc);
      return findFile(node, _.url).replace(/\/[sp]\d+x\d+\//, '/');
    },
    rect: 'div.PhotoGridMediaItem',
    c: (text, doc) => {
      const s = qs('meta[name="description"]', doc).getAttribute('content');
      return s.substr(0, s.lastIndexOf(' | '));
    },
  }, {
    u: '||wiki',
    r: /\/(thumb|images)\/.+\.(jpe?g|gif|png|svg)\/(revision\/)?/i,
    s: '/\\/thumb(?=\\/)|\\/scale-to-width(-[a-z]+)?\\/[0-9]+|\\/revision\\/latest|\\/[^\\/]+$//g',
    xhr: !contains(hostname, 'wiki'),
  }, {
    u: [
      '||xxxhost.me/viewer',
      '||tinypix.me/viewer',
      '||xxxces.com/viewer',
      '||imgsin.com/viewer',
    ],
    q: [
      '.text_align_center > img',
      'img[alt]',
    ],
    xhr: true,
  }, {
    u: '||ytimg.com/vi/',
    r: /(i[0-9]*\.ytimg\.com\/vi\/[^/]+)/,
    s: 'https://$1/0.jpg',
    rect: '.video-list-item',
  }, {
    u: '/viewer.php?file=',
    r: /(\/\/|^)([^/]+)\/viewer\.php\?file=(.+)/,
    s: 'http://$1/images/$2',
    xhr: true,
  }, {
    u: '/thumb_',
    r: /\/albums.+\/thumb_[^/]/,
    s: '/thumb_//',
  }, {
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
    r: /(\/\/|^)[^/]+[^?:]+\.(jpe?g?|gif|png|svg|webm)($|\?)/i,
    distinct: true,
  }];
  const hostnamePinned = '.' + hostname;
  const inDomain = ({d}) => {
    if (!d)
      return true;
    const pinDomain = d.startsWith('||');
    const pinStart = !pinDomain && d.startsWith('|');
    const pinEnd = d.endsWith('^');
    d = d.slice(pinDomain * 2, -pinEnd || undefined);
    return (
      pinStart ? hostname.startsWith(d) && (!pinEnd || hostname.length === d.length) :
        pinDomain && pinEnd ? hostnamePinned.endsWith('.' + d) :
          pinDomain ? hostnamePinned.includes('.' + d) :
            pinEnd ? hostname.endsWith(d) :
              hostname.includes(d)
    );
  };
  return hosts.filter(inDomain);
}

function onMouseOver(e) {
  if (!enabled || e.shiftKey || _.zoom)
    return;
  let node = e.target;
  if (node === _.popup || node === d.body || node === d.documentElement)
    return;
  const shadowRoots = [];
  for (let root; (root = node.shadowRoot);) {
    shadowRoots.push(root);
    const inner = root.elementFromPoint(e.clientX, e.clientY);
    if (!inner || inner === node)
      break;
    node = inner;
  }
  for (const root of shadowRoots) {
    on(root, 'mouseover', onMouseOver, {passive: true});
    on(root, 'mouseout', onMouseOutShadow);
  }
  if (!activate(node, e.ctrlKey))
    return;
  updateMouse(e);
  if (e.ctrlKey) {
    startPopup();
  } else if (cfg.start === 'auto' && !_.manual) {
    if (cfg.preload) {
      _.preloadStart = Date.now();
      startPopup();
      setStatus('preloading', 'add');
    } else {
      _.timeout = setTimeout(startPopup, cfg.delay);
    }
    if (cfg.preload)
      setTimeout(setStatus, cfg.delay, 'preloading', 'remove');
  } else {
    setStatus('ready');
  }
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
    return (_.lazyUnload = true);
  if (!_.zoomed && !_.cr)
    return deactivate();
  if (_.zoom) {
    placePopup();
    const bx = _.view.width / 6;
    const by = _.view.height / 6;
    setStatus('edge',
      _.cx < bx || _.cx > _.view.width - bx || _.cy < by || _.cy > _.view.height - by ?
        'add' :
        'remove');
  }
}

function onMouseDown(e) {
  if (e.which !== 3 && !e.shiftKey) {
    deactivate(true);
  } else if (e.shiftKey && e.which === 1 && _.popup && _.popup.controls) {
    _.controlled = _.zoomed = true;
  }
}

function onMouseScroll(e) {
  const dir = (e.deltaY || -e.wheelDelta) > 0 ? 1 : -1;
  if (_.zoom) {
    drop(e);
    const idx = _.scales.indexOf(_.scale) - dir;
    if (idx >= 0 && idx < _.scales.length)
      _.scale = _.scales[idx];
    if (idx === 0 && cfg.close) {
      if (!_.gItems || _.gItems.length < 2)
        return deactivate(true);
      _.zoom = false;
      showFileInfo();
    }
    if (_.zooming)
      _.popup.classList.add('mpiv-zooming');
    placePopup();
    updateTitle();
  } else if (_.gItems && _.gItems.length > 1 && _.popup) {
    drop(e);
    nextGalleryItem(dir);
  } else if (cfg.zoom === 'wheel' && dir < 0 && _.popup) {
    drop(e);
    toggleZoom();
  } else {
    deactivate();
  }
}

function onKeyDown(e) {
  if (e.which === 16) {
    setStatus('shift', 'add');
    if (_.popup && 'controls' in _.popup)
      _.popup.controls = true;
  } else if (e.which === 17 && (cfg.start !== 'auto' || _.manual) && !_.popup) {
    startPopup();
  }
}

function onKeyUp(e) {
  switch (e.which) {
    case 16:
      setStatus('shift', 'remove');
      if (_.popup.controls)
        _.popup.controls = false;
      if (_.controlled)
        return (_.controlled = false);
      _.popup && (_.zoomed || !('cr' in _) || _.cr) ? toggleZoom() : deactivate(true);
      break;
    case 17:
      break;
    case 27:
      deactivate(true);
      break;
    case 39:
    case 74:
      drop(e);
      nextGalleryItem(1);
      break;
    case 37:
    case 75:
      drop(e);
      nextGalleryItem(-1);
      break;
    case 68: {
      drop(e);
      let name = (_.iurl || _.popup.src).split('/').pop().replace(/[:#?].*/, '');
      if (!contains(name, '.'))
        name += '.jpg';
      saveFile(_.popup.src, name, () => {
        setBar(`Could not download ${name}.`, 'error');
      });
      break;
    }
    case 84:
      _.lazyUnload = true;
      if (_.tabfix && !_.xhr && tag(_.popup) === 'IMG' && contains(navigator.userAgent, 'Gecko/')) {
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
            <img onclick="document.body.classList.toggle('fit')" src="${_.popup.src}">
          </body>
        `.replace(/[\r\n]+\s*/g, '')));
      } else {
        GM_openInTab(_.popup.src);
      }
      deactivate();
      break;
    default:
      deactivate(true);
  }

}

function saveFile(url, name, onError) {
  const save = url => {
    const a = ce('a');
    a.href = url;
    a.download = name;
    a.dispatchEvent(new MouseEvent('click'));
  };
  if (contains(['blob:', 'data:'], url.substr(0, 5)))
    return save(url);
  GM_xmlhttpRequest({
    method: 'GET',
    url: url,
    responseType: 'blob',
    onload: res => {
      try {
        const ou = URL.createObjectURL(res.response);
        save(ou);
        setTimeout(() => {
          URL.revokeObjectURL(ou);
        }, 1000);
      } catch (ex) {
        onError(ex);
      }
    },
    onError: onError,
  });
}

function onContext(e) {
  if (e.shiftKey)
    return;
  if (cfg.zoom === 'context' && _.popup && toggleZoom())
    return drop(e);
  if ((cfg.start === 'context' || (cfg.start === 'auto' && _.manual)) && !_.status && !_.popup) {
    startPopup();
    return drop(e);
  }
  setTimeout(deactivate, 50, true);
}

function onMessage(e) {
  if (!contains(trusted, e.origin.substr(e.origin.indexOf('//') + 2)) || typeof e.data !==
      'string' || e.data.indexOf('mpiv-rule ') !== 0) {
    return;
  }
  if (!qs('#mpiv-setup', d))
    setup();
  const inp = qs('#mpiv-hosts input:first-of-type', d);
  inp.value = e.data.substr(10).trim();
  inp.dispatchEvent(new Event('input', {bubbles: true}));
  inp.parentNode.scrollTop = 0;
  inp.select();
}

function startPopup() {
  updateStyles();
  setStatus(false);
  _.g ? startGalleryPopup() : startSinglePopup(_.url);
}

function startSinglePopup(url) {
  setStatus('loading');
  delete _.iurl;
  if (_.follow && !_.q && !_.s) {
    return findRedirect(_.url, url => {
      const info = findInfo(url, _.node, true);
      if (!info || !info.url)
        throw 'Couldn\'t follow redirection target: ' + url;
      restartSinglePopup(info);
    });
  }
  if (!_.q || Array.isArray(_.urls)) {
    if (typeof _.c === 'function') {
      _.caption = _.c(d.documentElement.outerHTML, d, _.node);
    } else if (typeof _.c === 'string') {
      const cnode = findNode(_.c, d);
      _.caption = cnode ? findCaption(cnode) : '';
    }
    _.iurl = url;
    return _.xhr ? downloadImage(url, _.url) : setPopup(url);
  }
  parsePage(url, (iurl, cap, url) => {
    if (!iurl)
      throw 'File not found.';
    if (typeof cap !== 'undefined')
      _.caption = cap;
    if (_.follow === true || typeof _.follow === 'function' && _.follow(iurl)) {
      const info = findInfo(iurl, _.node, true);
      if (!info || !info.url)
        throw 'Couldn\'t follow URL: ' + iurl;
      return restartSinglePopup(info);
    }
    _.iurl = iurl;
    if (_.xhr) {
      downloadImage(iurl, url);
    } else {
      setPopup(iurl);
    }
  });
}

function restartSinglePopup(info) {
  for (const prop in info) {
    _[prop] = info[prop];
  }
  startSinglePopup(_.url);
}

function startGalleryPopup() {
  setStatus('loading');
  const startUrl = _.url;
  downloadPage(_.url, (text, url) => {
    try {
      const cb = items => {
        if (!_.url || _.url !== startUrl)
          return;
        _.gItems = items;
        if (_.gItems.length === 0) {
          _.gItems = false;
          throw 'empty';
        }
        _.gIndex = findGalleryPosition(_.url);
        setTimeout(nextGalleryItem, 0);
      };
      const items = _.g(text, url, cb);
      if (typeof items !== 'undefined')
        cb(items);
    } catch (ex) {
      handleError('Parsing error: ' + ex);
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
      for (let i = _.gItems.length; i--;) {
        let url = _.gItems[i].url;
        if (Array.isArray(url))
          url = url[0];
        const file = url.substr(url.lastIndexOf('/') + 1);
        if (contains(file, sel)) {
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
    return new Function('text', 'url', 'cb', g);
  return (text, url) => {
    const qE = g.entry;
    let qC = g.caption;
    const qI = g.image;
    const qT = g.title;
    const fix =
      (typeof g.fix === 'string' ?
        new Function('s', 'isURL', g.fix) :
        g.fix
      ) ||
      (s => s.trim());
    const doc = createDoc(text);
    const items = [];
    const nodes = qsa(qE || qI, doc);
    if (!Array.isArray(qC))
      qC = [qC];
    for (const node of nodes) {
      const item = {};
      try {
        item.url = fix(findFile(qE ? qs(qI, node) : node, url), true);
        item.desc = qC.reduce((prev, q) => {
          let n = qs(q, node);
          if (!n) {
            for (const es of [node.previousElementSibling, node.nextElementSibling]) {
              if (es && matches(es, qE) === false)
                n = matches(es, q) ? es : qs(q, es);
            }
          }
          return n ? (prev ? prev + ' - ' : '') + fix(n.textContent) : prev;
        }, '');
      } catch (ex) {
      }
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
  if (dir > 0 && (_.gIndex += dir) >= _.gItems.length) {
    _.gIndex = 0;
  } else if (dir < 0 && (_.gIndex += dir) < 0) {
    _.gIndex = _.gItems.length - 1;
  }
  const item = _.gItems[_.gIndex];
  if (Array.isArray(item.url)) {
    _.urls = item.url.slice(0);
    _.url = _.urls.shift();
  } else {
    delete _.urls;
    _.url = item.url;
  }
  setPopup(false);
  startSinglePopup(_.url);
  showFileInfo();
  preloadNextGalleryItem(dir);
}

function preloadNextGalleryItem(dir) {
  const idx = _.gIndex + dir;
  if (_.popup && idx >= 0 && idx < _.gItems.length) {
    let url = _.gItems[idx].url;
    if (Array.isArray(url))
      url = url[0];
    on(_.popup, 'load', () => {
      ce('img').src = url;
    });
  }
}

function activate(node, force) {
  const info = parseNode(node);
  if (!info || !info.url || info.node === _.node)
    return;
  if (info.distinct && !force) {
    const scale = findScale(info.url, info.node.parentNode);
    if (scale && scale < cfg.scale)
      return;
  }
  if (_.node)
    deactivate();
  _ = info;
  _.view = viewRect();
  _.zooming = contains(cfg.css, 'mpiv-zooming');
  for (const n of [_.node.parentNode, _.node, _.node.firstElementChild]) {
    if (n && n.title && n.title !== n.textContent && !contains(d.title, n.title) &&
        !/^http\S+$/.test(n.title)) {
      _.tooltip = {
        node: n,
        text: n.title,
      };
      n.title = '';
      break;
    }
  }
  on(d, 'mousemove', onMouseMove, {passive: true});
  on(d, 'mouseout', onMouseOut, {passive: true});
  on(d, 'mousedown', onMouseDown, {passive: true});
  on(d, 'contextmenu', onContext);
  on(d, 'keydown', onKeyDown);
  on(d, 'keyup', onKeyUp);
  on(d, 'onwheel' in d ? 'wheel' : 'mousewheel', onMouseScroll, {passive: false});
  return true;
}

function deactivate(wait) {
  clearTimeout(_.timeout);
  try {
    _.req.abort();
  } catch (ex) {}
  if (_.tooltip)
    _.tooltip.node.title = _.tooltip.text;
  updateTitle(true);
  setStatus(false);
  setPopup(false);
  setBar(false);
  _ = {};
  off(d, 'mousemove', onMouseMove);
  off(d, 'mouseout', onMouseOut);
  off(d, 'mousedown', onMouseDown);
  off(d, 'contextmenu', onContext);
  off(d, 'keydown', onKeyDown);
  off(d, 'keyup', onKeyUp);
  off(d, 'onwheel' in d ? 'wheel' : 'mousewheel', onMouseScroll);
  if (wait) {
    enabled = false;
    setTimeout(() => {
      enabled = true;
    }, 200);
  }
}

function parseNode(node) {
  let a, img, url, info;
  if (!hosts) {
    hosts = loadHosts();
    GM_registerMenuCommand('Configure', setup);
  }
  if (tag(node) === 'A') {
    a = node;
  } else {
    if (tag(node) === 'IMG') {
      img = node;
      if (img.src.substr(0, 5) !== 'data:')
        url = rel2abs(img.src, location.href);
    }
    info = findInfo(url, node);
    if (info)
      return info;
    a =
      tag(node.parentNode) === 'A' ?
        node.parentNode :
        (tag(node.parentNode.parentNode) === 'A' ? node.parentNode.parentNode : false);
  }
  if (a) {
    url =
      a.getAttribute('data-expanded-url') || a.getAttribute('data-full-url') ||
      a.getAttribute('data-url') || a.href;
    if (url.length > 750 || url.substr(0, 5) === 'data:') {
      url = false;
    } else if (contains(url, '//t.co/')) {
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

function findInfo(url, node, noHtml, skipHost) {
  const tn = tag(node);
  for (const h of hosts) {
    if (h.e && !matches(node, h.e) || h === skipHost)
      continue;
    let m, html, urls;
    if (h.r || h.u) {
      if (h.html && !noHtml && (tn === 'A' || tn === 'IMG' || h.e)) {
        if (!html)
          html = node.outerHTML;
        m = h.r.exec(html);
      } else if (url) {
        if (h.u && !h._u)
          h._u = compileSimpleUrlMatch(h.u);
        m = h._u && h._u.fn(url, h._u.needle) &&
            Object.assign([url], {index: 0, input: url});
        if (h.r && (m || !h._u))
          m = h.r.exec(url);
      } else {
        m = null;
      }
    } else {
      m = url ? /.*/.exec(url) : [];
    }
    if (!m || tn === 'IMG' && !('s' in h))
      continue;
    if ('s' in h) {
      urls = (Array.isArray(h.s) ? h.s : [h.s])
        .map(s =>
          typeof s === 'string' ? decodeURIComponent(replace(s, m)) :
            typeof s === 'function' ? s(m, node) :
              s);
      if (h.q && urls.length > 1) {
        console.log('Rule discarded. Substitution arrays can\'t be combined with property q.');
        continue;
      }
      if (Array.isArray(urls[0]))
        urls = urls[0];
      if (urls[0] === false)
        continue;
      urls = urls.map(u => u ? decodeURIComponent(u) : u);
    } else {
      urls = [m.input];
    }
    if ((h.follow === true || typeof h.follow === 'function' && h.follow(urls[0])) && !h.q && h.s)
      return findInfo(urls[0], node, false, h);
    const info = {
      node: node,
      url: urls.shift(),
      urls: urls.length ? urls : false,
      r: h.r,
      q: h.q,
      c: h.c,
      g: h.g ? loadGalleryParser(h.g) : h.g,
      xhr: cfg.xhr && h.xhr,
      tabfix: h.tabfix,
      post: typeof h.post === 'function' ? h.post(m) : h.post,
      follow: h.follow,
      css: h.css,
      manual: h.manual,
      distinct: h.distinct,
    };
    lazyGetRect(info, node, h.rect);
    if (contains(hostname, 'twitter.com') &&
        !/(facebook|google|twimg|twitter)\.com\//.test(info.url) || hostname === 'github.com' &&
        !/github/.test(info.url) || contains(hostname, 'facebook.com') &&
        /\bimgur\.com/.test(info.url)) {
      info.xhr = 'data';
    }
    return info;
  }
}

function downloadPage(url, cb) {
  let req;
  const opts = {
    method: 'GET',
    url: url,
    onload: res => {
      try {
        if (req !== _.req)
          return;
        delete _.req;
        if (res.status > 399)
          throw 'Server error: ' + res.status;
        cb(res.responseText, res.finalUrl || url);
      } catch (ex) {
        handleError(ex);
      }
    },
    onerror: res => {
      if (req === _.req)
        handleError(res);
    },
  };
  if (_.post) {
    opts.method = 'POST';
    opts.data = _.post;
    opts.headers =
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': url,
    };
  }
  _.req = req = GM_xmlhttpRequest(opts);
}

function downloadImage(url, referer) {
  const start = Date.now();
  let bar;
  let req;
  _.req = req = GM_xmlhttpRequest({
    method: 'GET',
    url: url,
    responseType: 'blob',
    headers: {
      'Accept': 'image/png,image/*;q=0.8,*/*;q=0.5',
      'Referer': referer,
    },
    onprogress: e => {
      if (req !== _.req)
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
        if (req !== _.req)
          return;
        delete _.req;
        setBar(false);
        if (res.status > 399)
          throw 'HTTP error ' + res.status;
        let type;
        if (/Content-Type:\s*(.+)/i.exec(res.responseHeaders) &&
            !contains(RegExp.$1, 'text/plain')) {
          type = RegExp.$1;
        }
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
          type = ext in types ? types[ext] : 'application/octet-stream';
        }
        let b = res.response;
        if (b.type !== type)
          b = b.slice(0, b.size, type);
        if (URL && _.xhr !== 'data')
          return setPopup(URL.createObjectURL(b));
        const fr = new FileReader();
        fr.onload = () => {
          setPopup(fr.result);
        };
        fr.onerror = handleError;
        fr.readAsDataURL(b);
      } catch (ex) {
        handleError(ex);
      }
    },
    onerror: res => {
      if (req === _.req)
        handleError(res);
    },
  });
}

function findRedirect(url, cb) {
  let req;
  _.req = req = GM_xmlhttpRequest({
    url: url,
    method: 'HEAD',
    headers: {Referer: location.href.replace(location.hash, '')},
    onload: res => {
      if (req === _.req)
        cb(res.finalUrl);
    },
  });
}

function parsePage(url, cb) {
  downloadPage(url, (html, url) => {
    let iurl;
    let cap;
    const doc = createDoc(html);
    if (typeof _.q === 'function') {
      iurl = _.q(html, doc, _.node);
      if (Array.isArray(iurl)) {
        _.urls = iurl.slice(0);
        iurl = _.urls.shift();
      }
    } else {
      const inode = findNode(_.q, doc);
      iurl = inode ? findFile(inode, url) : false;
    }
    if (typeof _.c === 'function') {
      cap = _.c(html, doc, _.node);
    } else if (typeof _.c === 'string') {
      const cnode = findNode(_.c, doc);
      cap = cnode ? findCaption(cnode) : '';
    }
    cb(iurl, cap, url);
  });
}

function findNode(q, doc) {
  let node;
  if (!q)
    return;
  if (!Array.isArray(q))
    q = [q];
  for (let i = 0, len = q.length; i < len; i++) {
    node = qs(q[i], doc);
    if (node)
      break;
  }
  return node;
}

function findFile(n, url) {
  const base = qs('base[href]', n.ownerDocument);
  const path = n.getAttribute('src') || n.getAttribute('data-m4v') || n.getAttribute('href') ||
             n.getAttribute('content') ||
             /https?:\/\/[./a-z0-9_+%-]+\.(jpe?g|gif|png|svg|webm|mp4)/i.exec(n.outerHTML) &&
             RegExp.lastMatch;
  return path ? rel2abs(path.trim(), base ? base.getAttribute('href') : url) : false;
}

function findCaption(n) {
  return n.getAttribute('content') || n.getAttribute('title') || n.textContent;
}

function checkProgress(start) {
  if (start === true) {
    if (checkProgress.interval)
      clearInterval(checkProgress.interval);
    checkProgress.interval = setInterval(checkProgress, 150);
    return;
  }
  const p = _.popup;
  if (!p)
    return clearInterval(checkProgress.interval);
  if (!updateSize())
    return;
  clearInterval(checkProgress.interval);
  if (_.preloadStart) {
    const wait = _.preloadStart + cfg.delay - Date.now();
    if (wait > 0)
      return (_.timeout = setTimeout(checkProgress, wait));
  }
  if (_.urls && _.urls.length && Math.max(_.nheight, _.nwidth) < 130)
    return handleError({type: 'error'});
  setStatus(false);
  // do a forced layout
  p.clientHeight;
  p.className = 'mpiv-show';
  updateSpacing();
  updateScales();
  updateTitle();
  placePopup();
  if (!_.bar)
    showFileInfo();
  _.large = _.nwidth > p.clientWidth + _.mbw || _.nheight > p.clientHeight + _.mbh;
  if (_.large)
    setStatus('large');
  if (cfg.imgtab && imgtab || cfg.zoom === 'auto')
    toggleZoom();
}

function updateSize() {
  const p = _.popup;
  _.nheight = p.naturalHeight || p.videoHeight || p.loaded && 800;
  _.nwidth = p.naturalWidth || p.videoWidth || p.loaded && 1200;
  return !!_.nheight;
}

function updateSpacing() {
  const s = getComputedStyle(_.popup);
  _.pw = styleSum(s, ['padding-left', 'padding-right']);
  _.ph = styleSum(s, ['padding-top', 'padding-bottom']);
  _.mbw = styleSum(s, ['margin-left', 'margin-right', 'border-left-width', 'border-right-width']);
  _.mbh = styleSum(s, ['margin-top', 'margin-bottom', 'border-top-width', 'border-bottom-width']);
}

function updateScales() {
  const scales = cfg.scales.length ?
    cfg.scales :
    ['0!', 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8, 16];
  const fit = Math.min((_.view.width - _.mbw) / _.nwidth, (_.view.height - _.mbh) / _.nheight);
  let cutoff = _.scale = Math.min(1, fit);
  _.scales = [];
  for (let i = scales.length; i--;) {
    const val = parseFloat(scales[i]) || fit;
    const opt = typeof scales[i] === 'string' ? scales[i].slice(-1) : 0;
    if (opt === '!')
      cutoff = val;
    if (opt === '*')
      _.zscale = val;
    if (val !== _.scale)
      _.scales.push(val);
  }
  _.scales = _.scales.filter(x => x >= cutoff);
  _.scales.sort((a, b) => a - b);
  _.scales.unshift(_.scale);
}

function updateMouse(e) {
  _.cx = e.clientX;
  _.cy = e.clientY;
  const r = _.rect;
  if (r)
    _.cr = _.cx < r.right + 2 && _.cx > r.left - 2 && _.cy < r.bottom + 2 && _.cy > r.top - 2;
}

function showFileInfo() {
  if (_.gItems) {
    const item = _.gItems[_.gIndex];
    let c = _.gItems.length > 1 ? '[' + (_.gIndex + 1) + '/' + _.gItems.length + '] ' : '';
    if (_.gIndex === 0 && _.gItems.title && (!item.desc || !contains(item.desc, _.gItems.title)))
      c += _.gItems.title + (item.desc ? ' - ' : '');
    if (item.desc)
      c += item.desc;
    if (c)
      setBar(c.trim(), 'gallery', true);
  } else if ('caption' in _) {
    setBar(_.caption, 'caption');
  } else if (_.tooltip) {
    setBar(_.tooltip.text, 'tooltip');
  }
}

function updateTitle(reset) {
  if (reset) {
    if (typeof _.title === 'string' && d.title !== _.title)
      d.title = _.title;
  } else {
    if (typeof _.title !== 'string')
      _.title = d.title;
    d.title = Math.round(_.scale * 100) + '% - ' + _.nwidth + 'x' + _.nheight;
  }
}

function placePopup() {
  const p = _.popup;
  if (!p)
    return;
  let x, y;
  const w = Math.round(_.scale * _.nwidth);
  const h = Math.round(_.scale * _.nheight);
  const cx = _.cx;
  const cy = _.cy;
  const vw = _.view.width;
  const vh = _.view.height;
  if (!_.zoom && (!_.gItems || _.gItems.length < 2) && !cfg.center) {
    const r = _.rect;
    const rx = (r.left + r.right) / 2;
    const ry = (r.top + r.bottom) / 2;
    if (vw - r.right - 40 > w + _.mbw || w + _.mbw < r.left - 40) {
      if (h + _.mbh < vh - 60)
        y = clamp(ry - h / 2, 30, vh - h - 30);
      x = rx > vw / 2 ? r.left - 40 - w : r.right + 40;
    } else if (vh - r.bottom - 40 > h + _.mbh || h + _.mbh < r.top - 40) {
      if (w + _.mbw < vw - 60)
        x = clamp(rx - w / 2, 30, vw - w - 30);
      y = ry > vh / 2 ? r.top - 40 - h : r.bottom + 40;
    }
  }
  if (x === undefined) {
    const mid = vw > w ?
      vw / 2 - w / 2 :
      -1 * clamp(5 / 3 * (cx / vw - 0.2), 0, 1) * (w - vw);
    x = Math.round(mid - (_.pw + _.mbw) / 2);
  }
  if (y === undefined) {
    const mid = vh > h ?
      vh / 2 - h / 2 :
      -1 * clamp(5 / 3 * (cy / vh - 0.2), 0, 1) * (h - vh);
    y = Math.round(mid - (_.ph + _.mbh) / 2);
  }
  p.style.cssText = `
    width: ${w}px !important;
    height: ${h}px !important;
    left: ${x}px !important;
    top: ${y}px !important;
  `;
}

function toggleZoom() {
  const p = _.popup;
  if (!p || !_.scales || _.scales.length < 2)
    return;
  _.zoom = !_.zoom;
  _.zoomed = true;
  _.scale =
    _.scales[_.zoom ? (_.scales.indexOf(_.zscale) > 0 ? _.scales.indexOf(_.zscale) : 1) : 0];
  if (_.zooming)
    p.classList.add('mpiv-zooming');
  placePopup();
  updateTitle();
  setStatus(_.zoom ? 'zoom' : false);
  if (cfg.zoom !== 'auto')
    setBar(false);
  if (!_.zoom)
    showFileInfo();
  return _.zoom;
}

function handleError(o) {
  const m = [
    o.message || (o.readyState ?
      'Request failed.' :
      (o.type === 'error' ?
        'File can\'t be displayed.' +
        (qs('div[bgactive*="flashblock"]', d) ? ' Check Flashblock settings.' : '') :
        o)),
  ];
  try {
    if (o.stack)
      m.push(' @ ' + o.stack.replace(/<?@file:.+?\.js/g, ''));
    if (_.u)
      m.push('Url simple match:', Array.isArray(_.u) ? _.u.slice() : _.u);
    if (_.r)
      m.push('RegExp match:', _.r);
    if (_.url)
      m.push('URL:', _.url);
    if (_.iurl)
      m.push('File:', _.iurl);
    console.log(m);
  } catch (ex) {}
  if (contains(hostname, 'google') && contains(location.search, 'tbm=isch') && !_.xhr && cfg.xhr) {
    _.xhr = true;
    startSinglePopup(_.url);
  } else if (_.urls && _.urls.length) {
    _.url = _.urls.shift();
    if (!_.url) {
      deactivate();
    } else {
      startSinglePopup(_.url);
    }
  } else if (_.node) {
    setStatus('error');
    setBar(m[0], 'error');
  }
}

function setStatus(status, flag) {
  const de = d.documentElement;
  let cn = de.className;
  if (flag === 'remove') {
    cn = cn.replace('mpiv-' + status, '');
  } else {
    if (flag !== 'add')
      cn = cn.replace(/mpiv-[a-z]+/g, '');
    if (status && !contains(cn, 'mpiv-' + status))
      cn += ' mpiv-' + status;
  }
  de.className = cn;
}

function setPopup(src) {
  let p = _.popup;
  if (p) {
    _.zoom = false;
    off(p, 'error', handleError);
    if (typeof p.pause === 'function')
      p.pause();
    if (!_.lazyUnload) {
      if (p.src.substr(0, 5) === 'blob:')
        URL.revokeObjectURL(p.src);
      p.src = '';
    }
    rm(p);
    delete _.popup;
  }
  if (!src)
    return;
  if (src.substr(0, 5) !== 'data:' && /\.(webm|mp4)($|\?)/.test(src) || src.substr(0, 10) ===
      'data:video') {
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
    p = _.popup = ce('video');
    p.autoplay = true;
    p.loop = true;
    p.volume = 0.5;
    p.controls = false;
    on(p, 'progress', onProgress);
    on(p, 'canplaythrough', e => {
      off(e.target, 'progress', onProgress);
      if (_.bar && _.bar.classList.contains('mpiv-xhr')) {
        setBar(false);
        showFileInfo();
      }
    });
  } else {
    p = _.popup = ce('img');
  }
  p.id = 'mpiv-popup';
  on(p, 'error', handleError);
  on(p, 'load', function () {
    // eslint-disable-next-line no-invalid-this
    this.loaded = true;
  });
  if (_.zooming) {
    on(p, 'transitionend', e => {
      e.target.classList.remove('mpiv-zooming');
    });
  }
  _.bar ? d.body.insertBefore(p, _.bar) : d.body.appendChild(p);
  p.src = src;
  p = null;
  checkProgress(true);
}

function setBar(label, cn) {
  let b = _.bar;
  if (!label) {
    rm(b);
    delete _.bar;
    return;
  }
  if (!b) {
    b = _.bar = ce('div');
    b.id = 'mpiv-bar';
  }
  updateStyles();
  b.innerHTML = label;
  if (!b.parentNode) {
    d.body.appendChild(b);
    // do a forced layout
    b.clientHeight;
  }
  b.className = 'mpiv-show mpiv-' + cn;
}

function rel2abs(rel, abs) {
  if (rel.substr(0, 5) === 'data:')
    return rel;
  const re = /^([a-z]+:)\/\//;
  if (re.test(rel))
    return rel;
  if (!re.exec(abs))
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
  if (s.charAt(0) === '/' && s.charAt(1) !== '/') {
    const mid = /[^\\]\//.exec(s).index + 1;
    const end = s.lastIndexOf('/');
    const re = new RegExp(s.substring(1, mid), s.substr(end + 1));
    return m.input.replace(re, s.substring(mid + 1, end));
  }
  for (let i = m.length; i--;) {
    s = s.replace('$' + i, m[i]);
  }
  return s;
}

function styleSum(s, p) {
  let x = 0;
  let i = p.length;
  while (i--)
    x += parseInt(s.getPropertyValue(p[i])) || 0;
  return x;
}

function findScale(url, parent) {
  const imgs = qsa('img, video', parent);
  for (let i = imgs.length, img; i-- && (img = imgs[i]);) {
    if (img.src !== url)
      continue;
    const s = Math.max((img.naturalHeight || img.videoHeight) / img.offsetHeight,
      (img.naturalWidth || img.videoWidth) / img.offsetWidth);
    if (isFinite(s))
      return s;
  }
}

function viewRect() {
  const node = d.compatMode === 'BackCompat' ? d.body : d.documentElement;
  return {
    width: node.clientWidth,
    height: node.clientHeight,
  };
}

function rect(node, q) {
  let n;
  if (q) {
    n = node;
    while (tag(n = n.parentNode) !== 'BODY') {
      if (matches(n, q))
        return n.getBoundingClientRect();
    }
  }
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
    enumerable: true,
    get() {
      const value = rect(...args);
      Object.defineProperty(obj, 'rect', {value});
      return value;
    },
  });
}

function matches(n, q) {
  const p = Element.prototype;
  const m = p.matches || p.mozMatchesSelector || p.webkitMatchesSelector || p.oMatchesSelector;
  if (m)
    return m.call(n, q);
}

function closest(n, q) {
  while (n) {
    if (matches(n, q))
      return n;
    n = n.parentNode;
  }
}

function tag(n) {
  return n && n.tagName || '';
}

function createDoc(text) {
  return new DOMParser().parseFromString(text, 'text/html');
}

function rm(n) {
  if (n)
    n.remove();
}

function on(n, e, f, options) {
  n.addEventListener(e, f, options);
}

function off(n, e, f) {
  n.removeEventListener(e, f);
}

function drop(e) {
  e.preventDefault();
  e.stopPropagation();
}

function ce(s) {
  return d.createElement(s);
}

function qs(s, n) {
  return n.querySelector(s);
}

function qsa(s, n) {
  return n.querySelectorAll(s);
}

function contains(a, b) {
  return a && a.indexOf(b) > -1;
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch (e) {}
}

function setup() {
  const ID = 'mpiv-setup:host';
  let div, root;

  function $(s) {
    return root.getElementById(s);
  }

  function close() {
    rm(d.getElementById(ID));
    if (!contains(trusted, hostname))
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
        rm(t);
      }
      ok = 1;
    } catch (ex) {}
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
    cfg.hosts = [...qsa('textarea', $('hosts'))]
      .map(el => el.__json || el.value.trim())
      .filter(Boolean)
      .sort();
    return fixCfg(cfg);
  }

  function init(cfg) {
    close();
    if (!contains(trusted, hostname))
      on(window, 'message', onMessage);
    div = ce('div');
    div.id = ID;
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
            <input id="search" type="search" placeholder="Search" hidden>
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
      for (const h of cfg.hosts) {
        const el = template.cloneNode();
        el.value = typeof h === 'string' ? h : JSON.stringify(h);
        parent.appendChild(el);
        check({target: el});
      }
      on(parent, 'focusin', ({target: el}) => {
        if (el.localName === 'textarea') {
          const h = clamp(el.scrollHeight, 15, div.clientHeight / 4);
          if (h > el.offsetHeight)
            el.style.height = h + 'px';
        }
      });
      on(parent, 'focusout', ({target: el}) => {
        if (el.localName === 'textarea' && el.style.height)
          el.style.height = '';
      });
      if (cfg.hosts.length > 1 || setup.search) {
        const se = $('search');
        const doSearch = () => {
          const s = se.value.toLowerCase();
          setup.search = s;
          for (const el of qsa('textarea', $('hosts')))
            el.hidden = s && !contains(el.value.toLowerCase(), s);
        };
        let timer;
        on(se, 'input', e => {
          clearTimeout(timer);
          setTimeout(doSearch, 200);
        });
        se.value = setup.search || '';
        if (se.value)
          doSearch();
        se.hidden = false;
      }
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
      hosts = loadHosts();
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
    d.body.appendChild(div);
    requestAnimationFrame(() => {
      $('css').style.height = clamp($('css').scrollHeight, 40, div.clientHeight / 4) + 'px';
    });
  }

  init(loadCfg());
}

function addStyle(name, css) {
  const id = 'mpiv-style:' + name;
  const el = d.getElementById(id) ||
             css && Object.assign(ce('style'), {id});
  if (!el)
    return;
  if (el.textContent !== css)
    el.textContent = css;
  if (el.parentElement !== d.head)
    d.head.appendChild(el);
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
  addStyle('config', contains(cfg.css, '{') ? cfg.css : '#mpiv-popup {' + cfg.css + '}');
  addStyle('rule', _.css || '');
}
