//#region Meta
// ==UserScript==
// @name        Mouseover Popup Image Viewer
// @namespace   https://github.com/tophf
// @description Shows images and videos behind links and thumbnails.

// @include     *
// @connect     *

// allow rule installer in config dialog https://w9p.co/userscripts/mpiv/more_host_rules.html
// @connect     w9p.co

// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_download
// @grant       GM_openInTab
// @grant       GM_registerMenuCommand

// @version     1.1.8
// @author      tophf

// @original-version 2017.9.29
// @original-author  kuehlschrank

// @supportURL  https://github.com/tophf/mpiv/issues
// @homepage    https://w9p.co/userscripts/mpiv/
// @icon        https://w9p.co/userscripts/mpiv/icon.png
// ==/UserScript==
//#endregion

'use strict';

//#region Globals

/** @type mpiv.Config */
let cfg;
/** @type mpiv.AppInfo */
let ai = {rule: {}};
/** @type Element */
let elConfig;

const undefined = void 0; // eslint-disable-line no-shadow-restricted-names, no-redeclare
const doc = document;
const hostname = location.hostname;
const dotDomain = '.' + hostname;
const isGoogleDomain = /(^|\.)google(\.com?)?(\.\w+)?$/.test(hostname);
const isGoogleImages = isGoogleDomain && /[&?]tbm=isch(&|$)/.test(location.search);

const PREFIX = 'mpiv-';
const STATUS_ATTR = `${PREFIX}status`;
const MSG = Object.assign({}, ...[
  'getViewSize',
  'viewSize',
].map(k => ({[k]: `${PREFIX}${k}`})));
const WHEEL_EVENT = 'onwheel' in doc ? 'wheel' : 'mousewheel';
// time for volatile things to settle down meanwhile we postpone action
// examples: loading image from cache, quickly moving mouse over one element to another
const SETTLE_TIME = 50;
// used to detect JS code in host rules
const RX_HAS_CODE = /(^|[^-\w])return[\W\s]/;
const ZOOM_MAX = 16;

//#endregion

const App = {

  activate(info, event) {
    const {match, node, rule, url} = info;
    const force = event.ctrlKey;
    const scale = !force && Calc.scaleGain(url, node.parentNode);
    if (elConfig) console.info(Object.assign({node, rule, url, match}, scale && {scale}));
    if (scale && scale < cfg.scale)
      return;
    if (ai.node)
      App.deactivate();
    ai = info;
    ai.gNum = 0;
    ai.zooming = cfg.css.includes(`${PREFIX}zooming`);
    Util.suppressTooltip();
    Calc.updateViewSize();
    Events.toggle(true);
    Events.trackMouse(event);
    if (force) {
      App.start();
    } else if (cfg.start === 'auto' && !rule.manual) {
      App.belate();
    } else {
      Status.set('ready');
    }
  },

  belate() {
    if (cfg.preload) {
      ai.preloadStart = now();
      App.start();
      Status.set('+preloading');
      setTimeout(Status.set, cfg.delay, '-preloading');
    } else {
      ai.timer = setTimeout(App.start, cfg.delay);
    }
  },

  checkProgress({start} = {}) {
    const p = ai.popup;
    if (p) {
      const w = ai.nwidth = p.naturalWidth || p.videoWidth || ai.popupLoaded && innerWidth / 2;
      const h = ai.nheight = p.naturalHeight || p.videoHeight || ai.popupLoaded && innerHeight / 2;
      if (h) {
        App.stopTimers();
        const wait = ai.preloadStart && (ai.preloadStart + cfg.delay - now());
        if (wait > 0) {
          ai.timer = setTimeout(App.checkProgress, wait);
        } else if ((ai.urls || 0).length && Math.max(w, h) < 130) {
          App.handleError({type: 'error'});
        } else {
          App.commit();
        }
        return;
      }
    }
    if (start)
      ai.timerProgress = setInterval(App.checkProgress, 150);
  },

  async commit() {
    App.updateStyles();
    Calc.naturalSize();
    const p = ai.popup;
    p.className = `${PREFIX}show`;
    p.removeAttribute('style');
    Calc.updateExtras();
    Calc.updateScales();
    Status.set(false);
    const willZoom = cfg.zoom === 'auto' || App.isImageTab && cfg.imgtab;
    const willMove = !willZoom || App.toggleZoom({keepScale: true}) === undefined;
    if (willMove)
      Popup.move();
    Bar.updateName();
    Bar.updateDetails();
    ai.large = ai.nwidth > p.clientWidth + ai.extras.w ||
               ai.nheight > p.clientHeight + ai.extras.h;
    if (ai.large)
      Status.set('large');
    // FF renders a blank bg+border first; I couldn't find a proper solution
    if (p.complete && isFF && ai.large)
      p.style.backgroundImage = `url('${p.src}')`;
  },

  deactivate({wait} = {}) {
    App.stopTimers();
    if (ai.req)
      tryCatch.call(ai.req, ai.req.abort);
    if (ai.tooltip)
      ai.tooltip.node.title = ai.tooltip.text;
    Status.set(false);
    Bar.set(false);
    Events.toggle(false);
    Popup.destroy();
    if (wait) {
      App.enabled = false;
      setTimeout(App.enable, 200);
    }
    ai = {rule: {}};
  },

  enable() {
    App.enabled = true;
  },

  handleError(e, rule = ai.rule) {
    if (isGoogleImages && cfg.xhr && !ai.xhr) {
      ai.xhr = true;
      console.debug('Retrying in XHR mode', ai.url);
      App.startSingle();
      return;
    }
    const fe = Util.formatError(e, rule);
    if (!rule || !ai.urls || !ai.urls.length)
      console.warn(fe.consoleFormat, ...fe.consoleArgs);
    if (ai.urls && ai.urls.length) {
      ai.url = ai.urls.shift();
      if (ai.url) {
        App.stopTimers();
        App.startSingle();
      } else {
        App.deactivate();
      }
    } else if (ai.node) {
      Status.set('error');
      Bar.set(fe.message, 'error');
    }
  },

  /** @param {MessageEvent} e */
  onMessage(e) {
    if (typeof e.data === 'string' && e.data === MSG.getViewSize) {
      for (const el of doc.getElementsByTagName('iframe')) {
        if (el.contentWindow === e.source) {
          const [w, h] = Calc.frameSize(el, window);
          e.source.postMessage(`${MSG.viewSize}:${w}:${h}`, '*');
          return;
        }
      }
    }
  },

  /** @param {MessageEvent} e */
  onMessageChild(e) {
    if (e.source === parent && typeof e.data === 'string' && e.data.startsWith(MSG.viewSize)) {
      window.removeEventListener('message', App.onMessageChild);
      const [w, h] = e.data.split(':').slice(1).map(parseFloat);
      if (w && h) ai.view = {w, h};
    }
  },

  start() {
    // check explicitly as the cursor may have moved into an iframe so mouseout wasn't reported
    if (!ai.node.closest(':hover')) {
      App.deactivate();
      return;
    }
    App.updateStyles();
    if (ai.gallery)
      App.startGallery();
    else
      App.startSingle();
  },

  startSingle() {
    Status.loading();
    ai.imageUrl = null;
    if (ai.rule.follow && !ai.rule.q && !ai.rule.s) {
      Remoting.findRedirect();
    } else if (ai.rule.q && !Array.isArray(ai.urls)) {
      App.startFromQ();
    } else {
      Popup.create(ai.url);
      Ruler.runC();
    }
  },

  async startFromQ() {
    try {
      const {responseText, doc, finalUrl} = await Remoting.getDoc(ai.url);
      const url = Ruler.runQ(responseText, doc, finalUrl);
      if (!url)
        throw 'The "q" rule did not produce any URL.';
      if (RuleMatcher.isFollowableUrl(url, ai.rule)) {
        const info = RuleMatcher.find(url, ai.node, {noHtml: true});
        if (!info || !info.url)
          throw `Couldn't follow URL: ${url}`;
        Object.assign(ai, info);
        App.startSingle();
      } else {
        Popup.create(url, finalUrl);
        Ruler.runC(responseText, doc);
      }
    } catch (e) {
      App.handleError(e);
    }
  },

  async startGallery() {
    Status.loading();
    try {
      const startUrl = ai.url;
      const p = ai.rule.s === 'gallery' ? {} : await Remoting.getDoc(startUrl);
      const items = await new Promise(resolve => {
        const it = ai.gallery(p.responseText, p.doc, p.finalUrl, ai.match, ai.rule, resolve);
        if (Array.isArray(it))
          resolve(it);
      });
      // bail out if the gallery's async callback took too long
      if (ai.url !== startUrl) return;
      ai.gNum = items.length;
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
  },

  stopTimers() {
    for (const timer of ['timer', 'timerBar', 'timerStatus'])
      clearTimeout(ai[timer]);
    clearInterval(ai.timerProgress);
  },

  toggleZoom({keepScale} = {}) {
    const p = ai.popup;
    if (!p || !ai.scales || ai.scales.length < 2)
      return;
    ai.zoomed = !ai.zoomed;
    ai.scale = ai.zoomed && Calc.scaleForFirstZoom(keepScale) || ai.scales[0];
    if (ai.zooming)
      p.classList.add(`${PREFIX}zooming`);
    Popup.move();
    Bar.updateDetails();
    Status.set(ai.zoomed ? 'zoom' : false);
    return ai.zoomed;
  },

  updateStyles() {
    Util.addStyle('global',
      (App.globalStyle || createGlobalStyle()) +
      (cfg.css.includes('{') ? cfg.css : `#${PREFIX}-popup {${(cfg.css)}}`));
    Util.addStyle('rule', ai.rule.css || '');
  },
};

const Bar = {

  set(label, className) {
    let b = ai.bar;
    if (typeof label !== 'string') {
      $remove(b);
      ai.bar = null;
      return;
    }
    if (!b) b = ai.bar = $create('div', {id: `${PREFIX}bar`});
    App.updateStyles();
    Bar.updateDetails();
    Bar.show();
    b.innerHTML = label;
    if (!b.parentNode) {
      doc.body.appendChild(b);
      Util.forceLayout(b);
    }
    b.className = `${PREFIX}show ${PREFIX}${className}`;
  },

  show() {
    clearTimeout(ai.timerBar);
    ai.bar.style.removeProperty('opacity');
    ai.timerBar = setTimeout(() => ai.bar && $css(ai.bar, {opacity: 0}), 3000);
  },

  updateName() {
    const {gItems: gi, gIndex: i, gNum: n} = ai;
    if (gi) {
      const item = gi[i];
      const noDesc = !gi.some(_ => _.desc);
      const c = `${n > 1 ? `[${i + 1}/${n}] ` : ''}${[
        gi.title && (!i || noDesc) && !`${item.desc || ''}`.includes(gi.title) && gi.title || '',
        item.desc,
      ].filter(Boolean).join(' - ')}`;
      Bar.set(c.trim() || ' ', 'gallery', true);
    } else if ('caption' in ai) {
      Bar.set(ai.caption, 'caption');
    } else if (ai.tooltip) {
      Bar.set(ai.tooltip.text, 'tooltip');
    } else {
      Bar.set(' ', 'info');
    }
  },

  updateDetails() {
    if (!ai.bar) return;
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
      Bar.show();
    }
  },
};

