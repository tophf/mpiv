// ==UserScript==
// @name        Mouseover Popup Image Viewer
// @namespace   https://github.com/tophf
// @description Shows images and videos behind links and thumbnails.

// @include     http*
// @connect     *

// allow rule installer in config dialog https://w9p.co/userscripts/mpiv/more_host_rules.html
// @connect     w9p.co

// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_openInTab
// @grant       GM_registerMenuCommand

// @version     1.0.18
// @author      tophf

// @original-version 2017.9.29
// @original-author  kuehlschrank

// @supportURL  https://github.com/tophf/mpiv/issues
// @homepage    https://w9p.co/userscripts/mpiv/
// @icon        https://w9p.co/userscripts/mpiv/icon.png
// ==/UserScript==

'use strict';

const doc = document;
const hostname = location.hostname;
const dotDomain = '.' + hostname;
const installableSites = ['greasyfork.org', 'w9p.co', 'github.com'];
const isGoogleDomain = /(^|\.)google(\.com?)?(\.\w+)?$/.test(hostname);
const isGoogleImages = isGoogleDomain && /[&?]tbm=isch(&|$)/.test(location.search);

const POSTMSG_PREFIX = GM_info.script.name + ':';
const PREFIX = 'mpiv-';
const STATUS_ATTR = `${PREFIX}status`;
const WHEEL_EVENT = 'onwheel' in doc ? 'wheel' : 'mousewheel';
const PASSIVE = {passive: true};
// time for volatile things to settle down meanwhile we postpone action
// examples: loading image from cache, quickly moving mouse over one element to another
const SETTLE_TIME = 50;
// used to detect JS code in host rules
const RX_HAS_CODE = /(^|[^-\w])return[\W\s]/;

/** @type mpiv.Config */
let cfg;
/** @type mpiv.AppInfo */
let ai = {rule: {}};

const clamp = (v, min, max) => v < min ? min : v > max ? max : v;
const ensureArray = v => Array.isArray(v) ? v : [v];
const safeIncludes = (a, b) => typeof a === 'string' && a.includes(b);
const sumProps = (...props) => props.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
const tryCatch = function (fn, ...args) {
  try {
    return fn.apply(this, args);
  } catch (e) {}
};
const $ = (s, n = doc) => n.querySelector(s) || 0;
const $$ = (s, n = doc) => n.querySelectorAll(s);
const $create = (tag, props) => Object.assign(document.createElement(tag), props);
const $many = (q, doc) => q && ensureArray(q).reduce((el, sel) => el || $(sel, doc), null);
const $prop = (s, prop, n = doc) => (n.querySelector(s) || 0)[prop] || '';
const $propUp = (n, prop) => (n = n.closest(`[${prop}]`)) &&
                             (prop.startsWith('data-') ? n.getAttribute(prop) : n[prop]) || '';
const dropEvent = e => (e.preventDefault(), e.stopPropagation());

class App {

  static init() {
    cfg = new Config({save: true});
    App.isImageTab = doc.images.length === 1 &&
                     doc.images[0].parentNode === doc.body &&
                     !doc.links.length;
    App.enabled = cfg.imgtab || !App.isImageTab;

    GM_registerMenuCommand('MPIV: configure', setup);
    doc.addEventListener('mouseover', Events.onMouseOver, PASSIVE);

    if (isGoogleDomain && doc.getElementById('main'))
      doc.getElementById('main').addEventListener('mouseover', Events.onMouseOver, PASSIVE);

    if (installableSites.includes(hostname)) {
      doc.addEventListener('click', e => {
        if (hostname === 'github.com' && !location.pathname.startsWith('/tophf/mpiv/')) return;
        const el = e.target.closest('blockquote, code, pre');
        const text = el && el.textContent.trim();
        let rule;
        if (text && e.button === 0 &&
            /^\s*{\s*"\w+"\s*:[\s\S]+}\s*$/.test(text) &&
            (rule = tryCatch(JSON.parse, text))) {
          setup({rule});
          dropEvent(e);
        }
      });
    }

    window.addEventListener('message', App.onMessageParent);
  }

  /** @param {MessageEvent} e */
  static onMessageParent(e) {
    if (typeof e.data === 'string' && e.data.startsWith(POSTMSG_PREFIX)) {
      for (const el of $$('iframe, frame')) {
        if (el.contentWindow === e.source) {
          const r = el.getBoundingClientRect();
          const w = clamp(r.width, 0, innerWidth - r.left);
          const h = clamp(r.height, 0, innerHeight - r.top);
          e.source.postMessage(`${POSTMSG_PREFIX}${w}:${h}`, '*');
        }
      }
    }
  }

  /** @param {MessageEvent} e */
  static onMessageChild(e) {
    if (e.source === parent && typeof e.data === 'string' && e.data.startsWith(POSTMSG_PREFIX)) {
      const [width, height] = e.data.slice(POSTMSG_PREFIX.length).split(':').map(parseFloat);
      if (width && height) {
        ai.view = {width, height};
        window.removeEventListener('message', App.onMessageChild);
      }
    }
  }

