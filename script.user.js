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

// @version     1.0.6
// @author      tophf

// @original-version 2017.9.29
// @original-author  kuehlschrank

// @homepage    https://w9p.co/userscripts/mpiv/
// @icon        https://w9p.co/userscripts/mpiv/icon.png
// ==/UserScript==

'use strict';

//#region Global vars

const doc = document;
const hostname = location.hostname;
const dotDomain = '.' + hostname;
const trusted = ['greasyfork.org', 'w9p.co'];
const isImageTab = doc.images.length === 1 &&
                   doc.images[0].parentNode === doc.body &&
                   !doc.links.length;
const isGoogleDomain = /(^|\.)google(\.com?)?(\.\w+)?$/.test(hostname);

const PREFIX = 'mpiv-';
const SETUP_ID = PREFIX + 'setup:host';
const STATUS_ATTR = `${PREFIX}status`;
const WHEEL_EVENT = 'onwheel' in doc ? 'wheel' : 'mousewheel';
// used to detect JS code in host rules
const RX_HAS_CODE = /(^|[^-\w])return[\W\s]/;

/** @type mpiv.Config */
let cfg;
/** @type mpiv.AppInfo */
let ai = {rule: {}};

//#endregion
//#region App

class App {

  static activate(info, event) {
    const force = event.ctrlKey;
    if (info.rule.distinct && !force) {
      const scale = Util.findScale(info.url, info.node.parentNode);
      if (scale && scale < cfg.scale)
        return;
    }
    if (ai.node)
      App.deactivate();
    ai = info;
    const view = doc.compatMode === 'BackCompat' ? doc.body : doc.documentElement;
    ai.view = {
      width: view.clientWidth,
      height: view.clientHeight,
    };
    ai.zooming = includes(cfg.css, `${PREFIX}zooming`);
    Util.suppressHoverTooltip();
    App.setListeners();
    App.updateMouse(event);
    if (force) {
      Popup.start();
    } else if (cfg.start === 'auto' && !ai.rule.manual) {
      Popup.schedule();
    } else {
      App.setStatus('ready');
    }
  }

  static checkProgress(start) {
    const oldTimer = App.progressTimer;
    if (start === true) {
      App.progressTimer = setInterval(App.checkProgress, 150);
    } else if (ai.popup) {
      const p = ai.popup;
      ai.nheight = p.naturalHeight || p.videoHeight || ai.popupLoaded && 800;
      ai.nwidth = p.naturalWidth || p.videoWidth || ai.popupLoaded && 1200;
      if (!ai.nheight)
        return;
      App.updateProgress();
    }
    clearInterval(oldTimer);
  }

  static deactivate({wait} = {}) {
    clearTimeout(ai.timeout);
    if (ai.req)
      tryCatch.call(ai.req, ai.req.abort);
    if (ai.tooltip)
      ai.tooltip.node.title = ai.tooltip.text;
    App.restoreTitle();
    App.setStatus(false);
    App.setBar(false);
    App.setListeners(false);
    Popup.destroy();
    if (wait) {
      App.enabled = false;
      setTimeout(App.enable, 200);
    }
    ai = {rule: {}};
  }

  static enable() {
    App.enabled = true;
  }

  static handleError(e, rule = ai.rule) {
    const fe = Util.formatError(e, rule);
    console.warn(fe.consoleFormat, ...fe.consoleArgs);
    if (cfg.xhr && !ai.xhr &&
        isGoogleDomain && location.search.includes('tbm=isch')) {
      ai.xhr = true;
      Popup.startSingle();
    } else if (ai.urls && ai.urls.length) {
      ai.url = ai.urls.shift();
      ai.url ?
        Popup.startSingle() :
        App.deactivate();
    } else if (ai.node) {
      App.setStatus('error');
      App.setBar(fe.message, 'error');
    }
  }

  static setBar(label, className) {
    let b = ai.bar;
    if (!label) {
      b && b.remove();
      ai.bar = null;
      return;
    }
    if (!b) {
      b = ai.bar = doc.createElement('div');
      b.id = `${PREFIX}bar`;
    }
    App.updateStyles();
    b.innerHTML = label;
    if (!b.parentNode) {
      doc.body.appendChild(b);
      Util.forceLayout(b);
    }
    b.className = `${PREFIX}show ${PREFIX}${className}`;
  }

  static setListeners(enable = true) {
    const onOff = enable ? doc.addEventListener : doc.removeEventListener;
    const passive = enable ? {passive: true} : undefined;
    onOff.call(doc, 'mousemove', Events.onMouseMove, passive);
    onOff.call(doc, 'mouseout', Events.onMouseOut, passive);
    onOff.call(doc, 'mousedown', Events.onMouseDown, passive);
    onOff.call(doc, 'contextmenu', Events.onContext);
    onOff.call(doc, 'keydown', Events.onKeyDown);
    onOff.call(doc, 'keyup', Events.onKeyUp);
    onOff.call(doc, WHEEL_EVENT, Events.onMouseScroll, enable ? {passive: false} : undefined);
  }

  static setStatus(status) {
    if (!status && !cfg.exposeStatus) {
      ai.node && ai.node.removeAttribute(STATUS_ATTR);
      return;
    }
    const prefix = cfg.exposeStatus ? PREFIX : '';
    const action = status && /^[+-]/.test(status) && status[0];
    const name = status && `${prefix}${action ? status.slice(1) : status}`;
    const el = cfg.exposeStatus ? doc.documentElement :
      name === 'edge' ? ai.popup :
        ai.node;
    if (!el)
      return;
    const attr = cfg.exposeStatus ? 'class' : STATUS_ATTR;
    const oldValue = (el.getAttribute(attr) || '').trim();
    const cls = new Set(oldValue ? oldValue.split(/\s+/) : []);
    switch (action) {
      case '-':
        cls.delete(name);
        break;
      case false:
        for (const c of cls)
          if (c.startsWith(prefix) && c !== name)
            cls.delete(c);
        // fallthrough to +
      case '+':
        if (name)
          cls.add(name);
        break;
    }
    const newValue = [...cls].join(' ');
    if (newValue !== oldValue)
      el.setAttribute(attr, newValue);
  }

  static toggleZoom() {
    const p = ai.popup;
    if (!p || !ai.scales || ai.scales.length < 2)
      return;
    ai.zoom = !ai.zoom;
    ai.zoomed = true;
    const z = ai.scales.indexOf(ai.zscale);
    ai.scale = ai.scales[ai.zoom ? (z > 0 ? z : 1) : 0];
    if (ai.zooming)
      p.classList.add(`${PREFIX}zooming`);
    Popup.move();
    App.updateTitle();
    App.setStatus(ai.zoom ? 'zoom' : false);
    if (cfg.zoom !== 'auto')
      App.setBar(false);
    if (!ai.zoom)
      App.updateFileInfo();
    return ai.zoom;
  }

  static updateCaption(text, doc = document) {
    switch (typeof ai.rule.c) {
      case 'function':
        // don't specify as a parameter's default value, instead get the html only when needed
        if (text === undefined)
          text = doc.documentElement.outerHTML;
        ai.caption = ai.rule.c(text, doc, ai.node, ai.rule);
        break;
      case 'string': {
        const el = qsMany(ai.rule.c, doc);
        ai.caption = !el ? '' :
          el.getAttribute('content') ||
          el.getAttribute('title') ||
          el.textContent;
        break;
      }
    }
  }

  static updateFileInfo() {
    const gi = ai.gItems;
    if (gi) {
      const item = gi[ai.gIndex];
      let c = gi.length > 1 ? '[' + (ai.gIndex + 1) + '/' + gi.length + '] ' : '';
      if (ai.gIndex === 0 && gi.title && (!item.desc || !includes(item.desc, gi.title)))
        c += gi.title + (item.desc ? ' - ' : '');
      if (item.desc)
        c += item.desc;
      if (c)
        App.setBar(c.trim(), 'gallery', true);
    } else if ('caption' in ai) {
      App.setBar(ai.caption, 'caption');
    } else if (ai.tooltip) {
      App.setBar(ai.tooltip.text, 'tooltip');
    }
  }

  static updateMouse(e) {
    const cx = ai.clientX = e.clientX;
    const cy = ai.clientY = e.clientY;
    const r = ai.rect;
    if (r)
      ai.isOverRect =
        cx < r.right + 2 &&
        cx > r.left - 2 &&
        cy < r.bottom + 2 &&
        cy > r.top - 2;
  }