const Calc = {

  frameSize(elFrame, parentWindow) {
    if (!elFrame) return;
    const r = elFrame.getBoundingClientRect();
    const w = clamp(r.width, 0, parentWindow.innerWidth - r.left);
    const h = clamp(r.height, 0, parentWindow.innerHeight - r.top);
    return [w, h];
  },

  generateScales(fit) {
    let [scale, goal] = fit < 1 ? [fit, 1] : [1, fit];
    const zoomStep = cfg.zoomStep / 100;
    const arr = [scale];
    if (fit !== 1) {
      const diff = goal / scale;
      const steps = Math.log(diff) / Math.log(zoomStep) | 0;
      const step = steps && Math.pow(diff, 1 / steps);
      for (let i = steps; --i > 0;)
        arr.push((scale *= step));
      arr.push(scale = goal);
    }
    while ((scale *= zoomStep) <= ZOOM_MAX)
      arr.push(scale);
    return arr;
  },

  naturalSize() {
    let {popup: p, nwidth: nw, nheight: nh} = ai;
    // overriding custom CSS to detect an unrestricted SVG that scales to the entire page
    p.setAttribute('style', 'display:inline !important;' + App.popupStyleBase);
    if (p.clientWidth > nw) {
      const w = clamp(p.clientWidth, nw, innerWidth / 2) | 0;
      nh = ai.nheight = w / nw * nh | 0;
      nw = ai.nwidth = w;
      p.style.cssText = `width: ${nw}px !important; height: ${nh}px !important;`;
    }
  },

  rect() {
    let {node, rule} = ai;
    let n = rule.rect && node.closest(rule.rect);
    if (n) return n.getBoundingClientRect();
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
  },

  placement() {
    if (!ai.popup) return;
    let x, y;
    const {cx, cy, extras, view} = ai;
    const vw = view.w - extras.outw;
    const vh = view.h - extras.outh;
    const w = ai.scale * ai.nwidth + extras.inw;
    const h = ai.scale * ai.nheight + extras.inh;
    if (!ai.zoomed && ai.gNum < 2 && !cfg.center) {
      const r = ai.rect;
      const rx = (r.left + r.right) / 2;
      const ry = (r.top + r.bottom) / 2;
      if (vw - r.right - 40 > w || w < r.left - 40) {
        if (h < vh - 60)
          y = clamp(ry - h / 2, 30, vh - h - 30);
        x = rx > vw / 2 ? r.left - 40 - w : r.right + 40;
      } else if (vh - r.bottom - 40 > h || h < r.top - 40) {
        if (w < vw - 60)
          x = clamp(rx - w / 2, 30, vw - w - 30);
        y = ry > vh / 2 ? r.top - 40 - h : r.bottom + 40;
      }
    }
    if (x == null)
      x = (vw - w) * (vw > w ? .5 : clamp(5 / 3 * (cx / vw - .2), 0, 1));
    if (y == null)
      y = (vh - h) * (vh > h ? .5 : clamp(5 / 3 * (cy / vh - .2), 0, 1));
    return {
      x: Math.round(x + extras.o),
      y: Math.round(y + extras.o),
      w: Math.round(w),
      h: Math.round(h),
    };
  },

  scaleBiggerThan(scale, i, arr) {
    return scale >= this && (!i || Math.abs(scale - arr[i - 1]) > .01);
  },

  scaleIndex(dir) {
    const i = ai.scales.indexOf(ai.scale);
    if (i >= 0) return i + dir;
    for (
      let len = ai.scales.length,
        i = dir > 0 ? 0 : len - 1;
      i >= 0 && i < len;
      i += dir
    ) {
      if (Math.sign(ai.scales[i] - ai.scale) === dir)
        return i;
    }
    return -1;
  },

  scaleForFirstZoom(keepScale) {
    const z = ai.scaleZoom;
    return keepScale || z !== ai.scale ? z : ai.scales.find(x => x > z);
  },

  scaleGain(url, parent) {
    const imgs = $$('img, video', parent);
    for (let i = imgs.length, img; (img = imgs[--i]);) {
      if ((img.currentSrc || img.src) !== url || img.sizes)
        continue;
      const scaleX = (img.naturalWidth || img.videoWidth) / img.offsetWidth;
      const scaleY = (img.naturalHeight || img.videoHeight) / img.offsetHeight;
      const s = Math.max(scaleX, scaleY);
      if (isFinite(s))
        return s;
    }
  },

  updateExtras() {
    const s = getComputedStyle(ai.popup);
    const o2 = sumProps(s.outlineOffset, s.outlineWidth) * 2;
    const inw = sumProps(s.paddingLeft, s.paddingRight, s.borderLeftWidth, s.borderRightWidth);
    const inh = sumProps(s.paddingTop, s.paddingBottom, s.borderTopWidth, s.borderBottomWidth);
    const outw = o2 + sumProps(s.marginLeft, s.marginRight);
    const outh = o2 + sumProps(s.marginTop, s.marginBottom);
    ai.extras = {
      inw, inh,
      outw, outh,
      o: o2 / 2,
      w: inw + outw,
      h: inh + outh,
    };
  },

  updateScales() {
    const fit = Math.min(
      (ai.view.w - ai.extras.w) / ai.nwidth,
      (ai.view.h - ai.extras.h) / ai.nheight) || 1;
    const isCustom = !cfg.fit && cfg.scales.length;
    let cutoff = Math.min(1, fit);
    let scaleZoom = cfg.fit === 'all' && fit || cfg.fit === 'no' && 1 || cutoff;
    if (isCustom) {
      const dst = [];
      for (const scale of cfg.scales) {
        const val = parseFloat(scale) || fit;
        dst.push(val);
        if (isCustom && typeof scale === 'string') {
          if (scale.includes('!')) cutoff = val;
          if (scale.includes('*')) scaleZoom = val;
        }
      }
      ai.scales = dst.sort(compareNumbers).filter(Calc.scaleBiggerThan, cutoff);
    } else {
      ai.scales = Calc.generateScales(fit);
    }
    ai.scale = cfg.zoom === 'auto' ? scaleZoom : Math.min(1, fit);
    ai.scaleFit = fit;
    ai.scaleZoom = scaleZoom;
  },

  updateViewSize() {
    const view = doc.compatMode === 'BackCompat' ? doc.body : doc.documentElement;
    ai.view = {
      w: view.clientWidth,
      h: view.clientHeight,
    };
    if (window === top) return;
    const [w, h] = Calc.frameSize(frameElement, parent) || [];
    if (w && h) {
      ai.view = {w, h};
    } else {
      window.addEventListener('message', App.onMessageChild);
      parent.postMessage(MSG.getViewSize, '*');
    }
  },
};