  static activate(info, event) {
    const force = event.ctrlKey;
    if (!force) {
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
    if (window !== top) {
      window.addEventListener('message', App.onMessageChild);
      parent.postMessage(POSTMSG_PREFIX + 'getDimensions', '*');
    }
    ai.zooming = cfg.css.includes(`${PREFIX}zooming`);
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

  static checkProgress({start} = {}) {
    const p = ai.popup;
    if (p) {
      ai.nheight = p.naturalHeight || p.videoHeight || ai.popupLoaded && 800;
      ai.nwidth = p.naturalWidth || p.videoWidth || ai.popupLoaded && 1200;
      if (ai.nheight)
        return App.updateProgress();
    }
    if (start)
      ai.timerProgress = setInterval(App.checkProgress, 150);
  }

  static deactivate({wait} = {}) {
    App.stopTimers();
    if (ai.req)
      tryCatch.call(ai.req, ai.req.abort);
    if (ai.tooltip)
      ai.tooltip.node.title = ai.tooltip.text;
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
    if (!rule || !ai.urls || !ai.urls.length)
      console.warn(fe.consoleFormat, ...fe.consoleArgs);
    if (cfg.xhr && !ai.xhr && isGoogleImages) {
      ai.xhr = true;
      Popup.startSingle();
    } else if (ai.urls && ai.urls.length) {
      ai.url = ai.urls.shift();
      if (ai.url) {
        App.stopTimers();
        Popup.startSingle();
      } else {
        App.deactivate();
      }
    } else if (ai.node) {
      App.setStatus('error');
      App.setBar(fe.message, 'error');
    }
  }

  static setBar(label, className) {
    let b = ai.bar;
    if (typeof label !== 'string') {
      b && b.remove();
      ai.bar = null;
      return;
    }
    if (!b)
      b = ai.bar = $create('div', {id: `${PREFIX}bar`});
    App.updateStyles();
    App.updateTitle();
    App.updateBar();
    b.innerHTML = label;
    if (!b.parentNode) {
      doc.body.appendChild(b);
      Util.forceLayout(b);
    }
    b.className = `${PREFIX}show ${PREFIX}${className}`;
  }

  static setListeners(enable = true) {
    const onOff = enable ? doc.addEventListener : doc.removeEventListener;
    const passive = enable ? PASSIVE : undefined;
    onOff.call(doc, 'mousemove', Events.onMouseMove, passive);
    onOff.call(doc, 'mouseout', Events.onMouseOut, passive);
    onOff.call(doc, 'mousedown', Events.onMouseDown, passive);
    onOff.call(doc, 'contextmenu', Events.onContext);
    onOff.call(doc, 'keydown', Events.onKeyDown);
    onOff.call(doc, 'keyup', Events.onKeyUp);
    onOff.call(doc, WHEEL_EVENT, Events.onMouseScroll, enable ? {passive: false} : undefined);
  }

  static setStatus(status) {
    if (!status && !cfg.globalStatus)
      return ai.node && ai.node.removeAttribute(STATUS_ATTR);
    const prefix = cfg.globalStatus ? PREFIX : '';
    const action = status && /^[+-]/.test(status) && status[0];
    const name = status && `${prefix}${action ? status.slice(1) : status}`;
    const el = cfg.globalStatus ? doc.documentElement :
      name === 'edge' ? ai.popup :
        ai.node;
    if (!el)
      return;
    const attr = cfg.globalStatus ? 'class' : STATUS_ATTR;
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

  static setStatusLoading(force) {
    if (!force) {
      clearTimeout(ai.timerStatus);
      ai.timerStatus = setTimeout(App.setStatusLoading, SETTLE_TIME, true);
    } else if (!ai.popupLoaded) {
      App.setStatus('+loading');
    }
  }

  static stopTimers() {
    clearTimeout(ai.timer);
    clearTimeout(ai.timerStatus);
    clearInterval(ai.timerProgress);
  }

  static toggleZoom() {
    const p = ai.popup;
    if (!p || !ai.scales || ai.scales.length < 2)
      return;
    ai.zoom = !ai.zoom;
    ai.zoomed = true;
    const z = ai.scales.indexOf(ai.scale0);
    ai.scale = ai.scales[ai.zoom ? (z > 0 ? z : 1) : 0];
    if (ai.zooming)
      p.classList.add(`${PREFIX}zooming`);
    Popup.move();
    App.updateTitle();
    App.setStatus(ai.zoom ? 'zoom' : false);
    if (!ai.zoom)
      App.updateFileInfo();
    return ai.zoom;
  }

  static updateBar() {
    if (ai.timerBar)
      return;
    clearTimeout(ai.timerBar);
    ai.bar.style.removeProperty('opacity');
    ai.timerBar = setTimeout(() => {
      ai.timerBar = 0;
      if (ai.bar)
        ai.bar.style.setProperty('opacity', 0);
    }, 3000);
  }

  static updateCaption(text, doc = document) {
    switch (typeof ai.rule.c) {
      case 'function':
        // not specifying as a parameter's default value to get the html only when needed
        if (text === undefined)
          text = doc.documentElement.outerHTML;
        ai.caption = ai.rule.c(text, doc, ai.node, ai.rule);
        break;
      case 'string': {
        const el = $many(ai.rule.c, doc);
        ai.caption = !el ? '' :
          el.getAttribute('content') ||
          el.getAttribute('title') ||
          el.textContent;
        break;
      }
      default:
        ai.caption = (ai.tooltip || 0).text || ai.node.alt || $propUp(ai.node, 'title') ||
                     Remoting.getFileName(ai.node.src || $propUp(ai.node, 'href'));
    }
  }

  static updateFileInfo() {
    const gi = ai.gItems;
    if (gi) {
      const item = gi[ai.gIndex];
      let c = gi.length > 1 ? '[' + (ai.gIndex + 1) + '/' + gi.length + '] ' : '';
      if (ai.gIndex === 0 && gi.title && (!item.desc || !safeIncludes(item.desc, gi.title)))
        c += gi.title + (item.desc ? ' - ' : '');
      if (item.desc)
        c += item.desc;
      App.setBar(c.trim() || ' ', 'gallery', true);
    } else if ('caption' in ai) {
      App.setBar(ai.caption, 'caption');
    } else if (ai.tooltip) {
      App.setBar(ai.tooltip.text, 'tooltip');
    } else {
      App.setBar(' ', 'info');
    }
  }

  static updateMouse(e) {
    const cx = ai.clientX = e.clientX;
    const cy = ai.clientY = e.clientY;
    const r = ai.rect;
    if (r)
      ai.isOverRect =
        cx > r.left - 2 && cx < r.right + 2 &&
        cy > r.top - 2 && cy < r.bottom + 2;
  }

  static updateProgress() {
    App.stopTimers();
    let wait;
    if (ai.preloadStart && (wait = ai.preloadStart + cfg.delay - Date.now()) > 0)
      return (ai.timer = setTimeout(App.checkProgress, wait));
    if ((ai.urls || 0).length && Math.max(ai.nheight, ai.nwidth) < 130) {
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
    if (cfg.imgtab && App.isImageTab || cfg.zoom === 'auto')
      App.toggleZoom();
  }

  static updateScales() {
    const scales = cfg.scales.length ? cfg.scales : Config.DEFAULTS.scales.slice();
    const fit = Math.min(
      (ai.view.width - ai.mbw - ai.outline * 2) / ai.nwidth,
      (ai.view.height - ai.mbh - ai.outline * 2) / ai.nheight);
    const isFirst = !ai.scales;
    const isCustom = !cfg.fit;
    let cutoff = ai.scale =
      isFirst && cfg.fit === 'all' && fit ||
      isFirst && cfg.fit === 'no' && 1 ||
      Math.min(1, fit);
    ai.scales = [];
    for (let i = scales.length; i--;) {
      const scale = scales[i];
      const val = parseFloat(scale) || fit;
      const option = typeof scale === 'string' && scale.slice(-1);
      if (option === '!' && isCustom)
        cutoff = val;
      if (option === '*' && isCustom)
        ai.scale0 = val;
      if (val !== ai.scale)
        ai.scales.push(val);
    }
    if (!isCustom && isFirst) ai.scale0 = ai.scale;
    ai.scales = ai.scales.filter(x => x >= cutoff).sort((a, b) => a - b);
    ai.scales.unshift(ai.scale);
  }

  static updateSpacing() {
    const s = getComputedStyle(ai.popup);
    ai.outline = sumProps(s.outlineOffset, s.outlineWidth);
    ai.pw = sumProps(s.paddingLeft, s.paddingRight);
    ai.ph = sumProps(s.paddingTop, s.paddingBottom);
    ai.mbw = sumProps(s.marginLeft, s.marginRight, s.borderLeftWidth, s.borderRightWidth);
    ai.mbh = sumProps(s.marginTop, s.marginBottom, s.borderTopWidth, s.borderBottomWidth);
  }

  static updateStyles() {
    let cssApp = App.globalStyle;
    if (!cssApp) {
      cssApp = App.globalStyle = /*language=CSS*/ (`
#\\mpiv-bar {
  position: fixed;
  z-index: 2147483647;
  left: 0;
  right: 0;
  top: 0;
  opacity: 0;
  transition: opacity 1s ease .25s;
  text-align: center;
  font-family: sans-serif;
  font-size: 15px;
  font-weight: bold;
  background: #0005;
  color: white;
  padding: 4px 10px;
  text-shadow: .5px .5px 2px #000;
}
#\\mpiv-bar.\\mpiv-show {
  opacity: 1;
}
#\\mpiv-bar[data-zoom]::after {
  content: " (" attr(data-zoom) ")";
  opacity: .8;
}
#\\mpiv-popup.\\mpiv-show {
  display: inline;
}
#\\mpiv-popup {
  display: none;
  border: none;
  box-sizing: content-box;
  position: fixed;
  z-index: 2147483647;
  margin: 0;
  max-width: none;
  max-height: none;
  will-change: display, width, height, left, top;
  cursor: none;
  animation: .2s \\mpiv-fadein both;
}
#\\mpiv-popup.\\mpiv-show {
  box-shadow: 6px 6px 30px transparent;
  transition: box-shadow .25s, background-color .25s;
}
#\\mpiv-popup.\\mpiv-show[loaded] {
  box-shadow: 6px 6px 30px black;
  background-color: white;
}
#\\mpiv-popup.\\mpiv-zoom-max {
  image-rendering: pixelated;
}
@keyframes \\mpiv-fadein {
  from { opacity: 0; }
  to { opacity: 1; }
}
` + (cfg.globalStatus ? `
.\\mpiv-loading:not(.\\mpiv-preloading) * {
  cursor: wait !important;
}
.\\mpiv-edge #\\mpiv-popup {
  cursor: default;
}
.\\mpiv-error * {
  cursor: not-allowed !important;
}
.\\mpiv-ready *, .\\mpiv-large * {
  cursor: zoom-in !important;
}
.\\mpiv-shift * {
  cursor: default !important;
}
` : `
[\\mpiv-status~="loading"]:not([\\mpiv-status~="preloading"]) {
  cursor: wait !important;
}
#\\mpiv-popup[\\mpiv-status~="edge"] {
  cursor: default !important;
}
[\\mpiv-status~="error"] {
  cursor: not-allowed !important;
}
[\\mpiv-status~="ready"],
[\\mpiv-status~="large"] {
  cursor: zoom-in !important;
}
[\\mpiv-status~="shift"] {
  cursor: default !important;
}
`)).replace(/\\mpiv-status/g, STATUS_ATTR).replace(/\\mpiv-/g, PREFIX);
    }
    const {css} = cfg;
    Util.addStyle('global', cssApp + (css.includes('{') ? css : `#${PREFIX}-popup {${css}}`));
    Util.addStyle('rule', ai.rule.css || '');
  }

  static updateTitle() {
    if (!ai.bar)
      return;
    const zoom = ai.nwidth && `${
      Math.round(ai.scale * 100)
    }%, ${
      ai.nwidth
    } x ${
      ai.nheight
    } px, ${
      Math.round(100 * (ai.nwidth * ai.nheight / 1e6)) / 100
    } MP`.replace(/\x20/g, '\xA0');
    if (ai.bar.dataset.zoom !== zoom || !ai.nwidth) {
      if (zoom) ai.bar.dataset.zoom = zoom;
      else delete ai.bar.dataset.zoom;
      App.updateBar();
    }
  }
}

class Config {
  constructor({data: c = GM_getValue('cfg'), save}) {
    if (typeof c === 'string')
      c = tryCatch(JSON.parse, c);
    if (typeof c !== 'object' || !c)
      c = {};
    const {DEFAULTS} = Config;
    if (c.version !== DEFAULTS.version) {
      if (typeof c.hosts === 'string')
        c.hosts = c.hosts.split('\n')
          .map(s => tryCatch(JSON.parse, s) || s)
          .filter(Boolean);
      if (c.close === true || c.close === false)
        c.zoomOut = c.close ? 'auto' : 'stay';
      for (const key in DEFAULTS)
        if (typeof c[key] !== typeof DEFAULTS[key])
          c[key] = DEFAULTS[key];
      if (c.version === 3 && c.scales[0] === 0)
        c.scales[0] = '0!';
      for (const key in c)
        if (!(key in DEFAULTS))
          delete c[key];
      c.version = DEFAULTS.version;
      if (save)
        GM_setValue('cfg', JSON.stringify(c));
    }
    if (cfg && (
      cfg.css !== c.css ||
      cfg.globalStatus !== c.globalStatus
    )) {
      App.globalStyle = '';
    }
    if (!Array.isArray(c.scales)) c.scales = [];
    c.fit = ['all', 'large', 'no'].includes(c.fit) ? c.fit :
      !c.scales.length || `${c.scales}` === `${Config.DEFAULTS.scales}` ? 'large' :
        '';
    Object.assign(this, c);
  }
}

/** @type mpiv.Config */
Config.DEFAULTS = Object.assign(Object.create(null), {
  center: false,
  css: '',
  delay: 500,
  fit: '',
  globalStatus: false,
  // prefer ' inside rules because " will be displayed as \"
  // example: "img[src*='icon']"
  hosts: [{
    name: 'No popup for YouTube thumbnails',
    d: 'www.youtube.com',
    e: 'ytd-rich-item-renderer *, ytd-thumbnail *',
    s: '',
  }, {
    name: 'No popup for SVG/PNG icons',
    d: '',
    e: "img[src*='icon']",
    r: '//[^/]+/.*\\bicons?\\b.*\\.(?:png|svg)',
    s: '',
  }],
  imgtab: false,
  preload: false,
  scale: 1.25,
  scales: ['0!', 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8, 16],
  start: 'auto',
  version: 6,
  xhr: true,
  zoom: 'context',
  zoomOut: 'auto',
});

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
      },
      {
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
        r: /.+?images\/I\/.+?\./,
        s: m => {
          const uh = doc.getElementById('universal-hover');
          return uh ? '' : m[0] + 'jpg';
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
        s: (m, node) =>
          $propUp(node, 'data-super-full-img') ||
          (node = node.dataset.embedId && node.nextElementSibling) &&
          node.dataset.embedId && node.src,
      },
      dotDomain.endsWith('.deviantart.com') && {
        e: '.dev-view-deviation img',
        s: () => [
          $('.dev-page-download').href,
          $('.dev-content-full').src,
        ].filter(Boolean),
      },
      dotDomain.endsWith('.deviantart.com') && {
        u: ',strp/',
        s: '/\\/v1\\/.*//',
      },
      dotDomain.endsWith('.dropbox.com') && {
        r: /(.+?&size_mode)=\d+(.*)/,
        s: '$1=5$2',
      },
      dotDomain.endsWith('.facebook.com') && {
        e: 'a[href*="ref=hovercard"]',
        s: (m, node) =>
          'https://www.facebook.com/photo.php?fbid=' +
          /\/[0-9]+_([0-9]+)_/.exec($('img', node).src)[1],
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
        r: /flickr\.com\/photos\/[^/]+\/(\d+)/,
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
      isGoogleImages && {
        e: 'a',
        r: /imgres\?imgurl=([^&]+)/,
        s: '$1',
      },
      isGoogleImages && {
        e: '[data-tbnid] a',
        s: (m, node, rule) => {
          const id = $propUp(node, 'data-tbnid');
          for (const {text} of $$('script', doc)) {
            let i = text.indexOf(id);
            if (i < 0) continue;
            i = text.indexOf('[', i + id.length + 9) + 2;
            const url = text.slice(i, text.indexOf('"', i + 1));
            if (!url.startsWith('http')) continue;
            rule.xhr = !url.startsWith(location.protocol);
            return url;
          }
        },
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
          const a = n.tagName === 'A' ? n : $('a[href*="/p/"]', n);
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
      ...dotDomain.endsWith('.reddit.com') && [{
        u: '||i.reddituploads.com/',
      }, {
        e: '[data-url*="i.redd.it"] img[src*="thumb"]',
        s: (m, node) => $propUp(node, 'data-url'),
      }, {
        r: /preview(\.redd\.it\/\w+\.(jpe?g|png|gif))/,
        s: 'https://i$1',
      }] || [],
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
        q: (text, doc) =>
          $prop('img.absolute-center', 'src', doc).replace(/(size_mode)=\d+/, '$1=5') || false,
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
          $('.zoom_trigger_mask', node.parentNode) ? '' :
            m.input.replace(/~~60_\d+/, '~~60_57'),
      },
      {
        u: [
          '||fastpic.ru/big',
          '||fastpic.ru/thumb',
        ],
        r: /\/\/(?:i(\d+)\.)?([^/]+\/)(big|thumb|view)\/([^.]+?)\.(\w+)/,
        s: (m, node, rule) => {
          const a = node.closest('[href*="fastpic.ru"]');
          const am = a && rule.r.exec(decodeURIComponent(a.href)) || [];
          const p = a && am[4].split('/');
          return `https://i${am[1] || m[1] || am[3] === 'view' && p[0]}.${m[2]}big/${
            am[3] === 'big' ? am[4] : m[4]}.${am[5] || m[5]}?noht=1`;
        },
        xhr: () => 'https://fastpic.ru',
      },
      {
        u: '||fastpic.ru/view/',
        q: 'img[src*="/big/"]',
        xhr: true,
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
            const a = $('a.fbPhotosPhotoActionsItem[href$="dl=1"]', doc.body);
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
          const links = $$('.sizes-list a', doc);
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
            m.input.replace(/\/s\d{2,}-[^/]+|\/w\d+-h\d+/, '/s0')
              .replace(/=[-\w]+([&#].*|$)/, ''),
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
        g: async (text, doc, url, m, rule, cb) => {
          // simplified extraction of JSON as it occupies only one line
          if (!/(?:mergeConfig\('gallery',\s*|Imgur\.Album\.getInstance\()[\s\S]*?[,\s{"'](?:image|album)\s*:\s*({[^\r\n]+?}),?[\r\n]/.test(text))
            return;
          const info = JSON.parse(RegExp.$1);
          let images = info.is_album ? info.album_images.images : [info];
          if (info.num_images > images.length) {
            const url = `https://imgur.com/ajaxalbums/getimages/${info.hash}/hit.json?all=true`;
            images = JSON.parse((await Remoting.gmXhr(url)).responseText).data.images;
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
          if (images && info.is_album && !safeIncludes(items[0].desc, info.title))
            items.title = info.title;
          cb(items);
        },
        css: '.post > .hover { display:none!important; }',
      },
      {
        u: '||imgur.com/',
        r: /((?:[a-z]{2,}\.)?imgur\.com\/)((?:\w+,)+\w*)/,
        s: 'gallery',
        g: (text, doc, url, m) =>
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
          if (a && a !== node && /(i\.([a-z]+\.)?)?imgur\.com\/(a\/|gallery\/)?/.test(a.href))
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
        u: '||tumblr.com',
        r: /_500\.jpg/,
        s: ['/_500/_1280/', ''],
      },
      {
        u: '||twimg.com/',
        r: /\/profile_images/i,
        s: '/_(reasonably_small|normal|bigger|\\d+x\\d+)\\././g',
      },
      {
        u: '||twimg.com/media/',
        r: /.+?format=(jpe?g|png|gif)/i,
        s: '$0&name=large',
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
      },
    ];

    /** @type mpiv.HostRule[] */
    Ruler.rules = [].concat(customRules, disablers, perDomain, main).filter(Boolean);
  }

  static format(rule, {expand} = {}) {
    const s = JSON.stringify(rule, null, ' ');
    return expand ?
      /* {"a": ...,
          "b": ...,
          "c": ...
         } */
      s.replace(/^{\s+/g, '{') :
      /* {"a": ..., "b": ..., "c": ...} */
      s.replace(/\n\s*/g, ' ').replace(/^({)\s|\s+(})$/g, '$1$2');
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
        compileTo.s = Util.newFunction('m', 'node', 'rule', rule.s);
      if (RX_HAS_CODE.test(rule.q))
        compileTo.q = Util.newFunction('text', 'doc', 'node', 'rule', rule.q);
      if (RX_HAS_CODE.test(rule.c))
        compileTo.c = Util.newFunction('text', 'doc', 'node', 'rule', rule.c);
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
      const el = $many(ai.rule.q, doc);
      url = el && Remoting.findImageUrl(el, docUrl);
    }
    return url;
  }

  static runS(node, rule, m) {
    let urls = [];
    for (const s of ensureArray(rule.s))
      urls.push(
        typeof s === 'string' ? Util.maybeDecodeUrl(Ruler.substituteSingle(s, m)) :
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
    return urls[0] === false ? {skipRule: true} : urls.map(Util.maybeDecodeUrl);
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

const SimpleUrlMatcher = (() => {
  // string-to-regexp escaped chars
  const RX_ESCAPE = /[.+*?(){}[\]^$|]/g;
  // rx for '^' symbol in simple url match
  const RX_SEP = /[^\w%._-]/g;
  const RXS_SEP = RX_SEP.source;
  return match => {
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
  };
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
    return url.includes(this[0]) && startsDomain.call(this, url);
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
})();

class RuleMatcher {

  /** @returns ?mpiv.RuleMatchInfo */
  static findForLink(a) {
    let url =
      a.getAttribute('data-expanded-url') ||
      a.getAttribute('data-full-url') ||
      a.getAttribute('data-url') ||
      a.href;
    if (url.startsWith('data:'))
      url = false;
    else if (url.includes('//t.co/'))
      url = 'http://' + a.textContent;
    return RuleMatcher.find(url, a);
  }

  /** @returns ?mpiv.RuleMatchInfo */
  static find(url, node, {noHtml, skipRule} = {}) {
    const tn = node.tagName;
    let m, html, urls;
    for (const rule of Ruler.rules) {
      const {e} = rule;
      if (e && !node.matches(e) || rule === skipRule)
        continue;
      const {r, u} = rule;
      if (r && !noHtml && rule.html && (tn === 'A' || tn === 'IMG' || e))
        m = r.exec(html || (html = node.outerHTML));
      else if (r || u)
        m = url && RuleMatcher.makeUrlMatch(url, node, rule);
      else
        m = url ? RuleMatcher.makeDummyMatch(url) : [];
      if (!m ||
          // a rule with follow:true for the currently hovered IMG produced a URL,
          // but we'll only allow it to match rules without 's' in the nested find call
          tn === 'IMG' && !('s' in rule) && !skipRule)
        continue;
      if (rule.s === '')
        return {};
      const hasS = 's' in rule && rule.s !== 'gallery';
      urls = hasS ? Ruler.runS(node, rule, m) : [m.input];
      if (!urls.skipRule) {
        const url = urls[0];
        return !url ? {} :
          hasS && !rule.q && RuleMatcher.isFollowableUrl(url, rule) ?
            RuleMatcher.find(url, node, {skipRule: rule}) :
            RuleMatcher.makeInfo(urls, node, rule, m);
      }
    }
  }

  static makeUrlMatch(url, node, rule) {
    let {r, u} = rule;
    let m;
    if (u) {
      u = rule._u || (rule._u = SimpleUrlMatcher(u));
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

class Events {

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
        url = !img.src.startsWith('data:') && Util.rel2abs(img.src, location.href);
      }
      info = RuleMatcher.find(url, node);
      a = !info && node.closest('a');
    }

    if (!info && a)
      info = RuleMatcher.findForLink(a);

    if (!info && img) {
      info = Util.lazyGetRect({
        url: img.src,
        node: img,
        rule: {},
      }, img);
    }

    if (info && info.url && info.node !== ai.node)
      App.activate(info, e);
  }

  static pierceShadow(node, x, y) {
    for (let root; (root = node.shadowRoot);) {
      root.addEventListener('mouseover', Events.onMouseOver, PASSIVE);
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
    if (e.shiftKey)
      return (ai.lazyUnload = true);
    if (!ai.zoomed && !ai.isOverRect)
      return App.deactivate();
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
    if (button === 0 && shiftKey && ai.popup && ai.popup.controls) {
      ai.controlled = ai.zoomed = true;
    } else if (button === 2 || shiftKey) {
      // we ignore RMB and Shift
    } else {
      App.deactivate({wait: true});
    }
  }

  static onMouseScroll(e) {
    const dir = (e.deltaY || -e.wheelDelta) > 0 ? 1 : -1;
    if (ai.zoom) {
      dropEvent(e);
      const i = ai.scales.indexOf(ai.scale) - dir;
      const n = ai.scales.length;
      if (i >= 0 && i < n)
        ai.scale = ai.scales[i];
      if (i === 0 && cfg.zoomOut !== 'stay') {
        if ((cfg.zoomOut === 'close' || !ai.isOverRect) &&
            (!ai.gItems || ai.gItems.length < 2))
          return App.deactivate({wait: true});
        ai.zoom = false;
        ai.zoomed = false;
        App.updateFileInfo();
      } else {
        ai.popup.classList.toggle(`${PREFIX}zoom-max`, ai.scale >= 4 && i >= n - 1);
      }
      if (ai.zooming)
        ai.popup.classList.add(`${PREFIX}zooming`);
      Popup.move();
      App.updateTitle();
    } else if (ai.gItems && ai.gItems.length > 1 && ai.popup) {
      dropEvent(e);
      Gallery.next(dir);
    } else if (cfg.zoom === 'wheel' && dir < 0 && ai.popup) {
      dropEvent(e);
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
        if ((ai.popup || {}).controls)
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
        dropEvent(e);
        Gallery.next(1);
        break;
      case 'ArrowLeft':
      case 'KeyK':
        dropEvent(e);
        Gallery.next(-1);
        break;
      case 'KeyD': {
        dropEvent(e);
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
      dropEvent(e);
      return;
    }
    if (!ai.popup && (
      cfg.start === 'context' ||
      (cfg.start === 'auto' && ai.rule.manual)
    )) {
      Popup.start();
      dropEvent(e);
    } else {
      setTimeout(App.deactivate, SETTLE_TIME, {wait: true});
    }
  }
}

class Popup {

  static schedule(force) {
    if (!cfg.preload) {
      ai.timer = setTimeout(Popup.start, cfg.delay);
    } else if (!force) {
      // we don't want to preload everything in the path of a quickly moving mouse cursor
      ai.timer = setTimeout(Popup.schedule, SETTLE_TIME, true);
      ai.preloadStart = Date.now();
    } else {
      Popup.start();
      App.setStatus('+preloading');
      setTimeout(App.setStatus, cfg.delay, '-preloading');
    }
  }

  static start() {
    App.updateStyles();
    ai.gallery ?
      Popup.startGallery() :
      Popup.startSingle();
  }

  static startSingle() {
    App.setStatusLoading();
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
      const {responseText, doc, finalUrl} = await Remoting.getDoc(ai.url);
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
    App.setStatusLoading();
    try {
      const startUrl = ai.url;
      const p = ai.rule.s === 'gallery' ? {} :
        await Remoting.getDoc(startUrl);
      const items = await new Promise(resolve => {
        const it = ai.gallery(p.responseText, p.doc, p.finalUrl, ai.match, ai.rule, resolve);
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

  static async render(src, pageUrl) {
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
        $create('img');
    p.id = `${PREFIX}popup`;
    p.src = src;
    p.addEventListener('error', App.handleError);
    p.addEventListener('load', Popup.onLoad, {once: true});
    if (ai.zooming)
      p.addEventListener('transitionend', Popup.onZoom);
    doc.body.insertBefore(p, ai.bar || undefined);
    App.checkProgress({start: true});
  }

  static onLoad() {
    this.setAttribute('loaded', '');
    ai.popupLoaded = true;
    if (!ai.bar)
      App.updateFileInfo();
  }

  static onZoom() {
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
    p.removeEventListener('error', App.handleError);
    if (typeof p.pause === 'function')
      p.pause();
    if (!ai.lazyUnload) {
      if (p.src.startsWith('blob:'))
        URL.revokeObjectURL(p.src);
      p.src = '';
    }
    p.remove();
    ai.zoom = false;
    ai.popupLoaded = false;
    ai.popup = null;
  }
}

class PopupVideo {
  static create() {
    const p = $create('video');
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

class Gallery {

  static makeParser(g) {
    return (
      typeof g === 'function' ? g :
        typeof g === 'string' ? Util.newFunction('text', 'doc', 'url', 'm', 'rule', 'cb', g) :
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
      ai.urls = null;
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
    $create('img', {src: ai.preloadUrl});
  }

  static defaultParser(text, doc, docUrl, m, rule) {
    const {g} = rule;
    const qEntry = g.entry;
    const qCaption = ensureArray(g.caption);
    const qImage = g.image;
    const qTitle = g.title;
    const fix =
      (typeof g.fix === 'string' ? Util.newFunction('s', 'isURL', g.fix) : g.fix) ||
      (s => s.trim());
    const items = [...$$(qEntry || qImage, doc)]
      .map(processEntry)
      .filter(Boolean);
    items.title = processTitle();
    return items;

    function processEntry(entry) {
      const item = {};
      try {
        const img = qEntry ? $(qImage, entry) : entry;
        item.url = fix(Remoting.findImageUrl(img, docUrl), true);
        item.desc = qCaption.map(processCaption, entry).filter(Boolean).join(' - ');
      } catch (e) {}
      return item.url && item;
    }

    function processCaption(selector) {
      const el = $(selector, this) ||
                 $orSelf(selector, this.previousElementSibling) ||
                 $orSelf(selector, this.nextElementSibling);
      return el && fix(el.textContent);
    }

    function processTitle() {
      const el = $(qTitle, doc);
      return el && fix(el.getAttribute('content') || el.textContent) || '';
    }

    function $orSelf(selector, el) {
      if (el && !el.matches(qEntry))
        return el.matches(selector) ? el : $(selector, el);
    }
  }
}

class Remoting {

  static gmXhr(url, opts = {}) {
    if (ai.req)
      tryCatch.call(ai.req, ai.req.abort);
    return new Promise((resolve, reject) => {
      ai.req = GM_xmlhttpRequest({
        url,
        method: 'GET',
        timeout: 10e3,
        ...opts,
        onload: done,
        onerror: done,
        ontimeout() {
          ai.req = null;
          reject(`Timeout fetching ${url}`);
        },
      });
      function done(r) {
        ai.req = null;
        r.status < 400 && !r.error ?
          resolve(r) :
          reject(`Server error ${r.status} ${r.error}\nURL: ${url}`);
      }
    });
  }

  static async getDoc(url) {
    const r = await (!ai.post ?
      Remoting.gmXhr(url) :
      Remoting.gmXhr(url, {
        method: 'POST',
        data: ai.post,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': url,
        },
      }));
    r.doc = new DOMParser().parseFromString(r.responseText, 'text/html');
    return r;
  }

  static async getImage(url, pageUrl) {
    ai.bufferingBar = false;
    ai.bufferingStart = Date.now();
    const response = await Remoting.gmXhr(url, {
      responseType: 'blob',
      headers: {
        Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
        Referer: pageUrl || (typeof ai.xhr === 'function' ? ai.xhr() : url),
      },
      onprogress: Remoting.getImageProgress,
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

  static getImageProgress(e) {
    if (!ai.bufferingBar && Date.now() - ai.bufferingStart > 3000 && e.loaded / e.total < 0.5)
      ai.bufferingBar = true;
    if (ai.bufferingBar) {
      const pct = e.loaded / e.total * 100 | 0;
      const size = e.total / 1024 | 0;
      App.setBar(`${pct}% of ${size} kiB`, 'xhr');
    }
  }

  static async findRedirect() {
    try {
      const {finalUrl} = await Remoting.gmXhr(ai.url, {
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
    let name = Remoting.getFileName(ai.imageUrl || url);
    if (!name.includes('.'))
      name += '.jpg';
    try {
      if (!url.startsWith('blob:') && !url.startsWith('data:')) {
        const {response} = await Remoting.gmXhr(url, {
          responseType: 'blob',
          headers: {'Referer': url},
        });
        url = URL.createObjectURL(response);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      $create('a', {href: url, download: name})
        .dispatchEvent(new MouseEvent('click'));
    } catch (e) {
      App.setBar(`Could not download ${name}.`, 'error');
    }
  }

  static getFileName(url) {
    return decodeURIComponent(url).split('/').pop().replace(/[:#?].*/, '');
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
      case 'jpe': return 'image/jpeg';
      case 'jpeg': return 'image/jpeg';
      case 'jpg': return 'image/jpeg';
      case 'mp4': return 'video/mp4';
      case 'png': return 'image/png';
      case 'svg': return 'image/svg+xml';
      case 'tif': return 'image/tiff';
      case 'tiff': return 'image/tiff';
      case 'webm': return 'video/webm';
      default: return 'application/octet-stream';
    }
  }

  static findImageUrl(n, url) {
    let html;
    const path =
      n.getAttribute('src') ||
      n.getAttribute('data-m4v') ||
      n.getAttribute('href') ||
      n.getAttribute('content') ||
      (html = n.outerHTML).includes('http') &&
      html.match(/https?:\/\/[^\s"<>]+?\.(jpe?g|gif|png|svg|web[mp]|mp4)[^\s"<>]*|$/i)[0];
    return !!path && Util.rel2abs(Util.decodeHtmlEntities(path),
      $prop('base[href]', 'href', n.ownerDocument) || url);
  }
}

class Util {

  static addStyle(name, css) {
    const id = `${PREFIX}style:${name}`;
    const el = doc.getElementById(id) ||
               css && $create('style', {id});
    if (!el)
      return;
    if (el.textContent !== css)
      el.textContent = css;
    if (el.parentElement !== doc.head)
      doc.head.appendChild(el);
    return el;
  }

  static decodeHtmlEntities(s) {
    return s.replace(/&quot;/g, '"')
            .replace(/&apos;/g, '\'')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
  }

  static deepEqual(a, b) {
    if (typeof a !== typeof b)
      return false;
    if (!a || !b || typeof a !== 'object')
      return a === b;
    if (Array.isArray(a))
      return Array.isArray(b) &&
             a.length === b.length &&
             a.every((v, i) => Util.deepEqual(v, b[i]));
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
           keys.every(k => Util.deepEqual(a[k], b[k]));
  }

  static findScale(url, parent) {
    const imgs = $$('img, video', parent);
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
          $('div[bgactive*="flashblock"]', doc) ?
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
    if (rule.e)
      m.push(['Element match: %o', rule.e]);
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

  // decode only if the main part of the URL is encoded to preserve the encoded parameters
  static maybeDecodeUrl(url) {
    if (!url)
      return url;
    const iPct = url.indexOf('%');
    const iColon = url.indexOf(':');
    return iPct >= 0 && (iPct < iColon || iColon < 0) ?
      decodeURIComponent(url) :
      url;
  }

  static newFunction(...args) {
    try {
      return App.NOP || new Function(...args);
    } catch (e) {
      if (!e.message.includes('unsafe-eval'))
        throw e;
      App.NOP = () => {};
      return App.NOP;
    }
  }

  static rect(node, selector) {
    let n = selector && node.closest(selector);
    if (n)
      return n.getBoundingClientRect();
    const nested = node.getElementsByTagName('*');
    let maxArea = 0;
    let maxBounds;
    n = node;
    for (let i = 0; n; n = nested[i++]) {
      const bounds = n.getBoundingClientRect();
      const area = bounds.width * bounds.height;
      if (area > maxArea) {
        maxArea = area;
        maxBounds = bounds;
        node = n;
      }
    }
    return maxBounds;
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
    for (const node of [
      ai.node.parentNode,
      ai.node,
      ai.node.firstElementChild,
    ]) {
      const t = (node || 0).title;
      if (t && t !== node.textContent && !doc.title.includes(t) && !/^https?:\S+$/.test(t)) {
        ai.tooltip = {node, text: t};
        node.title = '';
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
          background: #222;
        }
        .fit {
          overflow: hidden
        }
        .fit > img {
          max-width: 100vw;
          max-height: 100vh;
        }
        body > img {
          margin: auto;
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          bottom: 0;
        }
      </style>
      <body class=fit>
        <img onclick="document.body.classList.toggle('fit')" src="${ai.popup.src}">
      </body>
    `.replace(/\n\s*/g, '').replace(/\x20?([:>])\x20/g, '$1').replace(/#/g, '%23');
  }
}

function setup({rule} = {}) {
  const MPIV_BASE_URL = 'https://w9p.co/userscripts/mpiv/';
  const SETUP_ID = `${PREFIX}setup`;
  const RULE = setup.RULE || (setup.RULE = Symbol('rule'));
  let div = doc.getElementById(SETUP_ID);
  let root = div && div.shadowRoot;
  let {blankRuleElement} = setup;
  /** @type NodeList */
  const UI = new Proxy({}, {
    get(_, id) {
      return root.getElementById(id);
    },
  });
  if (!rule || !div)
    init(new Config({save: true}));
  if (rule)
    installRule(rule);

  function closeSetup(event) {
    if (event && this.id !== 'x') {
      cfg = collectConfig({save: true, clone: this.id === 'apply'});
      Ruler.init();
      if (this.id === 'apply') {
        renderCustomScales(cfg);
        return;
      }
    }
    const el = doc.getElementById(SETUP_ID);
    el && el.remove();
  }

  function collectConfig({save, clone} = {}) {
    const delay = parseInt(UI.delay.value);
    const scale = parseFloat(UI.scale.value.replace(',', '.'));
    let data = {
      css: UI.css.value.trim(),
      delay: !isNaN(delay) && delay >= 0 ? delay : undefined,
      fit: UI.fit.value || '',
      hosts: collectRules(),
      scale: !isNaN(scale) ? Math.max(1, scale) : undefined,
      scales: UI.scales.value
        .trim()
        .split(/[,;]*\s+/)
        .map(x => x.replace(',', '.'))
        .filter(x => !isNaN(parseFloat(x))),
      start: UI.start.value,
      zoom: UI.zoom.value,
      zoomOut: UI.zoomOut.value,
    };
    for (const el of $$('[type="checkbox"]', root))
      data[el.id] = el.checked;
    if (clone)
      data = JSON.parse(JSON.stringify(data));
    return new Config({data, save});
  }

  function collectRules() {
    return [...UI.rules.children]
      .map(el => [el.value.trim(), el[RULE]])
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      .map(([s, json]) => json || s)
      .filter(Boolean);
  }

  function exportSettings(e) {
    dropEvent(e);
    const txt = $create('textarea', {
      style: 'opacity:0; position:absolute',
      value: JSON.stringify(collectConfig(), null, '  '),
    });
    root.appendChild(txt);
    txt.select();
    txt.focus();
    document.execCommand('copy');
    e.target.focus();
    txt.remove();
    UI.exportNotification.hidden = false;
    setTimeout(() => (UI.exportNotification.hidden = true), 1000);
  }

  function importSettings(e) {
    dropEvent(e);
    const s = prompt('Paste settings:');
    if (s)
      init(new Config({data: s}));
  }

  function checkRule({target: el}) {
    let json, error;
    const prev = el.previousElementSibling;
    if (el.value) {
      json = Ruler.parse(el.value);
      error = json instanceof Error && (json.message || String(json));
      if (!prev)
        el.insertAdjacentElement('beforebegin', blankRuleElement.cloneNode());
    } else if (prev) {
      prev.focus();
      el.remove();
    }
    el[RULE] = !error && json;
    el.title = error || '';
    el.setCustomValidity(error || '');
  }

  function focusRule({type, target: el, relatedTarget: from}) {
    if (el === this)
      return;
    if (type === 'paste') {
      setTimeout(() => focusRule.call(this, {target: el}));
      return;
    }
    if (el[RULE])
      el.value = Ruler.format(el[RULE], {expand: true});
    const h = clamp(el.scrollHeight, 15, div.clientHeight / 4);
    if (h > el.offsetHeight)
      el.style.minHeight = h + 'px';
    if (!this.contains(from))
      from = [...$$('[style*="height"]', this)].find(_ => _ !== el);
    if (from) {
      from.style.minHeight = '';
      if (from[RULE])
        from.value = Ruler.format(from[RULE]);
    }
  }

  function installRule(rule) {
    const inputs = UI.rules.children;
    let el = [...inputs].find(el => Util.deepEqual(el[RULE], rule));
    if (!el) {
      el = inputs[0];
      el[RULE] = rule;
      el.value = Ruler.format(rule);
      el.hidden = false;
      const i = Math.max(0, collectRules().indexOf(rule));
      inputs[i].insertAdjacentElement('afterend', el);
      inputs[0].insertAdjacentElement('beforebegin', blankRuleElement.cloneNode());
    }
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 ||
        rect.bottom > el.parentNode.offsetHeight)
      el.scrollIntoView();
    el.classList.add('highlight');
    el.addEventListener('animationend', () => el.classList.remove('highlight'), {once: true});
    el.focus();
  }

  function renderCustomScales(config) {
    UI.scales.value = config.scales.join(' ').trim() || Config.DEFAULTS.scales.join(' ');
  }

  function init(config) {
    closeSetup();
    div = $create('div', {
      id: SETUP_ID,
      // prevent the main page from interpreting key presses in inputs as hotkeys
      // which may happen since it sees only the outer <div> in the event |target|
      contentEditable: true,
    });
    const scalesHint = 'Leave it empty and click Apply or Save to restore the default values.';
    const trimLeft = s => s.trim().replace(/\n\s+/g, '\n');
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
    width: 500px !important;
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
  }
  li {
    margin: 0;
    padding: .25em 0;
  }
  li.options {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  li.row {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  li.row label {
    flex-direction: row;
    align-items: center;
  }
  li.row input {
    margin-right: .25em;
  }
  label {
    display: inline-flex;
    flex-direction: column;
  }
  label:not(:last-child) {
    margin-right: 1em;
  }
  input, select {
    min-height: 1.6em;
    box-sizing: border-box;
  }
  input[type="checkbox"] {
    margin-left: 0;
  }
  input[type="number"] {
    width: 4em;
    padding: 0 .25em;
  }
  textarea {
    flex: 1;
    resize: vertical;
    margin: 1px 0;
    font: 11px/1.25 Consolas, monospace;
  }
  textarea:invalid {
    background-color: #f002;
    border-color: #800;
  }
  code {
    font-weight: bold;
  }
  a {
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  button {
    padding: .2em 1em;
    margin: 0 1em;
  }
  .column {
    display: flex;
    flex-direction: column;
  }
  .highlight {
    animation: 2s fade-in cubic-bezier(0, .75, .25, 1);
    animation-fill-mode: both;
  }
  #rules textarea {
    word-break: break-all;
  }
  #x {
    position: absolute;
    top: 0;
    right: 0;
    padding: 4px 8px;
    cursor: pointer;
    user-select: none;
  }
  #x:hover {
    background-color: #8884;
  }
  #cssApp {
    color: seagreen;
  }
  #exportNotification {
    color: green;
    font-weight: bold;
    position: absolute;
    left: 0;
    right: 0;
    bottom: 2px;
  }
  @keyframes fade-in {
    from { background-color: deepskyblue }
    to {}
  }
  @media (prefers-color-scheme: dark) {
    :host {
      color: #aaa !important;
      background: #333 !important;
    }
    a {
      color: deepskyblue;
    }
    textarea, input, select {
      background: #111;
      color: #BBB;
      border: 1px solid #555;
    }
    input[type="checkbox"] {
      filter: invert(1);
    }
    #cssApp {
      color: darkseagreen;
    }
  }
</style>
<main>
  <a href="${MPIV_BASE_URL}">${GM_info.script.name}</a>
  <div id=x>x</div>
  <ul class=column>
    <li class=options>
      <label>Popup:
        <select id=start>
          <option value=auto>automatically
          <option value=context>right click or ctrl
          <option value=ctrl>ctrl
        </select>
      </label>
      <label>after, ms <input id=delay type=number min=0 max=10000 step=50 title=milliseconds></label>
      <label title="Activate only if the full version of the hovered image is that many times larger">
        if larger <input id=scale type=number min=1 max=100 step=.05>
      </label>
      <label>Zoom via:
        <select id=zoom>
          <option value=context>right click or shift
          <option value=wheel>wheel up or shift
          <option value=shift>shift
          <option value=auto>automatically
        </select>
      </label>
      <label>First zoom mode:
        <select id=fit>
          <option value=all>fit to window
          <option value=large>fit if larger
          <option value=no>100%
          <option value="" title="Use custom scale factors">custom
        </select>
      </label>
    </li>
    <li class=options>
      <label>When fully zoomed out:
        <select id=zoomOut>
          <option value=stay>stay in zoom mode
          <option value=auto>stay if still hovered
          <option value=close>close popup
        </select>
      </label>
      <label style="flex: 1" title="${trimLeft(`
        0 = fit to window,
        0! = same as 0 but also removes smaller values,
        * after a value marks the default zoom factor, for example: 1*
        The popup image won't shrink below the size of the hovered image.
        ${scalesHint}
      `)}">
      Custom scale factors: <input id=scales placeholder="${scalesHint}">
      </label>
    </li>
    <li class="options row">
      <label><input type=checkbox id=center>Always centered</label>
      <label title="Disable only if you spoof the HTTP headers yourself">
        <input type=checkbox id=xhr>Anti-hotlinking workaround
      </label>
      <label><input type=checkbox id=preload>Start preloading immediately</label>
      <label><input type=checkbox id=imgtab>Run in image tabs</label>
      <label title="Don't enable unless you explicitly use it in your custom CSS">
        <input type=checkbox id=globalStatus>Expose status on &lt;html&gt; node (may cause slowdowns)
      </label>
    </li>
    <li>
      <a href="${MPIV_BASE_URL}css.html">Custom CSS:</a>
      e.g. <code>#mpiv-popup.mpiv-show { animation: none }</code>
      <a href="#" id=reveal style="float: right"
         title="You can copy parts of it to override them in your custom CSS">
         View the built-in CSS</a>
      <div class=column>
        <textarea id=css spellcheck=false></textarea>
        <textarea id=cssApp spellcheck=false hidden readonly rows=30></textarea>
      </div>
    </li>
    <li style="display: flex; justify-content: space-between;">
      <div><a href="${MPIV_BASE_URL}host_rules.html">Custom host rules:</a></div>
      <div style="white-space: nowrap">
        To disable, put any symbol except <code>a..z 0..9 - .</code><br>
        in "d" value, for example <code>"d": "!foo.com"</code>
      </div>
      <div>
        <input id=search type=search placeholder=Search style="width: 10em; margin-left: 1em">
      </div>
    </li>
    <li style="margin-left: -3px; margin-right: -3px; overflow-y: auto; padding-left: 3px; padding-right: 3px;">
      <div id=rules class=column>
        <textarea rows=1 spellcheck=false></textarea>
      </div>
    </li>
    <li>
      <div hidden id=installLoading>Loading...</div>
      <div hidden id=installHint>Double-click the rule (or select and press Enter) to add it. Click OK when done.</div>
      <a href="${MPIV_BASE_URL}more_host_rules.html" id=install>Install rule from repository...</a>
    </li>
  </ul>
  <div style="text-align:center">
    <button id=ok accesskey=s>Save</button>
    <button id=apply accesskey=a>Apply</button>
    <button id=import style="margin-right: 0">Import</button>
    <button id=export style="margin-left: 0">Export</button>
    <button id=cancel>Cancel</button>
    <div id=exportNotification hidden>Copied to clipboard.</div>
  </div>
</main>
    `;
    // rules
    const rules = UI.rules;
    rules.addEventListener('input', checkRule);
    rules.addEventListener('focusin', focusRule);
    rules.addEventListener('paste', focusRule);
    blankRuleElement =
      setup.blankRuleElement =
        setup.blankRuleElement || rules.firstElementChild.cloneNode();
    for (const rule of config.hosts || []) {
      const el = blankRuleElement.cloneNode();
      el.value = typeof rule === 'string' ? rule : Ruler.format(rule);
      rules.appendChild(el);
      checkRule({target: el});
    }
    // search rules
    const search = UI.search;
    search.oninput = () => {
      setup.search = search.value;
      const s = search.value.toLowerCase();
      for (const el of rules.children)
        el.hidden = s && !el.value.toLowerCase().includes(s);
    };
    search.value = setup.search || '';
    if (search.value)
      search.oninput();
    // prevent the main page from interpreting key presses in inputs as hotkeys
    // which may happen since it sees only the outer <div> in the event |target|
    root.addEventListener('keydown', e =>
      !e.altKey && !e.ctrlKey && !e.metaKey && e.stopPropagation(), true);
    UI.apply.onclick = UI.cancel.onclick = UI.ok.onclick = UI.x.onclick = closeSetup;
    UI.css.value = config.css;
    UI.delay.value = config.delay;
    UI.export.onclick = exportSettings;
    UI.fit.value = config.fit;
    UI.import.onclick = importSettings;
    UI.install.onclick = setupRuleInstaller;
    const {cssApp} = UI;
    UI.reveal.onclick = e => {
      e.preventDefault();
      cssApp.hidden = !cssApp.hidden;
      if (!cssApp.hidden) {
        if (!cssApp.value) {
          App.updateStyles();
          const css = App.globalStyle;
          const indent = css.match(/\n(\s*)\S/)[1];
          cssApp.value = css.trim().replace(new RegExp(indent, 'g'), '');
        }
        cssApp.focus();
      }
    };
    UI.scale.value = config.scale;
    UI.start.value = config.start;
    UI.start.onchange = function () {
      UI.delay.closest('label').hidden =
        UI.preload.closest('label').hidden =
          this.value !== 'auto';
    };
    UI.start.onchange();
    UI.xhr.onclick = ({target: el}) => el.checked || confirm($propUp(el, 'title'));
    UI.zoom.value = config.zoom;
    UI.zoomOut.value = config.zoomOut;
    for (const el of $$('[type="checkbox"]', root))
      el.checked = config[el.id];
    for (const el of $$('a[href^="http"]', root)) {
      el.target = '_blank';
      el.rel = 'noreferrer noopener external';
    }
    renderCustomScales(config);
    doc.body.appendChild(div);
    requestAnimationFrame(() => {
      UI.css.style.minHeight = clamp(UI.css.scrollHeight, 40, div.clientHeight / 4) + 'px';
    });
  }
}

async function setupRuleInstaller(e) {
  dropEvent(e);
  const parent = this.parentElement;
  parent.children.installLoading.hidden = false;
  this.remove();
  let rules;

  try {
    rules = extractRules((await Remoting.getDoc(this.href)).doc);
    const selector = $create('select', {
      size: 8,
      style: 'width: 100%',
      ondblclick: e => e.target !== selector && maybeSetup(e),
      onkeyup: e => e.key === 'Enter' && maybeSetup(e),
    });
    selector.append(...rules.map(renderRule));
    selector.selectedIndex = findMatchingRuleIndex();
    // remove "name" since the installed rules don't need it
    for (const r of rules)
      delete r.name;
    parent.children.installLoading.remove();
    parent.children.installHint.hidden = false;
    parent.appendChild(selector);
  } catch (e) {
    parent.textContent = 'Error loading rules: ' + (e.message || e);
  }

  function extractRules(doc) {
    const code = $('script', doc).textContent;
    // sort by name
    return JSON.parse(code.match(/var\s+rules\s*=\s*(\[.+]);?[\r\n]/)[1])
      .filter(r => !r.d || hostname.includes(r.d))
      .sort((a, b) =>
        (a = a.name.toLowerCase()) < (b = b.name.toLowerCase()) ? -1 :
          a > b ? 1 :
            0);
  }

  function findMatchingRuleIndex() {
    // get the core part of the current domain that's not "www", "m", etc.
    const h = hostname.split('.');
    const core = h[0] === 'www' || h.length > 2 && h[0].length === 1 ? h[1] : h[0];
    // find a rule matching the domain core
    return rules.findIndex(r =>
      r.name.toLowerCase().includes(core) ||
      r.d && hostname.includes(r.d));
  }

  function renderRule(r) {
    const {name, ...copy} = r;
    return $create('option', {
      textContent: name,
      title: Ruler.format(copy, {expand: true})
        .replace(/^{|\s*}$/g, '')
        .split('\n')
        .slice(0, 12)
        .map(renderTitleLine)
        .filter(Boolean)
        .join('\n'),
    });
  }

  function renderTitleLine(line, i, arr) {
    return (
      // show ... on 10th line if there are more lines
      i === 9 && arr.length > 10 ? '...' :
        i > 10 ? '' :
          // truncate to 100 chars
          (line.length > 100 ? line.slice(0, 100) + '...' : line)
            // strip the leading space
            .replace(/^\s/, ''));
  }

  function maybeSetup(e) {
    if (!e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey)
      setup({rule: rules[e.currentTarget.selectedIndex]});
  }
}

App.init();