  static updateProgress() {
    if (ai.preloadStart) {
      const wait = ai.preloadStart + cfg.delay - Date.now();
      if (wait > 0) {
        ai.timeout = setTimeout(App.checkProgress, wait);
        return;
      }
    }
    if (ai.urls && ai.urls.length && Math.max(ai.nheight, ai.nwidth) < 130) {
      App.handleError({type: 'error'});
      return;
    }
    App.setStatus(false);
    Util.forceLayout(ai.popup);
    ai.popup.className = `${PREFIX}show`;
    App.updateSpacing();
    App.updateScales();
    App.updateTitle();
    Popup.move();
    if (!ai.bar)
      App.updateFileInfo();
    ai.large = ai.nwidth > ai.popup.clientWidth + ai.mbw ||
               ai.nheight > ai.popup.clientHeight + ai.mbh;
    if (ai.large)
      App.setStatus('large');
    if (cfg.imgtab && isImageTab || cfg.zoom === 'auto')
      App.toggleZoom();
  }

  static updateScales() {
    const scales = cfg.scales.length ? cfg.scales :
      ['0!', 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8, 16];
    const fit = Math.min(
      (ai.view.width - ai.mbw - ai.outline * 2) / ai.nwidth,
      (ai.view.height - ai.mbh - ai.outline * 2) / ai.nheight);
    let cutoff = ai.scale = Math.min(1, fit);
    ai.scales = [];
    for (let i = scales.length; i--;) {
      const scale = scales[i];
      const val = parseFloat(scale) || fit;
      const option = typeof scale === 'string' && scale.slice(-1);
      if (option === '!')
        cutoff = val;
      if (option === '*')
        ai.zscale = val;
      if (val !== ai.scale)
        ai.scales.push(val);
    }
    ai.scales = ai.scales
      .filter(x => x >= cutoff)
      .sort((a, b) => a - b);
    ai.scales.unshift(ai.scale);
  }

  static updateSpacing() {
    const s = getComputedStyle(ai.popup);
    ai.outline =
      (parseFloat(s['outline-offset']) || 0) +
      (parseFloat(s['outline-width']) || 0);
    ai.pw =
      (parseFloat(s['padding-left']) || 0) +
      (parseFloat(s['padding-right']) || 0);
    ai.ph =
      (parseFloat(s['padding-top']) || 0) +
      (parseFloat(s['padding-bottom']) || 0);
    ai.mbw =
      (parseFloat(s['margin-left']) || 0) +
      (parseFloat(s['margin-right']) || 0) +
      (parseFloat(s['border-left-width']) || 0) +
      (parseFloat(s['border-right-width']) || 0);
    ai.mbh =
      (parseFloat(s['margin-top']) || 0) +
      (parseFloat(s['margin-bottom']) || 0) +
      (parseFloat(s['border-top-width']) || 0) +
      (parseFloat(s['border-bottom-width']) || 0);
  }