class Config {

  constructor({data: c = GM_getValue('cfg'), save}) {
    if (typeof c === 'string')
      c = tryCatch(JSON.parse, c);
    if (typeof c !== 'object' || !c)
      c = {};
    const {DEFAULTS} = Config;
    c.fit = ['all', 'large', 'no', ''].includes(c.fit) ? c.fit :
      !(c.scales || 0).length || `${c.scales}` === `${DEFAULTS.scales}` ? 'large' :
        '';
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
        GM_setValue('cfg', c);
    }
    if (Object.keys(cfg || {}).some(k => /^ui|^(css|globalStatus)$/.test(k) && cfg[k] !== c[k]))
      App.globalStyle = '';
    if (!Array.isArray(c.scales))
      c.scales = [];
    c.scales = [...new Set(c.scales)].sort((a, b) => parseFloat(a) - parseFloat(b));
    Object.assign(this, DEFAULTS, c);
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
  scales: ['0!', 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 8, 16],
  start: 'auto',
  uiBackgroundColor: '#ffffff',
  uiBackgroundOpacity: 100,
  uiBorderColor: '#000000',
  uiBorderOpacity: 100,
  uiBorder: 0,
  uiShadowColor: '#000000',
  uiShadowOpacity: 80,
  uiShadow: 20,
  uiPadding: 0,
  uiMargin: 0,
  version: 6,
  xhr: true,
  zoom: 'context',
  zoomOut: 'auto',
  zoomStep: 133,
});

const Events = {

  hoverData: [],
  hoverTimer: 0,

  onMouseOver(e) {
    if (!App.enabled || e.shiftKey || ai.zoomed)
      return;
    let node = e.target;
    if (node === ai.popup ||
        node === doc.body ||
        node === doc.documentElement ||
        node === elConfig ||
        ai.gallery && ai.rectHovered)
      return;
    if (node.shadowRoot)
      node = Events.pierceShadow(node, e.clientX, e.clientY);
    // we don't want to process everything in the path of a quickly moving mouse cursor
    Events.hoverData = [now(), e, node];
    Events.hoverTimer = Events.hoverTimer || setTimeout(Events.onMouseOverThrottled, SETTLE_TIME);
  },

  onMouseOverThrottled() {
    const [start, e, node] = Events.hoverData;
    // clearTimeout + setTimeout is expensive so we'll use the cheaper perf.now() for rescheduling
    const wait = start + SETTLE_TIME - now();
    Events.hoverTimer = wait > 10 && setTimeout(Events.onMouseOverThrottled, wait);
    if (Events.hoverTimer)
      return;
    if (!node.closest(':hover'))
      return;
    if (!Ruler.rules)
      Ruler.init();
    let a;
    const tag = node.tagName;
    const src = node.currentSrc || node.src;
    const isPic = tag === 'IMG' || tag === 'VIDEO' && /\.(webm|mp4)(\?|$)/.test(src);
    const info =
      // note that data URLs aren't passed to rules as those may have fatally ineffective regexps
      tag !== 'A' &&
        RuleMatcher.find(isPic && !src.startsWith('data:') && Util.rel2abs(src), node) ||
      (a = node.closest('A')) &&
        RuleMatcher.findForLink(a) ||
      isPic &&
        {node, rule: {}, url: src};
    if (info && info.url && info.node !== ai.node)
      App.activate(info, e);
  },

  onMouseOut(e) {
    if (!e.relatedTarget && !e.shiftKey)
      App.deactivate();
  },

  onMouseOutShadow(e) {
    const root = e.target.shadowRoot;
    if (root) {
      root.removeEventListener('mouseover', Events.onMouseOver);
      root.removeEventListener('mouseout', Events.onMouseOutShadow);
    }
  },

  onMouseMove(e) {
    Events.trackMouse(e);
    if (e.shiftKey) {
      ai.lazyUnload = true;
    } else if (!ai.zoomed && !ai.rectHovered) {
      App.deactivate();
    } else if (ai.zoomed) {
      Popup.move();
      const {cx, cy, view: {w, h}} = ai;
      const bx = w / 6;
      const by = h / 6;
      const onEdge = cx < bx || cx > w - bx || cy < by || cy > h - by;
      Status.set(`${onEdge ? '+' : '-'}edge`);
    }
  },

  onMouseDown({shiftKey, button}) {
    if (button === 0 && shiftKey && ai.popup && ai.popup.controls) {
      ai.controlled = ai.zoomed = true;
    } else if (button === 2 || shiftKey) {
      // we ignore RMB and Shift
    } else {
      App.deactivate({wait: true});
      document.addEventListener('mouseup', App.enable, {once: true});
    }
  },

  onMouseScroll(e) {
    const dir = (e.deltaY || -e.wheelDelta) < 0 ? 1 : -1;
    if (ai.zoomed) {
      Events.zoomInOut(dir);
    } else if (ai.gNum > 1 && ai.popup) {
      Gallery.next(-dir);
    } else if (cfg.zoom === 'wheel' && dir > 0 && ai.popup) {
      App.toggleZoom();
    } else {
      App.deactivate();
      return;
    }
    dropEvent(e);
  },

  onKeyDown(e) {
    switch (e.key) {
      case 'Shift':
        Status.set('+shift');
        if (ai.popup && 'controls' in ai.popup)
          ai.popup.controls = true;
        break;
      case 'Control':
        if (!ai.popup && (cfg.start !== 'auto' || ai.rule.manual))
          App.start();
        break;
    }
  },

  onKeyUp(e) {
    switch (e.key.length > 1 ? e.key : e.code) {
      case 'Shift':
        Status.set('-shift');
        if ((ai.popup || {}).controls)
          ai.popup.controls = false;
        if (ai.controlled) {
          ai.controlled = false;
          return;
        }
        if (ai.popup && (ai.zoomed || ai.rectHovered !== false))
          App.toggleZoom();
        else
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
        GM_openInTab(Util.tabFixUrl() || ai.popup.src);
        App.deactivate();
        break;
      default:
        App.deactivate({wait: true});
    }
  },

  onContext(e) {
    if (e.shiftKey) return;
    if (cfg.zoom === 'context' && ai.popup && App.toggleZoom()) {
      dropEvent(e);
    } else if (!ai.popup && (cfg.start === 'context' || (cfg.start === 'auto' && ai.rule.manual))) {
      App.start();
      dropEvent(e);
    } else {
      setTimeout(App.deactivate, SETTLE_TIME, {wait: true});
    }
  },

  pierceShadow(node, x, y) {
    for (let root; (root = node.shadowRoot);) {
      root.addEventListener('mouseover', Events.onMouseOver, {passive: true});
      root.addEventListener('mouseout', Events.onMouseOutShadow);
      const inner = root.elementFromPoint(x, y);
      if (!inner || inner === node)
        break;
      node = inner;
    }
    return node;
  },

  toggle(enable) {
    const onOff = enable ? doc.addEventListener : doc.removeEventListener;
    const passive = enable ? {passive: true} : undefined;
    onOff.call(doc, 'mousemove', Events.onMouseMove, passive);
    onOff.call(doc, 'mouseout', Events.onMouseOut, passive);
    onOff.call(doc, 'mousedown', Events.onMouseDown, passive);
    onOff.call(doc, 'contextmenu', Events.onContext);
    onOff.call(doc, 'keydown', Events.onKeyDown);
    onOff.call(doc, 'keyup', Events.onKeyUp);
    onOff.call(doc, WHEEL_EVENT, Events.onMouseScroll, enable ? {passive: false} : undefined);
  },

  trackMouse(e) {
    const cx = ai.cx = e.clientX;
    const cy = ai.cy = e.clientY;
    const r = ai.rect || (ai.rect = Calc.rect());
    ai.rectHovered =
      cx > r.left - 2 && cx < r.right + 2 &&
      cy > r.top - 2 && cy < r.bottom + 2;
  },

  zoomInOut(dir) {
    const i = Calc.scaleIndex(dir);
    const n = ai.scales.length;
    if (i >= 0 && i < n)
      ai.scale = ai.scales[i];
    const zo = cfg.zoomOut;
    if (i <= 0 && zo !== 'stay') {
      if (ai.scaleFit < ai.scale * .99) {
        ai.scales.unshift(ai.scale = ai.scaleFit);
      } else if ((i <= 0 && zo === 'close' || i < 0 && !ai.rectHovered) && ai.gNum < 2) {
        App.deactivate({wait: true});
        return;
      }
      ai.zoomed = false;
    } else {
      ai.popup.classList.toggle(`${PREFIX}zoom-max`, ai.scale >= 4 && i >= n - 1);
    }
    if (ai.zooming)
      ai.popup.classList.add(`${PREFIX}zooming`);
    Popup.move();
    Bar.updateDetails();
  },
};