  static updateStyles() {
    Util.addStyle('global', /*language=CSS*/ App.globalStyle || (App.globalStyle = `
      #${PREFIX}bar {
        position: fixed;
        z-index: 2147483647;
        left: 0;
        right: 0;
        top: 0;
        transform: scaleY(0);
        transform-origin: top;
        transition: transform 500ms ease 1000ms;
        text-align: center;
        font-family: sans-serif;
        font-size: 15px;
        font-weight: bold;
        background: rgba(0, 0, 0, 0.6);
        color: white;
        padding: 4px 10px;
      }
      #${PREFIX}bar.${PREFIX}show {
        transform: scaleY(1);
      }
      #${PREFIX}popup.${PREFIX}show {
        display: inline;
      }
      #${PREFIX}popup {
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
      ${cfg.exposeStatus ? `
        .${PREFIX}loading:not(.${PREFIX}preloading) * {
          cursor: wait !important;
        }
        .${PREFIX}edge #${PREFIX}popup {
          cursor: default;
        }
        .${PREFIX}error * {
          cursor: not-allowed !important;
        }
        .${PREFIX}ready *, .${PREFIX}large * {
          cursor: zoom-in !important;
        }
        .${PREFIX}shift * {
          cursor: default !important;
        }
      ` : `
        [${STATUS_ATTR}~="loading"]:not([${STATUS_ATTR}~="preloading"]) {
          cursor: wait !important;
        }
        #${PREFIX}popup[${STATUS_ATTR}~="edge"] {
          cursor: default !important;
        }
        [${STATUS_ATTR}~="error"] {
          cursor: not-allowed !important;
        }
        [${STATUS_ATTR}~="ready"],
        [${STATUS_ATTR}~="large"] {
          cursor: zoom-in !important;
        }
        [${STATUS_ATTR}~="shift"] {
          cursor: default !important;
        }
      `}
      ${cfg.css.includes('{') ? cfg.css : `#${PREFIX}popup {${cfg.css}}`}
    `));
    Util.addStyle('rule', ai.rule.css || '');
  }

  static updateTitle() {
    if (typeof ai.title !== 'string')
      ai.title = doc.title;
    doc.title = `${Math.round(ai.scale * 100)}% - ${ai.nwidth}x${ai.nheight}`;
  }

  static restoreTitle() {
    const t = ai.title;
    if (typeof t === 'string' && doc.title !== t)
      doc.title = t;
  }
}

//#endregion
//#region Config

class Config {
  constructor({data: c = GM_getValue('cfg'), save}) {
    const DEFAULTS = Object.assign(Object.create(null), {
      center: false,
      close: true,
      css: '',
      delay: 500,
      exposeStatus: false,
      hosts: [],
      imgtab: false,
      preload: false,
      scale: 1.5,
      scales: [],
      start: 'auto',
      version: 5,
      xhr: true,
      zoom: 'context',
    });
    if (typeof c === 'string')
      c = tryCatch(JSON.parse, c);
    if (typeof c !== 'object' || !c)
      c = {};
    if (typeof c.hosts === 'string')
      c.hosts = c.hosts.split('\n')
        .map(s => tryCatch(JSON.parse, s) || s)
        .filter(Boolean);
    if (c.version !== DEFAULTS.version) {
      for (const dp in DEFAULTS)
        if (typeof c[dp] !== typeof DEFAULTS[dp])
          c[dp] = DEFAULTS[dp];
      if (c.version === 3 && c.scales[0] === 0)
        c.scales[0] = '0!';
      for (const cp in c)
        if (!(cp in DEFAULTS))
          delete c[cp];
      c.version = DEFAULTS.version;
      if (save)
        GM_setValue('cfg', JSON.stringify(c));
    }
    if (cfg && (
      cfg.css !== c.css ||
      cfg.exposeStatus !== c.exposeStatus
    )) {
      App.globalStyle = '';
    }
    Object.assign(this, c);
  }
}

//#endregion
//#region Ruler

class Ruler {
/*
 'u' works only with URLs so it's ignored if 'html' is true
   ||some.domain = matches some.domain, anything.some.domain, etc.
   |foo = url or text must start with foo
   ^ = separator like / or ? or : but not a letter/number, not %._-
       when used at the end like "foo^" it additionally matches when the source ends with "foo"
 'r' is checked only if 'u' matches first
*/
  static init() {
    const errors = new Map();
    const customRules = (cfg.hosts || []).map(Ruler.parse, errors);
    for (const rule of errors.keys())
      App.handleError('Invalid custom host rule:', rule);

    // rules that disable previewing
    const disablers = [
      dotDomain.endsWith('.stackoverflow.com') && {
        e: '.post-tag, .post-tag img',
        s: '',
      }, {
        u: '||disqus.com/',
        s: '',
      },
    ];

    // optimization: a rule is created only when on domain
    const perDomain = [
      hostname.includes('startpage') && {
        r: /\boiu=(.+)/,
        s: '$1',
        follow: true,
      },
      dotDomain.endsWith('.4chan.org') && {
        e: '.is_catalog .thread a[href*="/thread/"], .catalog-thread a[href*="/thread/"]',
        q: '.op .fileText a',
        css: '#post-preview{display:none}',
      },
      hostname.includes('amazon.') && {
        u: 'amazon.com/images/I/',
        r: /(?:^|\/\/)(.+?\/I\/.+?\.)/,
        s: m => {
          const uh = doc.getElementById('universal-hover');
          return uh ? '' : m[1] + 'jpg';
        },
        css: '#zoomWindow{display:none!important;}',
      },
      dotDomain.endsWith('.bing.com') && {
        e: 'a[m*="murl"]',
        r: /murl&quot;:&quot;(.+?)&quot;/,
        s: '$1',
        html: true,
      },
      dotDomain.endsWith('.deviantart.com') && {
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
      dotDomain.endsWith('.dropbox.com') && {
        r: /(.+?&size_mode)=\d+(.*)/,
        s: '$1=5$2',
      },
      dotDomain.endsWith('.facebook.com') && {
        e: 'a[href*="ref=hovercard"]',
        s: (m, node) =>
          'https://www.facebook.com/photo.php?fbid=' +
          /\/[0-9]+_([0-9]+)_/.exec(qs('img', node).src)[1],
        follow: true,
      },
      dotDomain.endsWith('.facebook.com') && {
        r: /(fbcdn|external).*?(app_full_proxy|safe_image).+?(src|url)=(http.+?)[&"']/,
        s: (m, node) =>
          node.parentNode.className.includes('video') && m[4].includes('fbcdn') ? '' :
            decodeURIComponent(m[4]),
        html: true,
        follow: true,
      },
      dotDomain.endsWith('.flickr.com') &&
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
      dotDomain.endsWith('.github.com') && {
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
      dotDomain.endsWith('.instagram.com') && {
        e: [
          'a[href*="/p/"]',
          'a[role="button"][data-reactid*="scontent-"]',
          'article div',
          'article div div img',
        ],
        s: (m, node, rule) => {
          const {a, data} = rule._getData(node) || {};
          rule.follow = !data;
          return (
            !a ? false :
              !data ? a.href :
                data.video_url || data.display_url);
        },
        c: (html, doc, node, rule) =>
          tryCatch(() => rule._getData(node).data.edge_media_to_caption.edges[0].node.text) || '',
        follow: true,
        _getData(node) {
          const n = node.closest('a[href*="/p/"], article');
          if (!n)
            return;
          const a = n.tagName === 'A' ? n : qs('a[href*="/p/"]', n);
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
        },
      },
      dotDomain.endsWith('.reddit.com') && {
        u: '||i.reddituploads.com/',
      },
      dotDomain.endsWith('.reddit.com') && {
        u: '||preview.redd.it/',
        r: /(redd\.it\/\w+\.(jpe?g|png|gif))/,
        s: 'https://i.$1',
      },
      dotDomain.endsWith('.tumblr.com') && {
        e: 'div.photo_stage_img, div.photo_stage > canvas',
        s: (m, node) => /http[^"]+/.exec(node.style.cssText + node.getAttribute('data-img-src'))[0],
        follow: true,
      },
      dotDomain.endsWith('.tweetdeck.twitter.com') && {
        e: 'a.media-item, a.js-media-image-link',
        s: (m, node) => /http[^)]+/.exec(node.style.backgroundImage)[0],
        follow: true,
      },
      dotDomain.endsWith('.twitter.com') && {
        e: '.grid-tweet > .media-overlay',
        s: (m, node) => node.previousElementSibling.src,
        follow: true,
      },
      dotDomain.endsWith('.youtube.com') && {
        e: 'ytd-thumbnail *',
        s: '',
      },
    ];

    const main = [
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
          dotDomain.endsWith('.facebook.com') &&
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
        u: '//gyazo.com/',
        r: /\.com\/\w{32,}/,
        q: 'meta[name="twitter:image"]',
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
        xhr: hostname.includes('planetsuzy'),
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
        g: async (text, url, m, rule, cb) => {
          // simplified extraction of JSON as it occupies only one line
          if (!/(?:mergeConfig\('gallery',\s*|Imgur\.Album\.getInstance\()[\s\S]*?[,\s{"'](?:image|album)\s*:\s*({[^\r\n]+?}),?[\r\n]/.test(text))
            return;
          const info = JSON.parse(RegExp.$1);
          let images = info.is_album ? info.album_images.images : [info];
          if (info.num_images > images.length) {
            const url = `https://imgur.com/ajaxalbums/getimages/${info.hash}/hit.json?all=true`;
            images = JSON.parse((await Remoting.gmXhr({url})).responseText).data.images;
          }
          const items = [];
          for (const img of images || []) {
            const u = `https://i.imgur.com/${img.hash}`;
            items.push({
              url: img.ext === '.gif' && img.animated !== false ?
                [`${u}.webm`, `${u}.mp4`, u] :
                u + img.ext,
              desc: [img.title, img.description].filter(Boolean).join(' - '),
            });
          }
          if (images && info.is_album && !includes(items[0].desc, info.title))
            items.title = info.title;
          cb(items);
        },
        css: '.post > .hover { display:none!important; }',
      },
      {
        u: '||imgur.com/',
        r: /((?:[a-z]{2,}\.)?imgur\.com\/)((?:\w+,)+)/,
        g: (text, url, m) =>
          m[2].split(',').map(id => ({
            url: `https://i.${m[1]}${id}.jpg`,
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
          const id = m[3].replace(/(.{7})[bhm]$/, '$1');
          const ext = m[5] ? m[5].replace(/gifv?/, 'webm') : 'jpg';
          const u = `https://i.${(m[1] || '').replace('www.', '')}imgur.com/${id}.`;
          return ext === 'webm' ?
            [`${u}webm`, `${u}mp4`, `${u}gif`] :
            u + ext;
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
        xhr: !dotDomain.endsWith('.photobucket.com'),
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
        u: '||twimg.com/media/',
        r: /format=(jpe?g|png|gif)/i,
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
        s: '/\\/thumb(?=\\/)|' +
           '\\/scale-to-width(-[a-z]+)?\\/[0-9]+|' +
           '\\/revision\\/latest|\\/[^\\/]+$//g',
        xhr: !hostname.includes('wiki'),
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
          '.gif',
          '.png',
          '.svg',
          '.webm',
        ],
        r: /[^?:]+\.(jpe?g?|gif|png|svg|webm)($|\?)/i,
        distinct: true,
      },
    ];

    /** @type mpiv.HostRule[] */
    Ruler.rules = [].concat(customRules, disablers, perDomain, main).filter(Boolean);
  }

  /** @returns mpiv.HostRule | Error | false | undefined */
  static parse(rule) {
    const isBatchOp = this instanceof Map;
    try {
      if (typeof rule === 'string')
        rule = JSON.parse(rule);
      if ('d' in rule && typeof rule.d !== 'string')
        rule.d = undefined;
      else if (isBatchOp && rule.d && !hostname.includes(rule.d))
        return false;
      const compileTo = isBatchOp ? rule : {};
      if (rule.r)
        compileTo.r = new RegExp(rule.r, 'i');
      if (RX_HAS_CODE.test(rule.s))
        compileTo.s = new Function('m', 'node', 'rule', rule.s);
      if (RX_HAS_CODE.test(rule.q))
        compileTo.q = new Function('text', 'doc', 'node', 'rule', rule.q);
      if (RX_HAS_CODE.test(rule.c))
        compileTo.c = new Function('text', 'doc', 'node', 'rule', rule.c);
      return rule;
    } catch (e) {
      if (!e.message.includes('unsafe-eval'))
        if (isBatchOp) {
          this.set(rule, e);
        } else {
          return e;
        }
    }
  }

  static runQ(text, doc, docUrl) {
    let url;
    if (typeof ai.rule.q === 'function') {
      url = ai.rule.q(text, doc, ai.node, ai.rule);
      if (Array.isArray(url)) {
        ai.urls = url.slice(1);
        url = url[0];
      }
    } else {
      const el = qsMany(ai.rule.q, doc);
      url = el && Remoting.findFileUrl(el, docUrl);
    }
    return url;
  }

  static runS(node, rule, m) {
    let urls = [];
    for (const s of ensureArray(rule.s))
      urls.push(
        typeof s === 'string' ? decodeURIComponent(Ruler.substituteSingle(s, m)) :
          typeof s === 'function' ? s(m, node, rule) :
            s);
    if (rule.q && urls.length > 1) {
      console.warn('Rule discarded: "s" array is not allowed with "q"\n%o', rule);
      return {skipRule: true};
    }
    if (Array.isArray(urls[0]))
      urls = urls[0];
    // `false` returned by "s" property means "skip this rule"
    // any other falsy value (like say "") means "stop all rules"
    return urls[0] === false ?
      {skipRule: true} :
      urls.map(u => u ? decodeURIComponent(u) : u);
  }

  static substituteSingle(s, m) {
    if (!m)
      return s;
    if (s.startsWith('/') && !s.startsWith('//')) {
      const mid = s.search(/[^\\]\//) + 1;
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
}

//#endregion
//#region SimpleUrlMatcher

const SimpleUrlMatcher = (() => {
  // string-to-regexp escaped chars
  const RX_ESCAPE = /[.+*?(){}[\]^$|]/g;
  // rx for '^' symbol in simple url match
  const RX_SEP = /[^\w%._-]/g;
  const RXS_SEP = RX_SEP.source;

  function checkArray(s) {
    return this.some(checkArrayItem, s);
  }

  function checkArrayItem(item) {
    return item.fn.call(item.this, this);
  }

  function equals(s) {
    return s.startsWith(this) && (
      s.length === this.length ||
      s.length === this.length + 1 && endsWithSep(s));
  }

  function starts(s) {
    return s.startsWith(this);
  }

  function ends(s) {
    return s.endsWith(this) || (
      s.length > this.length &&
      s.indexOf(this, s.length - this.length - 1) >= 0 &&
      endsWithSep(s));
  }

  function has(s) {
    return s.includes(this);
  }

  function regexp(s) {
    return s.includes(this[0]) && this[1].test(s);
  }

  function endsWithSep(s) {
    RX_SEP.lastIndex = s.length - 1;
    return RX_SEP.test(s);
  }

  function startsDomainPrescreen(url) {
    return url.includes(this[0]) &&
           startsDomain.call(this, url);
  }

  function startsDomain(url) {
    const [p, gap, host] = url.split('/', 3);
    if (gap || p && !p.endsWith(':'))
      return;
    const [needle, domain, pinDomainEnd, endSep] = this;
    let start = pinDomainEnd ? host.length - domain.length : 0;
    for (; ; start++) {
      start = host.indexOf(domain, start);
      if (start < 0)
        return;
      if (!start || host[start - 1] === '.')
        break;
    }
    start += p.length + 2;
    return url.lastIndexOf(needle, start) === start &&
           (!endSep || start + needle.length === url.length);
  }

  function findLongestPart(s) {
    const len = s.length;
    let maxLen = 0;
    let start;
    for (let i = 0, j; i < len; i = j + 1) {
      j = s.indexOf('^', i);
      if (j < 0)
        j = len;
      if (j - i > maxLen) {
        maxLen = j - i;
        start = i;
      }
    }
    return maxLen < len ? s.substr(start, maxLen) : s;
  }

  return {
    compile(match) {
      const results = [];
      for (const s of ensureArray(match)) {
        const pinDomain = s.startsWith('||');
        const pinStart = !pinDomain && s.startsWith('|');
        const endSep = s.endsWith('^');
        let fn;
        let needle = s.slice(pinDomain * 2 + pinStart, -endSep || undefined);
        if (needle.includes('^')) {
          const plain = findLongestPart(needle);
          const rx = new RegExp(
            (pinStart ? '^' : '') +
            (pinDomain ? '^(([^/:]+:)?//)?([^./]*\\.)*?' : '') +
            needle.replace(RX_ESCAPE, '\\$&').replace(/\\\^/g, RXS_SEP) +
            (endSep ? `(?:${RXS_SEP}|$)` : ''), 'i');
          needle = [plain, rx];
          fn = regexp;
        } else if (pinStart) {
          fn = endSep ? equals : starts;
        } else if (pinDomain) {
          const slashPos = needle.indexOf('/');
          const domain = slashPos > 0 ? needle.slice(0, slashPos) : needle;
          needle = [needle, domain, slashPos > 0, endSep];
          fn = startsDomainPrescreen;
        } else if (endSep) {
          fn = ends;
        } else {
          fn = has;
        }
        results.push({fn, this: needle});
      }
      return results.length > 1 ?
        {fn: checkArray, this: results} :
        results[0];
    },
  };
})();

//#endregion
//#region RuleMatcher

class RuleMatcher {

  /** @returns ?mpiv.RuleMatchInfo */
  static findForLink(a) {
    let url =
      a.getAttribute('data-expanded-url') ||
      a.getAttribute('data-full-url') ||
      a.getAttribute('data-url') ||
      a.href;
    if (url.length > 750 || url.startsWith('data:')) {
      url = false;
    } else if (url.includes('//t.co/')) {
      url = 'http://' + a.textContent;
    }
    return RuleMatcher.find(url, a);
  }

  /** @returns ?mpiv.RuleMatchInfo */
  static find(url, node, {noHtml, skipRule} = {}) {
    const tn = node.tagName;
    let m, html, urls;
    for (const rule of Ruler.rules) {
      if (rule.e && !node.matches(rule.e) || rule === skipRule)
        continue;
      if (rule.html && rule.r && !noHtml && (tn === 'A' || tn === 'IMG' || rule.e))
        m = rule.r.exec(html || (html = node.outerHTML));
      else if (url)
        m = (rule.r || rule.u) ?
          RuleMatcher.makeUrlMatch(url, node, rule) :
          RuleMatcher.makeDummyMatch(url);
      if (!m ||
          // a rule with follow:true for the currently hovered IMG produced a URL,
          // but we'll only allow it to match rules without 's' in the nested find call
          tn === 'IMG' && !('s' in rule) && !skipRule)
        continue;
      urls = 's' in rule ?
        Ruler.runS(node, rule, m) :
        [m.input];
      if (!urls.skipRule) {
        const url = urls[0];
        return !url ? null :
          rule.s && !rule.q && RuleMatcher.isFollowableUrl(url, rule) ?
            RuleMatcher.find(url, node, {skipRule: rule}) :
            RuleMatcher.makeInfo(urls, node, rule, m);
      }
    }
  }

  static makeUrlMatch(url, node, rule) {
    let {r, u} = rule;
    let m;
    if (u) {
      u = rule._u || (rule._u = SimpleUrlMatcher.compile(u));
      m = u.fn.call(u.this, url) && (r || RuleMatcher.makeDummyMatch(url));
    }
    return (m || !u) && r ? r.exec(url) : m;
  }

  static makeDummyMatch(url) {
    const m = [url];
    m.index = 0;
    m.input = url;
    return m;
  }

  /** @returns mpiv.RuleMatchInfo */
  static makeInfo(urls, node, rule, m) {
    const url = urls[0];
    const info = {
      node,
      rule,
      url,
      urls: urls.length > 1 ? urls.slice(1) : null,
      match: m,
      gallery: rule.g && Gallery.makeParser(rule.g),
      post: typeof rule.post === 'function' ? rule.post(m) : rule.post,
      xhr: cfg.xhr && rule.xhr,
    };
    Util.lazyGetRect(info, node, rule.rect);
    if (
      dotDomain.endsWith('.twitter.com') && !/(facebook|google|twimg|twitter)\.com\//.test(url) ||
      dotDomain.endsWith('.github.com') && !/github/.test(url) ||
      dotDomain.endsWith('.facebook.com') && /\bimgur\.com/.test(url)
    ) {
      info.xhr = 'data';
    }
    return info;
  }

  static isFollowableUrl(url, rule) {
    const f = rule.follow;
    return typeof f === 'function' ? f(url) : f;
  }
}

//#endregion
//#region Events

class Events {

  static drop(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  static onMouseOver(e) {
    if (!App.enabled || e.shiftKey || ai.zoom)
      return;
    let node = e.target;
    if (node === ai.popup ||
        node === doc.body ||
        node === doc.documentElement)
      return;

    if (node.shadowRoot)
      node = Events.pierceShadow(node, e.clientX, e.clientY);

    if (!Ruler.rules)
      Ruler.init();

    let a, img, url, info;
    if (node.tagName === 'A') {
      a = node;
    } else {
      if (node.tagName === 'IMG') {
        img = node;
        if (!img.src.startsWith('data:'))
          url = Util.rel2abs(img.src, location.href);
      }
      info = RuleMatcher.find(url, node);
      if (!info)
        a = node.closest('a');
    }

    if (!info && a)
      info = RuleMatcher.findForLink(a);

    if (!info && img) {
      info = Util.lazyGetRect({
        url: img.src,
        node: img,
        rule: {
          distinct: true,
        },
      }, img);
    }

    if (info && info.url && info.node !== ai.node)
      App.activate(info, e);
  }

  static pierceShadow(node, x, y) {
    for (let root; (root = node.shadowRoot);) {
      root.addEventListener('mouseover', Events.onMouseOver, {passive: true});
      root.addEventListener('mouseout', Events.onMouseOutShadow);
      const inner = root.elementFromPoint(x, y);
      if (!inner || inner === node)
        break;
      node = inner;
    }
    return node;
  }

  static onMouseOut(e) {
    if (!e.relatedTarget && !e.shiftKey)
      App.deactivate();
  }

  static onMouseOutShadow(e) {
    const root = e.target.shadowRoot;
    if (root) {
      root.removeEventListener('mouseover', Events.onMouseOver);
      root.removeEventListener('mouseout', Events.onMouseOutShadow);
    }
  }

  static onMouseMove(e) {
    App.updateMouse(e);
    if (e.shiftKey) {
      ai.lazyUnload = true;
      return;
    }
    if (!ai.zoomed && !ai.isOverRect) {
      App.deactivate();
      return;
    }
    if (ai.zoom) {
      Popup.move();
      const {height: h, width: w} = ai.view;
      const {clientX: cx, clientY: cy} = ai;
      const bx = w / 6;
      const by = h / 6;
      const onEdge = cx < bx || cx > w - bx || cy < by || cy > h - by;
      App.setStatus(`${onEdge ? '+' : '-'}edge`);
    }
  }

  static onMouseDown({shiftKey, button}) {
    switch (button) {
      case 0:
        if (shiftKey && ai.popup && ai.popup.controls)
          ai.controlled = ai.zoomed = true;
        break;
      case 2:
        break;
      default:
        if (!shiftKey)
          App.deactivate({wait: true});
    }
  }

  static onMouseScroll(e) {
    const dir = (e.deltaY || -e.wheelDelta) > 0 ? 1 : -1;
    if (ai.zoom) {
      Events.drop(e);
      const i = ai.scales.indexOf(ai.scale) - dir;
      if (i >= 0 && i < ai.scales.length)
        ai.scale = ai.scales[i];
      if (i === 0 && cfg.close) {
        if (!ai.gItems || ai.gItems.length < 2) {
          App.deactivate({wait: true});
          return;
        }
        ai.zoom = false;
        App.updateFileInfo();
      }
      if (ai.zooming)
        ai.popup.classList.add(`${PREFIX}zooming`);
      Popup.move();
      App.updateTitle();
    } else if (ai.gItems && ai.gItems.length > 1 && ai.popup) {
      Events.drop(e);
      Gallery.next(dir);
    } else if (cfg.zoom === 'wheel' && dir < 0 && ai.popup) {
      Events.drop(e);
      App.toggleZoom();
    } else {
      App.deactivate();
    }
  }

  static onKeyDown(e) {
    switch (e.key) {
      case 'Shift':
        App.setStatus('+shift');
        if (ai.popup && 'controls' in ai.popup)
          ai.popup.controls = true;
        break;
      case 'Control':
        if (!ai.popup && (cfg.start !== 'auto' || ai.rule.manual))
          Popup.start();
        break;
    }
  }

  static onKeyUp(e) {
    switch (e.key.length > 1 ? e.key : e.code) {
      case 'Shift':
        App.setStatus('-shift');
        if (ai.popup.controls)
          ai.popup.controls = false;
        if (ai.controlled) {
          ai.controlled = false;
          return;
        }
        ai.popup && (ai.zoomed || ai.isOverRect !== false) ?
          App.toggleZoom() :
          App.deactivate({wait: true});
        break;
      case 'Control':
        break;
      case 'Escape':
        App.deactivate({wait: true});
        break;
      case 'ArrowRight':
      case 'KeyJ':
        Events.drop(e);
        Gallery.next(1);
        break;
      case 'ArrowLeft':
      case 'KeyK':
        Events.drop(e);
        Gallery.next(-1);
        break;
      case 'KeyD': {
        Events.drop(e);
        Remoting.saveFile();
        break;
      }
      case 'KeyT':
        ai.lazyUnload = true;
        GM_openInTab(
          ai.rule.tabfix && ai.popup.tagName === 'IMG' && !ai.xhr &&
          navigator.userAgent.includes('Gecko/') ?
            Util.tabFixUrl() :
            ai.popup.src);
        App.deactivate();
        break;
      default:
        App.deactivate({wait: true});
    }
  }

  static onContext(e) {
    if (e.shiftKey)
      return;
    if (cfg.zoom === 'context' && ai.popup && App.toggleZoom()) {
      Events.drop(e);
      return;
    }
    if (!ai.popup && (
      cfg.start === 'context' ||
      (cfg.start === 'auto' && ai.rule.manual)
    )) {
      Popup.start();
      Events.drop(e);
    } else {
      setTimeout(App.deactivate, 50, {wait: true});
    }
  }

  static onMessage(e) {
    if (typeof e.data !== 'string' ||
        !trusted.includes(e.origin.substr(e.origin.indexOf('//') + 2)) ||
        !e.data.startsWith(`${PREFIX}rule `))
      return;
    if (!doc.getElementById(SETUP_ID))
      setup();
    const el = doc.getElementById(SETUP_ID).shadowRoot.getElementById('hosts').firstElementChild;
    el.value = e.data.substr(10).trim();
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.parentNode.scrollTop = 0;
    el.select();
  }
}

//#endregion
//#region Popup

class Popup {

  static schedule() {
    if (cfg.preload) {
      ai.preloadStart = Date.now();
      Popup.start();
      App.setStatus('+preloading');
      setTimeout(App.setStatus, cfg.delay, '-preloading');
    } else {
      ai.timeout = setTimeout(Popup.start, cfg.delay);
    }
  }

  static start() {
    App.updateStyles();
    App.setStatus('loading');
    ai.gallery ?
      Popup.startGallery() :
      Popup.startSingle();
  }

  static startSingle() {
    App.setStatus('loading');
    ai.imageUrl = null;
    if (ai.rule.follow && !ai.rule.q && !ai.rule.s) {
      Remoting.findRedirect();
    } else if (ai.rule.q && !Array.isArray(ai.urls)) {
      Popup.startFromQ();
    } else {
      App.updateCaption();
      Popup.render(ai.url);
    }
  }

  static async startFromQ() {
    try {
      const {responseText, finalUrl} = await Remoting.fetch(ai.url);
      const doc = Remoting.createDoc(responseText);
      const url = Ruler.runQ(responseText, doc, finalUrl);
      if (!url)
        throw 'File not found.';
      App.updateCaption(responseText, doc);
      if (RuleMatcher.isFollowableUrl(url, ai.rule)) {
        const info = RuleMatcher.find(url, ai.node, {noHtml: true});
        if (!info || !info.url)
          throw `Couldn't follow URL: ${url}`;
        Object.assign(ai, info);
        Popup.startSingle();
      } else {
        Popup.render(url, finalUrl);
      }
    } catch (e) {
      App.handleError(e);
    }
  }

  static async startGallery() {
    try {
      const startUrl = ai.url;
      const p = await Remoting.fetch(startUrl);
      const items = await new Promise(resolve => {
        const it = ai.gallery(p.responseText, p.finalUrl, ai.match, ai.rule, resolve);
        if (Array.isArray(it))
          resolve(it);
      });
      // bail out if the gallery's async callback took too long
      if (ai.url !== startUrl)
        return;
      ai.gItems = items.length && items;
      if (ai.gItems) {
        ai.gIndex = Gallery.findIndex(ai.url);
        setTimeout(Gallery.next);
      } else {
        throw 'Empty gallery';
      }
    } catch (e) {
      App.handleError(e);
    }
  }

  static async render(src, pageUrl = ai.url) {
    Popup.destroy();
    ai.imageUrl = src;
    if (ai.xhr && src)
      src = await Remoting.getImage(src, pageUrl).catch(App.handleError);
    if (!src)
      return;
    const p = ai.popup =
      src.startsWith('data:video') ||
      !src.startsWith('data:') && /\.(webm|mp4)($|\?)/.test(src) ?
        PopupVideo.create() :
        doc.createElement('img');
    p.id = `${PREFIX}popup`;
    p.src = src;
    p.addEventListener('error', App.handleError);
    p.addEventListener('load', Popup.onLoad, {once: true});
    if (ai.zooming)
      p.addEventListener('transitionend', Popup.onZoom);
    doc.body.insertBefore(p, ai.bar || undefined);
    App.checkProgress(true);
  }

  static onLoad() {
    ai.popupLoaded = true;
  }

  static onZoom(e) {
    return this.classList.remove(`${PREFIX}zooming`);
  }

  static move() {
    const p = ai.popup;
    if (!p)
      return;
    let x, y;
    const w = Math.round(ai.scale * ai.nwidth);
    const h = Math.round(ai.scale * ai.nheight);
    const cx = ai.clientX;
    const cy = ai.clientY;
    const vw = ai.view.width - ai.outline * 2;
    const vh = ai.view.height - ai.outline * 2;
    if (!ai.zoom && (!ai.gItems || ai.gItems.length < 2) && !cfg.center) {
      const r = ai.rect;
      const rx = (r.left + r.right) / 2;
      const ry = (r.top + r.bottom) / 2;
      if (vw - r.right - 40 > w + ai.mbw || w + ai.mbw < r.left - 40) {
        if (h + ai.mbh < vh - 60)
          y = clamp(ry - h / 2, 30, vh - h - 30);
        x = rx > vw / 2 ? r.left - 40 - w : r.right + 40;
      } else if (vh - r.bottom - 40 > h + ai.mbh || h + ai.mbh < r.top - 40) {
        if (w + ai.mbw < vw - 60)
          x = clamp(rx - w / 2, 30, vw - w - 30);
        y = ry > vh / 2 ? r.top - 40 - h : r.bottom + 40;
      }
    }
    if (x === undefined) {
      const mid = vw > w ?
        vw / 2 - w / 2 :
        -1 * clamp(5 / 3 * (cx / vw - 0.2), 0, 1) * (w - vw);
      x = Math.round(mid - (ai.pw + ai.mbw) / 2);
    }
    if (y === undefined) {
      const mid = vh > h ?
        vh / 2 - h / 2 :
        -1 * clamp(5 / 3 * (cy / vh - 0.2), 0, 1) * (h - vh);
      y = Math.round(mid - (ai.ph + ai.mbh) / 2);
    }
    p.style.cssText = `
      width: ${w}px !important;
      height: ${h}px !important;
      left: ${x + ai.outline}px !important;
      top: ${y + ai.outline}px !important;
    `;
  }

  static destroy() {
    const p = ai.popup;
    if (!p)
      return;
    ai.zoom = false;
    p.removeEventListener('error', App.handleError);
    if (typeof p.pause === 'function')
      p.pause();
    if (!ai.lazyUnload) {
      if (p.src.startsWith('blob:'))
        URL.revokeObjectURL(p.src);
      p.src = '';
    }
    p && p.remove();
    ai.popup = null;
  }
}

//#endregion
//#region PopupVideo

class PopupVideo {
  static create() {
    const p = doc.createElement('video');
    p.autoplay = true;
    p.loop = true;
    p.volume = 0.5;
    p.controls = false;
    p.addEventListener('progress', PopupVideo.progress);
    p.addEventListener('canplaythrough', PopupVideo.progressDone, {once: true});
    ai.bufferingBar = false;
    ai.bufferingStart = Date.now();
    return p;
  }

  static progress() {
    const {duration} = this;
    if (duration && this.buffered.length && Date.now() - ai.bufferingStart > 2000) {
      const pct = Math.round(this.buffered.end(0) / duration * 100);
      if ((ai.bufferingBar |= pct > 0 && pct < 50))
        App.setBar(`${pct}% of ${Math.round(duration)}s`, 'xhr');
    }
  }

  static progressDone() {
    this.removeEventListener('progress', PopupVideo.progress);
    if (ai.bar && ai.bar.classList.contains(`${PREFIX}xhr`)) {
      App.setBar(false);
      App.updateFileInfo();
    }
  }
}

//#endregion
//#region Gallery

class Gallery {

  static makeParser(g) {
    return (
      typeof g === 'function' ? g :
        typeof g === 'string' ? new Function('text', 'url', 'm', 'rule', 'cb', g) :
          Gallery.defaultParser
    );
  }

  static findIndex(gUrl) {
    const sel = gUrl.split('#')[1];
    if (!sel)
      return 0;
    if (/^\d+$/.test(sel))
      return parseInt(sel);
    for (let i = ai.gItems.length; i--;) {
      let {url} = ai.gItems[i];
      if (Array.isArray(url))
        url = url[0];
      if (url.indexOf(sel, url.lastIndexOf('/')) > 0)
        return i;
    }
    return 0;
  }

  static next(dir) {
    if (dir > 0 && (ai.gIndex += dir) >= ai.gItems.length) {
      ai.gIndex = 0;
    } else if (dir < 0 && (ai.gIndex += dir) < 0) {
      ai.gIndex = ai.gItems.length - 1;
    }
    const item = ai.gItems[ai.gIndex];
    if (Array.isArray(item.url)) {
      ai.urls = item.url.slice(1);
      ai.url = item.url[0];
    } else {
      delete ai.urls;
      ai.url = item.url;
    }
    Popup.destroy();
    Popup.startSingle();
    App.updateFileInfo();
    Gallery.preload(dir);
  }

  static preload(dir) {
    const i = ai.gIndex + dir;
    if (ai.popup && i >= 0 && i < ai.gItems.length) {
      ai.preloadUrl = ensureArray(ai.gItems[i].url)[0];
      ai.popup.addEventListener('load', Gallery.preloadOnLoad, {once: true});
    }
  }

  static preloadOnLoad() {
    doc.createElement('img').src = ai.preloadUrl;
  }

  static defaultParser(text, docUrl, m, rule) {
    const {g} = rule;
    const qEntry = g.entry;
    const qCaption = ensureArray(g.caption);
    const qImage = g.image;
    const qTitle = g.title;
    const fix =
      (typeof g.fix === 'string' ? new Function('s', 'isURL', g.fix) : g.fix) ||
      (s => s.trim());
    const doc = Remoting.createDoc(text);
    const items = [...qsa(qEntry || qImage, doc)]
      .map(processEntry)
      .filter(Boolean);
    items.title = processTitle();
    return items;

    function processEntry(entry) {
      const item = {};
      try {
        const img = qEntry ? qs(qImage, entry) : entry;
        item.url = fix(Remoting.findFileUrl(img, docUrl), true);
        item.desc = qCaption.map(processCaption, entry).filter(Boolean).join(' - ');
      } catch (e) {}
      return item.url && item;
    }

    function processCaption(selector) {
      const el = qs(selector, this) ||
                 qsSibling(selector, this.previousElementSibling) ||
                 qsSibling(selector, this.nextElementSibling);
      return el && fix(el.textContent);
    }

    function processTitle() {
      const el = qs(qTitle, doc);
      return el && fix(el.getAttribute('content') || el.textContent) || '';
    }

    function qsSibling(selector, el) {
      if (el && !el.matches(qEntry))
        return el.matches(selector) ? el : qs(selector, el);
    }
  }
}

//#endregion
//#region Remoting

class Remoting {

  static gmXhr(opts) {
    if (ai.req)
      tryCatch.call(ai.req, ai.req.abort);
    return new Promise((resolve, reject) => {
      const url = opts.url;
      if (!opts.method)
        opts.method = 'GET';
      opts.onload = opts.onerror = e => {
        ai.req = null;
        e.status < 400 && !e.error ?
          resolve(e) :
          reject(`Server error ${e.status} ${e.error}\nURL: ${url}`);
      };
      opts.timeout = opts.timeout || 10e3;
      opts.ontimeout = e => {
        ai.req = null;
        reject(`Timeout fetching ${url}`);
      };
      ai.req = GM_xmlhttpRequest(opts);
    });
  }

  static fetch(url) {
    return !ai.post ?
      Remoting.gmXhr({url}) :
      Remoting.gmXhr({
        url,
        method: 'POST',
        data: ai.post,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': url,
        },
      });
  }

  static async getImage(url, pageUrl) {
    let bar;
    const start = Date.now();
    const response = await Remoting.gmXhr({
      url,
      responseType: 'blob',
      headers: {
        'Accept': 'image/png,image/*;q=0.8,*/*;q=0.5',
        'Referer': pageUrl,
      },
      onprogress(e) {
        if (!bar && Date.now() - start > 3000 && e.loaded / e.total < 0.5)
          bar = true;
        if (bar) {
          const pct = (e.loaded / e.total * 100).toFixed();
          const mb = (e.total / 1024).toFixed();
          App.setBar(`${pct}% of ${mb} kiB`, 'xhr');
        }
      },
    });
    App.setBar(false);
    const type = Remoting.guessMimeType(response);
    let b = response.response;
    if (b.type !== type)
      b = b.slice(0, b.size, type);
    return ai.xhr === 'data' ?
      Remoting.blobToDataUrl(b) :
      URL.createObjectURL(b);
  }

  static async findRedirect() {
    try {
      const {finalUrl} = await Remoting.gmXhr({
        url: ai.url,
        method: 'HEAD',
        headers: {
          'Referer': location.href.split('#', 1)[0],
        },
      });
      const info = RuleMatcher.find(finalUrl, ai.node, {noHtml: true});
      if (!info || !info.url)
        throw `Couldn't follow redirection target: ${finalUrl}`;
      Object.assign(ai, info);
      Popup.startSingle();
    } catch (e) {
      App.handleError(e);
    }
  }

  static async saveFile() {
    let url = ai.popup.src || ai.popup.currentSrc;
    let name = (ai.imageUrl || url).split('/').pop().replace(/[:#?].*/, '');
    if (!name.includes('.'))
      name += '.jpg';
    try {
      if (!url.startsWith('blob:') && !url.startsWith('data:')) {
        const {response} = await Remoting.gmXhr({
          url,
          responseType: 'blob',
          headers: {'Referer': url},
        });
        url = URL.createObjectURL(response);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      const a = doc.createElement('a');
      a.href = url;
      a.download = name;
      a.dispatchEvent(new MouseEvent('click'));
    } catch (e) {
      App.setBar(`Could not download ${name}.`, 'error');
    }
  }

  static blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  static guessMimeType({responseHeaders, finalUrl}) {
    if (/Content-Type:\s*(\S+)/i.test(responseHeaders) &&
        !RegExp.$1.includes('text/plain'))
      return RegExp.$1;
    const ext = /\.([a-z0-9]+?)($|\?|#)/i.exec(finalUrl) ? RegExp.$1 : 'jpg';
    switch (ext.toLowerCase()) {
      case 'bmp': return 'image/bmp';
      case 'gif': return 'image/gif';
      case 'jpeg': return 'image/jpeg';
      case 'mp4': return 'video/mp4';
      case 'png': return 'image/png';
      case 'tiff': return 'image/tiff';
      case 'webm': return 'video/webm';
      case 'jpe': return 'image/jpeg';
      case 'jpg': return 'image/jpeg';
      case 'svg': return 'image/svg+xml';
      case 'tif': return 'image/tiff';
      default: return 'application/octet-stream';
    }
  }

  static findFileUrl(n, url) {
    const base = qs('base[href]', n.ownerDocument);
    const path =
      n.getAttribute('src') ||
      n.getAttribute('data-m4v') ||
      n.getAttribute('href') ||
      n.getAttribute('content') ||
      /https?:\/\/[./a-z0-9_+%-]+\.(jpe?g|gif|png|svg|webm|mp4)/i.exec(n.outerHTML) &&
        RegExp.lastMatch;
    return path ? Util.rel2abs(path.trim(), base ? base.getAttribute('href') : url) : false;
  }

  static createDoc(text) {
    return new DOMParser().parseFromString(text, 'text/html');
  }
}

//#endregion
//#region Util

class Util {

  static addStyle(name, css) {
    const id = `${PREFIX}style:${name}`;
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

  static findScale(url, parent) {
    const imgs = qsa('img, video', parent);
    for (let i = imgs.length, img; (img = imgs[--i]);) {
      if ((img.src || img.currentSrc) !== url)
        continue;
      const scaleX = (img.naturalWidth || img.videoWidth) / img.offsetWidth;
      const scaleY = (img.naturalHeight || img.videoHeight) / img.offsetHeight;
      const s = Math.max(scaleX, scaleY);
      if (isFinite(s))
        return s;
    }
  }

  static forceLayout(node) {
    // eslint-disable-next-line no-unused-expressions
    node.clientHeight;
  }

  static formatError(e, rule) {
    let {message} = e;
    if (!message) {
      if (e.readyState)
        message = 'Request failed.';
      else if (e.type === 'error')
        message = "File can't be displayed." + (
          qs('div[bgactive*="flashblock"]', doc) ?
            ' Check Flashblock settings.' :
            '');
      else
        message = e;
    }
    const m = [
      [`${GM_info.script.name}: %c${message}%c`, 'font-weight:bold;color:yellow'],
      ['', 'font-weight:normal;color:unset'],
    ];
    if (rule.u)
      m.push(['Url simple match: %o', rule.u]);
    if (rule.r)
      m.push(['RegExp match: %o', rule.r]);
    if (ai.url)
      m.push(['URL: %s', ai.url]);
    if (ai.imageUrl && ai.imageUrl !== ai.url)
      m.push(['File: %s', ai.imageUrl]);
    m.push(['Node: %o', ai.node]);
    return {
      message,
      consoleFormat: m.map(([k]) => k).filter(Boolean).join('\n'),
      consoleArgs: m.map(([, v]) => v),
    };
  }

  static lazyGetRect(obj, node, selector) {
    return Object.defineProperty(obj, 'rect', {
      configurable: true,
      get() {
        const value = Util.rect(node, selector);
        Object.defineProperty(obj, 'rect', {value, configurable: true});
        return value;
      },
    });
  }

  static rect(node, selector) {
    let n;
    if (selector && (n = node.closest(selector))) {
      node = n;
    } else {
      let maxHeight = node.offsetHeight;
      const walker = doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
      while ((n = walker.nextNode())) {
        const height = n.offsetHeight;
        if (height > maxHeight) {
          maxHeight = height;
          node = n;
        }
      }
    }
    return node.getBoundingClientRect();
  }

  static rel2abs(rel, abs) {
    if (rel.startsWith('data:'))
      return rel;
    const rx = /^([a-z]+:)\/\//;
    if (rx.test(rel))
      return rel;
    if (!rx.test(abs))
      return;
    if (rel.indexOf('//') === 0)
      return RegExp.$1 + rel;
    if (rel[0] === '/')
      return abs.substr(0, abs.indexOf('/', RegExp.lastMatch.length)) + rel;
    return abs.substr(0, abs.lastIndexOf('/')) + '/' + rel;
  }

  static suppressHoverTooltip() {
    for (const n of [
      ai.node.parentNode,
      ai.node,
      ai.node.firstElementChild,
    ]) {
      if (n &&
          n.title &&
          n.title !== n.textContent &&
          !doc.title.includes(n.title) &&
          !/^http\S+$/.test(n.title)) {
        ai.tooltip = {
          node: n,
          text: n.title,
        };
        n.title = '';
        break;
      }
    }
  }

  static tabFixUrl() {
    return `data:text/html;charset=utf8,
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
        <img onclick="document.body.classList.toggle('fit')" src="${ai.popup.src}">
      </body>
    `.replace(/[\r\n]+\s*/g, '').replace(/#/g, '%23');
  }
}

//#endregion
//#region Global util

function qs(s, n = doc) {
  return n.querySelector(s);
}

function qsa(s, n = doc) {
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

//#endregion
//#region Setup

function setup() {
  const MPIV_BASE_URL = 'https://w9p.co/userscripts/mpiv/';
  let div, root;
  /** @type NodeList */
  const $ = new Proxy({}, {
    get(_, id) {
      return root.getElementById(id);
    },
  });
  init(new Config({save: true}));

  function closeSetup() {
    const el = doc.getElementById(SETUP_ID);
    el && el.remove();
    if (!trusted.includes(hostname))
      window.removeEventListener('message', Events.onMessage);
  }

  function updateActivationControls() {
    $.delay.parentNode.hidden =
      $.preload.parentNode.hidden =
        !$.start_auto.selected;
  }

  function checkRule({target: el}) {
    let json, error;
    if (el.value) {
      json = Ruler.parse(el.value);
      error = json instanceof Error && (json.message || String(json));
      if (!el.previousElementSibling)
        el.insertAdjacentElement('beforebegin', Object.assign(el.cloneNode(), {value: ''}));
    } else if (el.previousElementSibling) {
      el.previousElementSibling.focus();
      el && el.remove();
    }
    el.__json = !error && json;
    el.title = error || '';
    el.setCustomValidity(error || '');
  }

  function installRule(e) {
    Events.drop(e);
    const parent = e.target.parentNode;
    parent.textContent = 'Loading...';
    parent.appendChild(Object.assign(doc.createElement('iframe'), {
      src: MPIV_BASE_URL + 'more_host_rules.html',
      hidden: true,
      style: `
        width: 100%;
        height: 26px;
        border: 0;
        margin: 0;
      `,
      onload() {
        this.hidden = false;
        this.previousSibling.remove();
      },
    }));
  }

  function exportSettings(e) {
    Events.drop(e);
    const txt = document.createElement('textarea');
    txt.style = 'opacity:0; position:absolute';
    txt.value = JSON.stringify(collectConfig(), null, '  ');
    root.appendChild(txt);
    txt.select();
    txt.focus();
    document.execCommand('copy');
    e.target.focus();
    txt.remove();
    $.exportNotification.hidden = false;
    setTimeout(() => ($.exportNotification.hidden = true), 1000);
  }

  function importSettings(e) {
    Events.drop(e);
    const s = prompt('Paste settings:');
    if (s)
      init(new Config({data: s}));
  }

  function collectConfig({save} = {}) {
    const data = {};
    const delay = parseInt($.delay.value);
    const scale = parseFloat($.scale.value.replace(',', '.'));
    data.center = $.center.checked;
    data.css = $.css.value.trim();
    data.close = $.close.selected;
    data.delay = !isNaN(delay) && delay >= 0 ? delay : undefined;
    data.exposeStatus = $.exposeStatus.checked;
    data.hosts = [...$.hosts.children]
      .map(el => [el.value.trim(), el.__json])
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      .map(([s, json]) => json || s)
      .filter(Boolean);
    data.imgtab = $.imgtab.checked;
    data.preload = $.preload.checked;
    data.scale = !isNaN(scale) ? Math.max(1, scale) : undefined;
    data.scales = $.scales.value
      .trim()
      .split(/[,;]*\s+/)
      .map(x => x.replace(',', '.'))
      .filter(x => !isNaN(parseFloat(x)));
    data.start =
      $.start_context.selected ? 'context' :
        $.start_ctrl.selected ? 'ctrl' :
          'auto';
    data.xhr = $.xhr.checked;
    data.zoom =
      $.zoom_context.selected ? 'context' :
        $.zoom_wheel.selected ? 'wheel' :
          $.zoom_shift.selected ? 'shift' :
            'auto';
    return new Config({data, save});
  }

  function formatRuleCollapse(rule) {
    return JSON.stringify(rule, null, ' ')
      .replace(/\n\s*/g, ' ')
      .replace(/^({)\s|\s(})$/g, '$1$2');
  }

  function formatRuleExpand(rule) {
    return JSON.stringify(rule, null, ' ')
      .replace(/^{\s+/g, '{');
  }

  function init(config) {
    closeSetup();
    if (!trusted.includes(hostname))
      window.addEventListener('message', Events.onMessage);
    div = doc.createElement('div');
    div.id = SETUP_ID;
    // prevent the main page from interpreting key presses in inputs as hotkeys
    // which may happen since it sees only the outer <div> in the event |target|
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
        select, #css {
          border: 1px solid gray;
          padding: 2px;
        }
        input {
          vertical-align: middle;
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
        #importExport {
          float: right;
        }
        #exportNotification {
          color: green;
          position: absolute;
        }
        button {
          width: 150px;
          margin: 0 10px;
        }
        textarea:invalid {
          background-color: #f002;
          border-color: #800;
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
          <a href="${MPIV_BASE_URL}">${GM_info.script.name}</a>
          <div id="importExport">
            <a href="#" id="import">Import</a> |
            <a href="#" id="export">Export</a>
            <p id="exportNotification" hidden>Copied to clipboard.</p>
          </div>
        </div>
        <ul>
          <li>
            <label>
              Popup:
              <select>
                <option id="start_auto">automatically
                <option id="start_context">right click or ctrl
                <option id="start_ctrl">ctrl
              </select>
            </label>
            <label>after <input id="delay"> ms</label>
            <label><input type="checkbox" id="preload"> Start preloading immediately</label>
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
            <label><input type="checkbox" id="xhr"> Anti-hotlinking workaround</label>
          </li>
          <li>
            <label><input type="checkbox" id="exposeStatus">
              expose status on &lt;html&gt; node</label>
            <small>(Don't enable unless you know what it is
             since it may slow down sites noticeably)</small>
          </li>
          <li>
            <label>
              Zoom:
              <select id="zoom">
                <option id="zoom_context">right click or shift
                <option id="zoom_wheel">wheel up or shift
                <option id="zoom_shift">shift
                <option id="zoom_auto">automatically
              </select>
            </label>
            <label>Custom scale factors: <input id="scales" placeholder="e.g. 0 0.5 1* 2"></label>
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
            <a href="${MPIV_BASE_URL}css.html" target="_blank">Custom CSS:</a>
            <div><textarea id="css" spellcheck="false"></textarea></div>
          </li>
          <li style="overflow-y:auto">
            <a href="${MPIV_BASE_URL}host_rules.html"
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
    if (config.hosts) {
      const parent = $.hosts;
      const template = parent.firstElementChild;
      for (const rule of config.hosts) {
        const el = template.cloneNode();
        el.value = typeof rule === 'string' ? rule : formatRuleCollapse(rule);
        parent.appendChild(el);
        checkRule({target: el});
      }
      parent.addEventListener('focusin', ({target: el, relatedTarget: from}) => {
        if (el === parent)
          return;
        if (el.__json)
          el.value = formatRuleExpand(el.__json);
        const h = clamp(el.scrollHeight, 15, div.clientHeight / 4);
        if (h > el.offsetHeight)
          el.style.height = h + 'px';
        if (!parent.contains(from))
          from = [...qsa('[style*="height"]', parent)].find(_ => _ !== el);
        if (from) {
          from.style.height = '';
          if (from.__json)
            from.value = formatRuleCollapse(from.__json);
        }
      });
      const se = $.search;
      const doSearch = () => {
        const s = se.value.toLowerCase();
        setup.search = s;
        for (const el of $.hosts.children)
          el.hidden = s && !el.value.toLowerCase().includes(s);
      };
      let timer;
      se.addEventListener('input', e => {
        clearTimeout(timer);
        setTimeout(doSearch, 200);
      });
      se.value = setup.search || '';
      if (se.value)
        doSearch();
    }
    // prevent the main page from interpreting key presses in inputs as hotkeys
    // which may happen since it sees only the outer <div> in the event |target|
    root.addEventListener('keydown', e =>
      !e.altKey && !e.ctrlKey && !e.metaKey && e.stopPropagation(), true);
    $.start_auto.parentNode.addEventListener('change', updateActivationControls);
    $.cancel.addEventListener('click', closeSetup);
    $.export.addEventListener('click', exportSettings);
    $.import.addEventListener('click', importSettings);
    $.hosts.addEventListener('input', checkRule);
    $.install.addEventListener('click', installRule);
    $.ok.addEventListener('click', () => {
      cfg = collectConfig({save: true});
      Ruler.init();
      closeSetup();
    });
    $.delay.value = config.delay;
    $.scale.value = config.scale;
    $.center.checked = config.center;
    $.imgtab.checked = config.imgtab;
    $.exposeStatus.checked = config.exposeStatus;
    $.close.selected = config.close;
    $.preload.checked = config.preload;
    $.css.value = config.css;
    $.scales.value = config.scales.join(' ');
    $.xhr.checked = config.xhr;
    $.xhr.onclick = function () {
      if (!this.checked)
        return confirm('Do not disable this unless you spoof the HTTP headers yourself.');
    };
    $[`zoom_${config.zoom}`].selected = true;
    $[`start_${config.start}`].selected = true;
    updateActivationControls();
    doc.body.appendChild(div);
    requestAnimationFrame(() => {
      $.css.style.height = clamp($.css.scrollHeight, 40, div.clientHeight / 4) + 'px';
    });
  }
}

//#endregion
//#region Init

cfg = new Config({save: true});
App.enabled = cfg.imgtab || !isImageTab;
GM_registerMenuCommand('Configure', setup);
doc.addEventListener('mouseover', Events.onMouseOver, {passive: true});

if (isGoogleDomain)
  if (doc.getElementById('main'))
    doc.getElementById('main').addEventListener('mouseover', Events.onMouseOver, {passive: true});

if (trusted.includes(hostname)) {
  window.addEventListener('message', Events.onMessage);
  doc.addEventListener('click', e => {
    const t = e.target;
    if (e.which !== 1 ||
        !/BLOCKQUOTE|CODE|PRE/.test(t.tagName + t.parentNode.tagName) ||
        !/^\s*{\s*".+:.+}\s*$/.test(t.textContent)) {
      return;
    }
    postMessage(`${PREFIX}rule ${t.textContent}`, '*');
    e.preventDefault();
  });
}

//#endregion