const Gallery = {

  makeParser(g) {
    return (
      typeof g === 'function' ? g :
        typeof g === 'string' ? Util.newFunction('text', 'doc', 'url', 'm', 'rule', 'cb', g) :
          Gallery.defaultParser
    );
  },

  findIndex(gUrl) {
    const sel = gUrl.split('#')[1];
    if (!sel)
      return 0;
    if (/^\d+$/.test(sel))
      return parseInt(sel);
    for (let i = ai.gNum; i--;) {
      let {url} = ai.gItems[i];
      if (Array.isArray(url))
        url = url[0];
      if (url.indexOf(sel, url.lastIndexOf('/')) > 0)
        return i;
    }
    return 0;
  },

  next(dir) {
    if (dir) ai.gIndex = Gallery.nextIndex(dir);
    const item = ai.gItems[ai.gIndex];
    if (Array.isArray(item.url)) {
      ai.urls = item.url.slice(1);
      ai.url = item.url[0];
    } else {
      ai.urls = null;
      ai.url = item.url;
    }
    Popup.destroy();
    App.startSingle();
    Bar.updateName();
    Gallery.preload(dir);
  },

  nextIndex(dir) {
    return (ai.gIndex + dir + ai.gNum) % ai.gNum;
  },

  preload(dir) {
    if (!ai.popup || !dir) return;
    ai.preloadUrl = ensureArray(ai.gItems[Gallery.nextIndex(dir)].url)[0];
    ai.popup.addEventListener('load', Gallery.preloadOnLoad, {once: true});
  },

  preloadOnLoad() {
    $create('img', {src: ai.preloadUrl});
  },

  defaultParser(text, doc, docUrl, m, rule) {
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
  },
};

const Popup = {

  async create(src, pageUrl) {
    Popup.destroy();
    ai.imageUrl = src;
    if (ai.xhr && src)
      src = await Remoting.getImage(src, pageUrl).catch(App.handleError);
    if (!src) return;
    const isVideo = Util.isVideoUrl(src);
    const p = ai.popup = isVideo ? PopupVideo.create() : $create('img');
    p.id = `${PREFIX}popup`;
    p.src = src;
    p.addEventListener('error', App.handleError);
    if (ai.zooming)
      p.addEventListener('transitionend', Popup.onZoom);
    doc.body.insertBefore(p, ai.bar || undefined);
    await 0;
    App.checkProgress({start: true});
    if (p.complete)
      Popup.onLoad.call(ai.popup);
    else if (!isVideo)
      p.addEventListener('load', Popup.onLoad, {once: true});
  },

  destroy() {
    const p = ai.popup;
    if (!p) return;
    p.removeEventListener('error', App.handleError);
    if (typeof p.pause === 'function')
      p.pause();
    if (!ai.lazyUnload) {
      if (p.src.startsWith('blob:'))
        URL.revokeObjectURL(p.src);
    }
    p.remove();
    ai.zoomed = ai.popup = ai.popupLoaded = null;
  },

  move() {
    const p = Calc.placement();
    $css(ai.popup, {
      transform: `translate(${p.x}px, ${p.y}px)`,
      width: `${p.w}px`,
      height: `${p.h}px`,
    });
  },

  onLoad() {
    this.setAttribute('loaded', '');
    ai.popupLoaded = true;
  },

  onZoom() {
    this.classList.remove(`${PREFIX}zooming`);
  },
};

const PopupVideo = {
  create() {
    ai.bufBar = false;
    ai.bufStart = now();
    const shouldMute = new AudioContext().state === 'suspended';
    return $create('video', {
      autoplay: true,
      controls: shouldMute,
      muted: shouldMute,
      loop: true,
      volume: clamp(+GM_getValue('volume') || .5, 0, 1),
      onprogress: PopupVideo.progress,
      oncanplaythrough: PopupVideo.progressDone,
      onvolumechange: PopupVideo.rememberVolume,
    });
  },

  progress() {
    const {duration} = this;
    if (duration && this.buffered.length && now() - ai.bufStart > 2000) {
      const pct = Math.round(this.buffered.end(0) / duration * 100);
      if ((ai.bufBar |= pct > 0 && pct < 50))
        Bar.set(`${pct}% of ${Math.round(duration)}s`, 'xhr');
    }
  },

  progressDone() {
    this.onprogress = this.oncanplaythrough = null;
    if (ai.bar && ai.bar.classList.contains(`${PREFIX}xhr`))
      Bar.set(false);
    Popup.onLoad.call(this);
  },

  rememberVolume() {
    GM_setValue('volume', this.volume);
  },
};

const Ruler = {
/*
 'u' works only with URLs so it's ignored if 'html' is true
   ||some.domain = matches some.domain, anything.some.domain, etc.
   |foo = url or text must start with foo
   ^ = separator like / or ? or : but not a letter/number, not %._-
       when used at the end like "foo^" it additionally matches when the source ends with "foo"
 'r' is checked only if 'u' matches first
*/
  init() {
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
        e: 'a[href*="imgres?imgurl="] img',
        s: (m, node) => new URLSearchParams(node.closest('a').search).get('imgurl'),
        follow: true,
      },
      isGoogleImages && {
        e: '[data-tbnid] a:not([href])',
        s: (m, a) => {
          const a2 = $('a[jsaction*="mousedown"]', a.closest('[data-tbnid]')) || a;
          new MutationObserver((_, mo) => {
            mo.disconnect();
            App.enabled = true;
            a.alt = a2.innerText;
            const {left, top} = a.getBoundingClientRect();
            Events.onMouseOver({target: $('img', a), clientX: left, clientY: top});
          }).observe(a, {attributes: true, attributeFilter: ['href']});
          a2.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
        },
      },
      dotDomain.endsWith('.instagram.com') && {
        e: [
          'a[href*="/p/"]',
          'article [role="button"][tabindex="0"], article [role="button"][tabindex="0"] div',
        ],
        s: (m, node, rule) => {
          let data, a, n, img, src;
          if (location.pathname.startsWith('/p/')) {
            img = $('img[srcset], video', node.parentNode);
            if (img && (img.localName === 'video' || parseFloat(img.sizes) > 900))
              src = (img.srcset || img.currentSrc).split(',').pop().split(' ')[0];
          }
          if (!src && (n = node.closest('a[href*="/p/"], article'))) {
            a = n.tagName === 'A' ? n : $('a[href*="/p/"]', n);
            data = a && tryCatch(this._getEdge, a.pathname.split('/')[2]);
          }
          rule.q = data && data.is_video && !data.video_url && 'meta[property="og:video"]';
          rule.g = a && $('[class*="Carousel"]', a) && rule._g;
          rule.follow = !data && !rule.g;
          rule._data = data;
          rule._img = img;
          return (
            !a && !src ? false :
              !data || rule.q || rule.g ? `${src || a.href}${rule.g ? '?__a=1' : ''}` :
                data.video_url || data.display_url);
        },
        c: (html, doc, node, rule) =>
          tryCatch(rule._getCaption, rule._data) || (rule._img || 0).alt || '',
        anonymous: true,
        follow: true,
        _g(text, doc, url, m, rule) {
          const media = JSON.parse(text).graphql.shortcode_media;
          const items = media.edge_sidecar_to_children.edges.map(e => ({
            url: e.node.video_url || e.node.display_url,
          }));
          items.title = tryCatch(rule._getCaption, media) || '';
          return items;
        },
        _getCaption: data => data && data.edge_media_to_caption.edges[0].node.text,
        _getEdge: shortcode => unsafeWindow._sharedData.entry_data.ProfilePage[0].graphql.user
            .edge_owner_to_timeline_media.edges.find(e => e.node.shortcode === shortcode).node,
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
            if (a) return a.href.includes(m.input.match(/[0-9]+_[0-9]+_[0-9]+/)[0]) ? '' : a.href;
          }
          if (m[4])
            return false;
          const pn = node.parentNode;
          if (pn.outerHTML.includes('/hovercard/'))
            return '';
          if (node.outerHTML.includes('profile') && pn.parentNode.href.includes('/photo'))
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
          if (images && info.is_album && !`${items[0].desc || ''}`.includes(info.title))
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
        r: /^[^?]+?\.(bmp|jpe?g?|gif|mp4|png|svg|web[mp])($|\?)/i,
      },
    ];

    /** @type mpiv.HostRule[] */
    Ruler.rules = [].concat(customRules, disablers, perDomain, main).filter(Boolean);
  },

  format(rule, {expand} = {}) {
    const s = JSON.stringify(rule, null, ' ');
    return expand ?
      /* {"a": ...,
          "b": ...,
          "c": ...
         } */
      s.replace(/^{\s+/g, '{') :
      /* {"a": ..., "b": ..., "c": ...} */
      s.replace(/\n\s*/g, ' ').replace(/^({)\s|\s+(})$/g, '$1$2');
  },

  /** @returns mpiv.HostRule | Error | false | undefined */
  parse(rule) {
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
  },

  runC(text, doc = document) {
    const fn = Ruler.runCHandler[typeof ai.rule.c] || Ruler.runCHandler.default;
    ai.caption = fn(text, doc);
  },

  runCHandler: {
    function: (text, doc) => {
      // not specifying as a parameter's default value to get the html only when needed
      if (!text) text = doc.documentElement.outerHTML;
      return ai.rule.c(text, doc, ai.node, ai.rule);
    },
    string: (text, doc) => {
      const el = $many(ai.rule.c, doc);
      return !el ? '' :
        el.getAttribute('content') ||
        el.getAttribute('title') ||
        el.textContent;
    },
    default: () =>
      (ai.tooltip || 0).text ||
      ai.node.alt ||
      $propUp(ai.node, 'title') ||
      Remoting.getFileName(
        ai.node.tagName === ai.popup.tagName
          ? ai.url
          : ai.node.src || $propUp(ai.node, 'href')),
  },

  runQ(text, doc, docUrl) {
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
  },

  runS(node, rule, m) {
    let urls = [];
    for (const s of ensureArray(rule.s))
      urls.push(
        typeof s === 'string' ? Util.decodeUrl(Ruler.substituteSingle(s, m)) :
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
    return urls[0] === false ? {skipRule: true} : urls.map(Util.decodeUrl);
  },

  substituteSingle(s, m) {
    if (!m) return s;
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
  },
};

const RuleMatcher = {

  /** @returns ?mpiv.RuleMatchInfo */
  findForLink(a) {
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
  },

  /** @returns ?mpiv.RuleMatchInfo */
  find(url, node, {noHtml, skipRules} = {}) {
    const tn = node.tagName;
    const isPic = tn === 'IMG' || tn === 'VIDEO';
    const isPicOrLink = isPic || tn === 'A';
    let m, html, urls;
    for (const rule of Ruler.rules) {
      const {e} = rule;
      if (e && !node.matches(e) || skipRules && skipRules.includes(rule))
        continue;
      const {r, u} = rule;
      if (r && !noHtml && rule.html && (isPicOrLink || e))
        m = r.exec(html || (html = node.outerHTML));
      else if (r || u)
        m = url && RuleMatcher.makeUrlMatch(url, node, rule, r, u);
      else
        m = url ? RuleMatcher.makeDummyMatch(url) : [];
      if (!m)
        continue;
      const {s} = rule;
      let hasS = s !== undefined;
      // a rule with follow:true for the currently hovered IMG produced a URL,
      // but we'll only allow it to match rules without 's' in the nested find call
      if (isPic && !hasS && !skipRules)
        continue;
      if (s === '')
        return {};
      hasS &= s !== 'gallery';
      urls = hasS ? Ruler.runS(node, rule, m) : [m.input];
      if (!urls.skipRule) {
        const url = urls[0];
        return !url ? {} :
          hasS && !rule.q && RuleMatcher.isFollowableUrl(url, rule) &&
            RuleMatcher.find(url, node, {skipRules: [...skipRules || [], rule]}) ||
            RuleMatcher.makeInfo(urls, node, rule, m);
      }
    }
  },

  makeUrlMatch(url, node, rule, r, u) {
    let m;
    if (u) {
      u = rule._u || (rule._u = UrlMatcher(u));
      m = u.fn.call(u.this, url) && (r || RuleMatcher.makeDummyMatch(url));
    }
    return (m || !u) && r ? r.exec(url) : m;
  },

  makeDummyMatch(url) {
    const m = [url];
    m.index = 0;
    m.input = url;
    return m;
  },

  /** @returns mpiv.RuleMatchInfo */
  makeInfo(urls, node, rule, m) {
    const url = urls[0];
    const xhr = cfg.xhr && rule.xhr;
    const info = {
      node,
      rule,
      url,
      urls: urls.length > 1 ? urls.slice(1) : null,
      match: m,
      gallery: rule.g && Gallery.makeParser(rule.g),
      post: typeof rule.post === 'function' ? rule.post(m) : rule.post,
      xhr: xhr != null ? xhr : isSecureContext && !`${url}`.startsWith(location.protocol),
    };
    if (
      dotDomain.endsWith('.twitter.com') && !/(facebook|google|twimg|twitter)\.com\//.test(url) ||
      dotDomain.endsWith('.github.com') && !/github/.test(url) ||
      dotDomain.endsWith('.facebook.com') && /\bimgur\.com/.test(url)
    ) {
      info.xhr = 'data';
    }
    return info;
  },

  isFollowableUrl(url, rule) {
    const f = rule.follow;
    return typeof f === 'function' ? f(url) : f;
  },
};

const Remoting = {

  gmXhr(url, opts = {}) {
    if (ai.req)
      tryCatch.call(ai.req, ai.req.abort);
    return new Promise((resolve, reject) => {
      ai.req = GM_xmlhttpRequest({
        url,
        method: 'GET',
        anonymous: (ai.rule || {}).anonymous,
        timeout: 30e3,
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
        if (r.status < 400 && !r.error)
          resolve(r);
        else
          reject(`Server error ${r.status} ${r.error}\nURL: ${url}`);
      }
    });
  },

  async getDoc(url) {
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
  },

  async getImage(url, pageUrl) {
    ai.bufBar = false;
    ai.bufStart = now();
    const response = await Remoting.gmXhr(url, {
      responseType: 'blob',
      headers: {
        Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
        Referer: pageUrl || (typeof ai.xhr === 'function' ? ai.xhr() : url),
      },
      onprogress: Remoting.getImageProgress,
    });
    Bar.set(false);
    const type = Remoting.guessMimeType(response);
    let b = response.response;
    if (!b) throw 'Empty response';
    if (b.type !== type)
      b = b.slice(0, b.size, type);
    return ai.xhr === 'data' ?
      Remoting.blobToDataUrl(b) :
      URL.createObjectURL(b);
  },

  getImageProgress(e) {
    if (!ai.bufBar && now() - ai.bufStart > 3000 && e.loaded / e.total < 0.5)
      ai.bufBar = true;
    if (ai.bufBar) {
      const pct = e.loaded / e.total * 100 | 0;
      const size = e.total / 1024 | 0;
      Bar.set(`${pct}% of ${size} kiB`, 'xhr');
    }
  },

  async findRedirect() {
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
      App.startSingle();
    } catch (e) {
      App.handleError(e);
    }
  },

  async saveFile() {
    const url = ai.popup.src || ai.popup.currentSrc;
    let name = Remoting.getFileName(ai.imageUrl || url);
    if (!name.includes('.'))
      name += '.jpg';
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      $create('a', {href: url, download: name})
        .dispatchEvent(new MouseEvent('click'));
    } else {
      Status.set('+loading');
      GM_download({
        url,
        name,
        headers: {Referer: url},
        onerror: () => Bar.set(`Could not download ${name}.`, 'error'),
        onload: () => Status.set('-loading'),
        onprogress: Remoting.getImageProgress,
      });
    }
  },

  getFileName(url) {
    return decodeURIComponent(url).split('/').pop().replace(/[:#?].*/, '');
  },

  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  },

  guessMimeType({responseHeaders, finalUrl}) {
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
  },

  findImageUrl(n, url) {
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
  },
};

const Status = {

  set(status) {
    if (!status && !cfg.globalStatus) {
      ai.node && ai.node.removeAttribute(STATUS_ATTR);
      return;
    }
    const prefix = cfg.globalStatus ? PREFIX : '';
    const action = status && /^[+-]/.test(status) && status[0];
    const name = status && `${prefix}${action ? status.slice(1) : status}`;
    const el = cfg.globalStatus ? doc.documentElement :
      name === 'edge' ? ai.popup :
        ai.node;
    if (!el) return;
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
  },

  loading(force) {
    if (!force) {
      clearTimeout(ai.timerStatus);
      ai.timerStatus = setTimeout(Status.loading, SETTLE_TIME, true);
    } else if (!ai.popupLoaded) {
      Status.set('+loading');
    }
  },
};

const UrlMatcher = (() => {
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

const Util = {

  addStyle(name, css) {
    const id = `${PREFIX}style:${name}`;
    const el = doc.getElementById(id) ||
               css && $create('style', {id});
    if (!el) return;
    if (el.textContent !== css)
      el.textContent = css;
    if (el.parentElement !== doc.head)
      doc.head.appendChild(el);
    return el;
  },

  color(color, opacity = cfg[`ui${color}Opacity`]) {
    return (color.startsWith('#') ? color : cfg[`ui${color}Color`]) +
           (0x100 + Math.round(opacity / 100 * 255)).toString(16).slice(1);
  },

  decodeHtmlEntities(s) {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, '\'')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  },

  // decode only if the main part of the URL is encoded to preserve the encoded parameters
  decodeUrl(url) {
    if (!url) return url;
    const iPct = url.indexOf('%');
    const iColon = url.indexOf(':');
    return iPct >= 0 && (iPct < iColon || iColon < 0) ?
      decodeURIComponent(url) :
      url;
  },

  deepEqual(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof a !== typeof b)
      return a === b;
    if (Array.isArray(a)) {
      return Array.isArray(b) &&
        a.length === b.length &&
        a.every((v, i) => Util.deepEqual(v, b[i]));
    }
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
      keys.every(k => Util.deepEqual(a[k], b[k]));
  },

  forceLayout(node) {
    // eslint-disable-next-line no-unused-expressions
    node.clientHeight;
  },

  formatError(e, rule) {
    const message =
      e.message ||
      e.readyState && 'Request failed.' ||
      e.type === 'error' && `File can't be displayed.${
        $('div[bgactive*="flashblock"]', doc) ? ' Check Flashblock settings.' : ''
      }` ||
      e;
    const m = [
      [`${GM_info.script.name}: %c${message}%c`, 'font-weight:bold;color:yellow'],
      ['', 'font-weight:normal;color:unset'],
    ];
    m.push(...[
      ['Node: %o', ai.node],
      ['Rule: %o', rule],
      ai.url && ['URL: %s', ai.url],
      ai.imageUrl && ai.imageUrl !== ai.url && ['File: %s', ai.imageUrl],
    ].filter(Boolean));
    return {
      message,
      consoleFormat: m.map(([k]) => k).filter(Boolean).join('\n'),
      consoleArgs: m.map(([, v]) => v),
    };
  },

  isVideoUrl(url) {
    return url.startsWith('data:video') ||
           !url.startsWith('data:') && /\.(webm|mp4)($|\?)/.test(url);
  },

  newFunction(...args) {
    try {
      return App.NOP || new Function(...args);
    } catch (e) {
      if (!e.message.includes('unsafe-eval'))
        throw e;
      App.NOP = () => {};
      return App.NOP;
    }
  },

  rel2abs(rel, abs = location.href) {
    try {
      return rel.startsWith('data:') ? rel :
        rel.startsWith('blob:') ? '' : // blobs don't work because they're usually revoked
          new URL(rel, abs).href;
    } catch (e) {
      return rel;
    }
  },

  suppressTooltip() {
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
  },

  tabFixUrl() {
    return ai.rule.tabfix && ai.popup.tagName === 'IMG' && !ai.xhr &&
           navigator.userAgent.includes('Gecko/') &&
           flattenHtml(`data:text/html;charset=utf8,
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
    `).replace(/#/g, '%23');
  },
};

function setup({rule} = {}) {
  if (window !== top) return;
  const RULE = setup.RULE || (setup.RULE = Symbol('rule'));
  // FF is superslow with textareas, bugzil.la/190147
  let root = (elConfig || 0).shadowRoot;
  let {blankRuleElement} = setup;
  /** @type NodeList */
  const UI = new Proxy({}, {
    get(_, id) {
      return root.getElementById(id);
    },
  });
  if (!rule || !elConfig)
    init(new Config({save: true}));
  if (rule)
    installRule(rule);

  function closeSetup(event) {
    const isApply = this.id === 'apply';
    if (event && (this.id === 'ok' || isApply)) {
      cfg = collectConfig({save: true, clone: isApply});
      Ruler.init();
      if (isApply) {
        renderCustomScales(cfg);
        return;
      }
    }
    $remove(elConfig);
    elConfig = null;
  }

  function collectConfig({save, clone} = {}) {
    let data = {};
    for (const el of $$('input[id], select[id]', root))
      data[el.id] = el.type === 'checkbox' ? el.checked :
        (el.type === 'number' || el.type === 'range') ? el.valueAsNumber :
          el.value || '';
    Object.assign(data, {
      css: UI.css.value.trim(),
      delay: UI.delay.valueAsNumber * 1000,
      hosts: collectRules(),
      scale: Math.max(1, UI.scale.valueAsNumber || 0),
      scales: UI.scales.value
        .trim()
        .split(/[,;]*\s+/)
        .map(x => x.replace(',', '.'))
        .filter(x => !isNaN(parseFloat(x))),
    });
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
    const h = clamp(el.scrollHeight, 15, elConfig.clientHeight / 4);
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

  function init(config) {
    $remove(elConfig);
    elConfig = $create('div', {contentEditable: true});
    root = elConfig.attachShadow({mode: 'open'});
    root.innerHTML = createConfigHtml();
    initEvents();
    renderValues(config);
    renderCustomScales(config);
    initRules(config);
    doc.body.appendChild(elConfig);
    requestAnimationFrame(() => {
      UI.css.style.minHeight = clamp(UI.css.scrollHeight, 40, elConfig.clientHeight / 4) + 'px';
    });
  }

  function initEvents() {
    UI.apply.onclick = UI.cancel.onclick = UI.ok.onclick = UI.x.onclick = closeSetup;
    UI.export.onclick = exportSettings;
    UI.import.onclick = importSettings;
    UI.install.onclick = setupRuleInstaller;
    const {/** @type {HTMLTextAreaElement} */ cssApp} = UI;
    UI.reveal.onclick = e => {
      e.preventDefault();
      cssApp.hidden = !cssApp.hidden;
      if (!cssApp.hidden) {
        if (!cssApp.value) {
          App.updateStyles();
          cssApp.value = App.globalStyle.trim();
          cssApp.setSelectionRange(0, 0);
        }
        cssApp.focus();
      }
    };
    UI.start.onchange = function () {
      UI.delay.closest('label').hidden =
        UI.preload.closest('label').hidden =
          this.value !== 'auto';
    };
    UI.start.onchange();
    UI.xhr.onclick = ({target: el}) => el.checked || confirm($propUp(el, 'title'));
    // color
    for (const el of $$('[type="color"]', root)) {
      el.oninput = colorOnInput;
      el.elSwatch = el.nextElementSibling;
      el.elOpacity = UI[el.id.replace('Color', 'Opacity')];
      el.elOpacity.elColor = el;
    }
    function colorOnInput() {
      this.elSwatch.style.setProperty('--color',
        Util.color(this.value, this.elOpacity.valueAsNumber));
    }
    // range
    for (const el of $$('[type="range"]', root)) {
      el.oninput = rangeOnInput;
      el.onblur = rangeOnBlur;
      el.addEventListener('focusin', rangeOnFocus);
    }
    function rangeOnBlur(e) {
      if (this.elEdit && e.relatedTarget !== this.elEdit)
        this.elEdit.onblur(e);
    }
    function rangeOnFocus() {
      if (this.elEdit) return;
      const {min, max, step, value} = this;
      this.elEdit = $create('input', {
        value, min, max, step,
        className: 'range-edit',
        style: `left: ${this.offsetLeft}px; margin-top: ${this.offsetHeight + 1}px`,
        type: 'number',
        elRange: this,
        onblur: rangeEditOnBlur,
        oninput: rangeEditOnInput,
      });
      this.insertAdjacentElement('afterend', this.elEdit);
    }
    function rangeOnInput() {
      this.title = (this.dataset.title || '').replace('$', this.value);
      if (this.elColor) this.elColor.oninput();
      if (this.elEdit) this.elEdit.valueAsNumber = this.valueAsNumber;
    }
    // range-edit
    function rangeEditOnBlur(e) {
      if (e.relatedTarget !== this.elRange) {
        this.remove();
        this.elRange.elEdit = null;
      }
    }
    function rangeEditOnInput() {
      this.elRange.valueAsNumber = this.valueAsNumber;
      this.elRange.oninput();
    }
    // prevent the main page from interpreting key presses in inputs as hotkeys
    // which may happen since it sees only the outer <div> in the event |target|
    root.addEventListener('keydown', e => !e.altKey && !e.metaKey && e.stopPropagation(), true);
  }

  function initRules(config) {
    const rules = UI.rules;
    rules.addEventListener('input', checkRule);
    if (!isFF) rules.addEventListener('focusin', focusRule);
    if (!isFF) rules.addEventListener('paste', focusRule);
    blankRuleElement =
      setup.blankRuleElement =
        setup.blankRuleElement || rules.firstElementChild.cloneNode();
    for (const rule of config.hosts || []) {
      const el = blankRuleElement.cloneNode();
      el.value = typeof rule === 'string' ? rule : Ruler.format(rule);
      rules.appendChild(el);
      checkRule({target: el});
    }
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
  }

  function renderCustomScales(config) {
    UI.scales.value = config.scales.join(' ').trim() || Config.DEFAULTS.scales.join(' ');
  }

  function renderValues(config) {
    for (const el of $$('input[id], select[id], textarea[id]', root))
      if (el.id in config)
        el[el.type === 'checkbox' ? 'checked' : 'value'] = config[el.id];
    for (const el of $$('input[type="range"]', root))
      el.oninput();
    for (const el of $$('a[href^="http"]', root))
      Object.assign(el, {target: '_blank', rel: 'noreferrer noopener external'});
    UI.delay.value = config.delay / 1000;
  }
}

async function setupRuleInstaller(e) {
  dropEvent(e);
  const parent = this.parentElement;
  parent.children.installLoading.hidden = false;
  this.remove();
  let rules;

  try {
    rules = extractRules(await Remoting.getDoc(this.href));
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
    requestAnimationFrame(() => {
      const optY = selector.selectedOptions[0].offsetTop - selector.offsetTop;
      selector.scrollTo(0, optY - selector.offsetHeight / 2);
    });
  } catch (e) {
    parent.textContent = 'Error loading rules: ' + (e.message || e);
  }

  function extractRules({doc}) {
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
    const dottedHost = `.${hostname}.`;
    const weighParts = (n, part) => n + (dottedHost.includes(`.${part}.`) && part.length);
    const weighName = name => name.toLowerCase().split(/[^a-z\d.-]+/i).reduce(weighParts, 0);
    return rules.reduce((max, {d, name}, index) => {
      const count = !!(d && hostname.includes(d)) * 10 + weighName(name);
      return count > max.count ? {count, index} : max;
    }, {count: 0, index: 0}).index;
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
    if (!modKeyPressed(e))
      setup({rule: rules[e.currentTarget.selectedIndex]});
  }
}

function createConfigHtml() {
  const MPIV_BASE_URL = 'https://w9p.co/userscripts/mpiv/';
  const scalesHint = 'Leave it empty and click Apply or Save to restore the default values.';
  const trimLeft = s => s.trim().replace(/\n\s+/g, '\r');
  return flattenHtml(`
<style>
  :host {
    all: initial !important;
    position: fixed !important;
    z-index: 2147483647 !important;
    top: 20px !important;
    right: 20px !important;
    padding: 1.5em !important;
    color: #000 !important;
    background: #eee !important;
    box-shadow: 5px 5px 25px 2px #000 !important;
    width: 32em !important;
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
  li.stretch label {
    flex: 1;
    white-space: nowrap;
  }
  li.stretch label > span {
    display: flex;
    flex-direction: row;
    flex: 1;
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
  input[type=checkbox] {
    margin-left: 0;
  }
  input[type=number] {
    width: 4em;
  }
  input:not([type=checkbox])  {
    padding: 0 .25em;
  }
  input[type=range] {
    flex: 1;
    width: 100%;
    margin: 0 .25em;
    padding: 0;
    filter: saturate(0);
    opacity: .5;
  }
  u + input[type=range] {
    max-width: 3em;
  }
  input[type=range]:hover {
    filter: none;
    opacity: 1;
  }
  input[type=color] {
    position: absolute;
    width: calc(1.5em + 2px);
    opacity: 0;
    cursor: pointer;
  }
  u {
    display: inline-block;
    position: relative;
    width: 1.5em;
    height: 1.5em;
    border: 1px solid #888;
    pointer-events: none;
    color: #888;
    background-image:
      linear-gradient(45deg, currentColor 25%, transparent 25%, transparent 75%, currentColor 75%),
      linear-gradient(45deg, currentColor 25%, transparent 25%, transparent 75%, currentColor 75%);
    background-size: .5em .5em;
    background-position: 0 0, .25em .25em;
  }
  u::after {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    content: "";
    background-color: var(--color);
  }
  .range-edit {
    position: absolute;
    box-shadow: 0 0.25em 1em #000;
    z-index: 99;
  }
  #rules input,
  textarea {
    flex: 1;
    resize: vertical;
    margin: 1px 0;
    font: 11px/1.25 Consolas, monospace;
  }
  :invalid {
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
  #rules input,
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
  #installHint {
    color: green;
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
    button {
      background: linear-gradient(-5deg, #333, #555);
      border: 1px solid #000;
      box-shadow: 0 2px 6px #181818;
      border-radius: 3px;
      cursor: pointer;
    }
    button:hover {
      background: linear-gradient(-5deg, #333, #666);
    }
    textarea, input, select {
      background: #111;
      color: #BBB;
      border: 1px solid #555;
    }
    input[type=checkbox] {
      filter: invert(1);
    }
    input[type=range] {
      filter: invert(1) saturate(0);
    }
    input[type=range]:hover {
      filter: invert(1);
    }
    @supports (-moz-appearance: none) {
      input[type=checkbox],
      input[type=range],
      input[type=range]:hover {
        filter: none;
      }
    }
    .range-edit {
      box-shadow: 0 .5em 1em .5em #000;
    }
    #cssApp {
      color: darkseagreen;
    }
    #installHint {
      color: greenyellow;
    }
  }
</style>
<main>
  <a href="${MPIV_BASE_URL}">${GM_info.script.name}</a>
  <div id=x>x</div>
  <ul class=column>
    <li class=options>
      <label>Popup shows on
        <select id=start>
          <option value=auto>automatically
          <option value=context>Right click / Ctrl
          <option value=ctrl>Ctrl
        </select>
      </label>
      <label>after, sec<input id=delay type=number min=0.05 max=10 step=0.05 title=seconds></label>
      <label title="Activate only if the full version of the hovered image is that many times larger">
        if larger <input id=scale type=number min=1 max=100 step=.05>
      </label>
      <label>Zoom activates on
        <select id=zoom>
          <option value=context>Right click / Shift
          <option value=wheel>Wheel up / Shift
          <option value=shift>Shift
          <option value=auto>automatically
        </select>
      </label>
      <label>...and zooms to
        <select id=fit>
          <option value=all>fit to window
          <option value=large>fit if larger
          <option value=no>100%
          <option value="" title="Use custom scale factors">custom
        </select>
      </label>
    </li>
    <li class=options>
      <label>Zoom step, %<input id=zoomStep type=number min=100 max=400 step=1>
      </label>
      <label>When fully zoomed out:
        <select id=zoomOut>
          <option value=stay>stay in zoom mode
          <option value=auto>stay if still hovered
          <option value=close>close popup
        </select>
      </label>
      <label style="flex: 1" title="${trimLeft(`
        Scale factors to use when “zooms to” selector is set to “custom”.
        0 = fit to window,
        0! = same as 0 but also removes smaller values,
        * after a value marks the default zoom factor, for example: 1*
        The popup won't shrink below the image's natural size or window size for bigger mages.
        ${scalesHint}
      `)}">Custom scale factors:
        <input id=scales placeholder="${scalesHint}">
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
    <li class="options stretch">
      <label>Background
        <span>
          <input id=uiBackgroundColor type=color><u></u>
          <input id=uiBackgroundOpacity type=range min=0 max=100 step=1 data-title="Opacity: $%">
        </span>
      </label>
      <label>Border color, opacity, size
        <span>
          <input id=uiBorderColor type=color><u></u>
          <input id=uiBorderOpacity type=range min=0 max=100 step=1 data-title="Opacity: $%">
          <input id=uiBorder type=range min=0 max=20 step=1 data-title="Border size: $px">
        </span>
      </label>
      <label>Shadow color, opacity, size
        <span>
          <input id=uiShadowColor type=color><u></u>
          <input id=uiShadowOpacity type=range min=0 max=100 step=1 data-title="Opacity: $%">
          <input id=uiShadow type=range min=0 max=100 step=1 data-title="
            ${'Shadow blur radius: $px\n"0" disables the shadow.'}">
        </span>
      </label>
      <label>Padding
        <span><input id=uiPadding type=range min=0 max=100 step=1 data-title="Padding: $px"></span>
      </label>
      <label>Margin
        <span><input id=uiMargin type=range min=0 max=100 step=1 data-title="Margin: $px"></span>
      </label>
    </li>
    <li>
      <a href="${MPIV_BASE_URL}css.html">Custom CSS:</a>&nbsp;
      e.g. <b>#mpiv-popup { animation: none !important }</b>
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
        ${isFF ? '<input spellcheck=false>' : '<textarea rows=1 spellcheck=false></textarea>'}
      </div>
    </li>
    <li>
      <div hidden id=installLoading>Loading...</div>
      <div hidden id=installHint>Double-click the rule (or select and press Enter) to add it.
        Click <code>Apply</code> or <code>Save</code> to confirm.</div>
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
</main>`);
}

function createGlobalStyle() {
  App.globalStyle = /*language=CSS*/ (String.raw`
#\mpiv-bar {
  position: fixed;
  z-index: 2147483647;
  top: 0;
  left: 0;
  right: 0;
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
#\mpiv-bar.\mpiv-show {
  opacity: 1;
}
#\mpiv-bar[data-zoom]::after {
  content: " (" attr(data-zoom) ")";
  opacity: .8;
}
#\mpiv-popup.\mpiv-show {
  display: inline;
}
#\mpiv-popup {
  display: none;
  cursor: none;
  animation: .2s \mpiv-fadein both;
  transition: box-shadow .25s, background-color .25s;
${App.popupStyleBase = `
  border: none;
  box-sizing: border-box;
  position: fixed;
  z-index: 2147483647;
  padding: 0;
  margin: 0;
  top: 0;
  left: 0;
  width: auto;
  height: auto;
  transform-origin: top left;
  max-width: none;
  max-height: none;
`}
}
#\mpiv-popup.\mpiv-show {
  ${cfg.uiBorder ? `border: ${cfg.uiBorder}px solid ${Util.color('Border')};` : ''}
  ${cfg.uiPadding ? `padding: ${cfg.uiPadding}px;` : ''}
  ${cfg.uiMargin ? `margin: ${cfg.uiMargin}px;` : ''}
  box-shadow: ${cfg.uiShadow ? `2px 4px ${cfg.uiShadow}px 4px transparent` : 'none'};
}
#\mpiv-popup.\mpiv-show[loaded] {
  background-color: ${Util.color('Background')};
  ${cfg.uiShadow ? `box-shadow: 2px 4px ${cfg.uiShadow}px 4px ${Util.color('Shadow')};` : ''}
}
#\mpiv-popup.\mpiv-zoom-max {
  image-rendering: pixelated;
}
@keyframes \mpiv-fadein {
  from {
    opacity: 0;
    border-color: transparent;
  }
  to {
    opacity: 1;
  }
}
` + (cfg.globalStatus ? String.raw`
.\mpiv-loading:not(.\mpiv-preloading) * {
  cursor: progress !important;
}
.\mpiv-edge #\mpiv-popup {
  cursor: default;
}
.\mpiv-error * {
  cursor: not-allowed !important;
}
.\mpiv-ready *, .\mpiv-large * {
  cursor: zoom-in !important;
}
.\mpiv-shift * {
  cursor: default !important;
}
` : String.raw`
#\mpiv-popup[\mpiv-status~="loading"]:not([\mpiv-status~="preloading"]) {
  cursor: progress;
}
#\mpiv-popup[\mpiv-status~="edge"] {
  cursor: default;
}
#\mpiv-popup[\mpiv-status~="error"] {
  cursor: not-allowed;
}
#\mpiv-popup[\mpiv-status~="ready"],
#\mpiv-popup[\mpiv-status~="large"] {
  cursor: zoom-in;
}
#\mpiv-popup[\mpiv-status~="shift"] {
  cursor: default;
}
`)).replace(/\\mpiv-status/g, STATUS_ATTR).replace(/\\mpiv-/g, PREFIX);
  App.popupStyleBase = App.popupStyleBase.replace(/;/g, '!important;');
  return App.globalStyle;
}

//#region Global utilities
const clamp = (v, min, max) =>
  v < min ? min : v > max ? max : v;

const compareNumbers = (a, b) =>
  a - b;

const flattenHtml = str =>
  str.trim()
    .replace(/\n\s*/g, '')
    .replace(/\x20?([:>])\x20/g, '$1');

const dropEvent = e =>
  (e.preventDefault(), e.stopPropagation());

const ensureArray = v =>
  Array.isArray(v) ? v : [v];

const modKeyPressed = e =>
  e.altKey || e.shiftKey || e.ctrlKey || e.metaKey;

const now = performance.now.bind(performance);

const sumProps = (...props) =>
  props.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);

const tryCatch = function (fn, ...args) {
  try {
    return fn.apply(this, args);
  } catch (e) {}
};

const $ = (sel, node = doc) =>
  node.querySelector(sel) || false;

const $$ = (sel, node = doc) =>
  node.querySelectorAll(sel);

const $create = (tag, props) =>
  Object.assign(doc.createElement(tag), props);

const $css = (el, props) =>
  Object.entries(props).forEach(([k, v]) =>
    el.style.setProperty(k, v, 'important'));

const $many = (q, doc) =>
  q && ensureArray(q).reduce((el, sel) => el || $(sel, doc), null);

const $prop = (sel, prop, node = doc) =>
  (node = $(sel, node)) && node[prop] || '';

const $propUp = (node, prop) =>
  (node = node.closest(`[${prop}]`)) &&
  (prop.startsWith('data-') ? node.getAttribute(prop) : node[prop]) ||
  '';

const $remove = node =>
  node && node.remove();
//#endregion

//#region Init
const isFF = CSS.supports('-moz-appearance', 'none');
const AudioContext = window.AudioContext || function () {};

cfg = new Config({save: true});

App.enabled = true;
(cb => doc.body ? cb() : document.addEventListener('DOMContentLoaded', cb, {once: true}))(() => {
  const el = doc.body.firstElementChild;
  App.isImageTab = el && el === doc.body.lastElementChild && el.matches('img, video');
  App.enabled = cfg.imgtab || !App.isImageTab;
});

GM_registerMenuCommand('MPIV: configure', setup);
doc.addEventListener('mouseover', Events.onMouseOver, {passive: true});

if (['greasyfork.org', 'w9p.co', 'github.com'].includes(hostname)) {
  doc.addEventListener('click', e => {
    const el = e.target.closest('blockquote, code, pre');
    const text = el && el.textContent.trim() || '';
    let rule;
    if (!e.button && !modKeyPressed(e) &&
        text.startsWith('{') && text.endsWith('}') &&
        /[{,]\s*"[degqrsu]"\s*:\s*"/.test(text) &&
        (rule = tryCatch(JSON.parse, text)) &&
        Object.keys(rule).some(k => /^[degqrsu]$/.test(k))) {
      setup({rule});
      dropEvent(e);
    }
  });
}

window.addEventListener('message', App.onMessage);
//#endregion
