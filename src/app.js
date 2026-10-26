import {dotDomain, PREFIX, isFF, MSG, doc, isArray} from './constants.js';
import {state} from './state.js';
import {isVideo, now, isFunction, tryCatch} from './helpers.js';
import {Events} from './events.js';
import {Util} from './util.js';
import {Calc} from './calc.js';
import {Status} from './status.js';
import {Popup} from './popup.js';
import {Bar} from './bar.js';
import {CspSniffer} from './csp.js';
import * as Instagram from './instagram.js';
import {Req} from './request.js';
import {Ruler} from './rules.js';
import {RuleMatcher} from './rule-matcher.js';
import {Gallery} from './gallery.js';
import {createGlobalStyle} from './styles.js';

const App = {

  isEnabled: true,
  isImageTab: false,
  globalStyle: '',
  popupStyleBase: '',
  tabfix: /\.(dumpoir|greatfon|picuki)\.com$/.test(dotDomain),
  NOP: /\.(facebook|instagram|chrome|google)\.com$/.test(dotDomain) &&
    (() => {}),

  activate(info, event) {
    const {match, node, rule, url} = info;
    const auto = state.cfg.start === 'auto';
    const vidCtrl = state.cfg.videoCtrl && isVideo(node);
    if (state.elSetup) console.info({node, rule, url, match});
    if (auto && vidCtrl && !Events.ctrl)
      return;
    if (state.ai.node) App.deactivate();
    state.ai = info;
    state.ai.force = Events.ctrl;
    state.ai.gNum = 0;
    state.ai.zooming = state.cfg.css.includes(`${PREFIX}zooming`);
    if (auto) Util.suppressTooltip();
    Calc.updateViewSize();
    Events.ctrl = false;
    Events.toggle(true);
    Events.trackMouse(event);
    if (state.ai.force && (auto || state.cfg.start === 'ctrl' || state.cfg.start === 'context')) {
      App.start();
    } else if ((auto || state.cfg.preload) && !vidCtrl && !rule.manual) {
      App.belate(auto);
    } else {
      Status.set('ready');
    }
  },

  belate(auto) {
    if (state.cfg.preload) {
      state.ai.preloadStart = auto ? now() : -1;
      App.start();
      Status.set('+preloading');
    } else {
      state.ai.timer = setTimeout(App.start, state.cfg.delay);
    }
  },

  checkProgress({start} = {}) {
    const p = state.ai.popup;
    if (!p || state.ai.committed)
      return;
    const w = state.ai.nwidth =
      p.naturalWidth || p.videoWidth || state.ai.popupLoaded && innerWidth / 2;
    const h = state.ai.nheight =
      p.naturalHeight || p.videoHeight || state.ai.popupLoaded && innerHeight / 2;
    if (h)
      return App.canCommit(w, h);
    if (start) {
      clearInterval(state.timerProgress);
      state.timerProgress = setInterval(App.checkProgress, 150);
    }
  },

  canClose: (p = state.ai.popup) => !p || (
    isVideo(p)
      ? !state.cfg.keepVids
      : document.fullscreenElement !== p
  ),

  canCommit(w, h) {
    if (!state.ai.force && state.ai.rect && !state.ai.gItems &&
        Math.max(w / (state.ai.rect.width || 1), h / (state.ai.rect.height || 1)) <
          state.cfg.scale) {
      App.deactivate();
      return false;
    }
    App.stopTimers();
    let wait = state.ai.preloadStart;
    if (wait < 0 && !state.ai.force || !state.ai.popup)
      return;
    if (wait > 0 && (wait += state.cfg.delay - now()) > 0) {
      state.ai.timer = setTimeout(App.checkProgress, wait);
    } else if ((!w || !h) && (state.ai.urls || []).length) {
      App.handleError({type: 'error'});
    } else {
      App.commit();
      state.ai.committed = true;
    }
    return true;
  },

  async commit() {
    const p = state.ai.popupShown = state.ai.popup;
    const isDecoded = state.cfg.waitLoad && isFunction(p.decode);
    if (isDecoded) {
      await p.decode();
      if (p !== state.ai.popup)
        return;
    }
    Status.set('-preloading');
    App.updateStyles();
    Calc.measurePopup();
    const willZoom = state.cfg.zoom === 'auto' || App.isImageTab && state.cfg.imgtab;
    const willMove = !willZoom || App.toggleZoom({keepScale: true}) === undefined;
    if (willMove)
      Popup.move();
    Bar.updateName();
    Bar.updateDetails();
    Status.set(!state.ai.popupLoaded && 'loading');
    state.ai.large = state.ai.nwidth > p.clientWidth + state.ai.extras.w ||
               state.ai.nheight > p.clientHeight + state.ai.extras.h;
    if (state.ai.large) {
      Status.set('+large');
      // prevent a blank bg+border in FF
      if (isFF && p.complete && !isDecoded)
        p.style.backgroundImage = `url('${p.src}')`;
    }
    if (state.ai.preloadStart < 0 && isFunction(p.play))
      p.play().catch(now);
  },

  deactivate({wait} = {}) {
    App.stopTimers(true);
    if (state.ai.req)
      tryCatch(state.ai.req.abort);
    if (state.ai.tooltip)
      state.ai.tooltip.node.title = state.ai.tooltip.text;
    Status.set(false);
    Bar.set(false);
    Events.toggle(false);
    Popup.destroy();
    if (wait) {
      App.isEnabled = false;
      setTimeout(App.enable, 200);
    }
    state.ai = {rule: {}};
  },

  enable() {
    App.isEnabled = true;
  },

  handleError(e, rule = state.ai.rule) {
    if (rule && rule.onerror === 'skip')
      return;
    if (state.ai.imageUrl &&
        !state.ai.xhr &&
        !state.ai.imageUrl.startsWith(location.origin + '/') &&
        location.protocol === 'https:' &&
        CspSniffer.init) {
      Popup.create(state.ai.imageUrl, state.ai.pageUrl, e);
      return;
    }
    const fe = Util.formatError(e, rule);
    if (!rule || !state.ai.urls || !state.ai.urls.length)
      console.warn(...fe);
    if (state.ai.urls && state.ai.urls.length) {
      state.ai.url = state.ai.urls.shift();
      if (state.ai.url) {
        state.ai.committed = false;
        App.stopTimers();
        App.startSingle();
      } else {
        App.deactivate();
      }
    } else if (state.ai.node) {
      Status.set('error');
      Bar.set(fe.message, 'error');
    }
  },

  /** @param {MessageEvent} e */
  onMessage(e) {
    if (Instagram.onEmbedMessage(e)) return;
    if (typeof e.data === 'string' && e.data === MSG.getViewSize) {
      e.stopImmediatePropagation();
      for (const el of doc.getElementsByTagName('iframe')) {
        if (el.contentWindow === e.source) {
          const s = Calc.frameSize(el, window).join(':');
          e.source.postMessage(`${MSG.viewSize}:${s}`, '*');
          return;
        }
      }
    }
  },

  /** @param {MessageEvent} e */
  onMessageChild(e) {
    if (e.source === parent && typeof e.data === 'string' && e.data.startsWith(MSG.viewSize)) {
      e.stopImmediatePropagation();
      removeEventListener('message', App.onMessageChild, true);
      const [w, h, x, y] = e.data.split(':').slice(1).map(parseFloat);
      if (w && h) state.ai.view = {w, h, x, y};
    }
  },

  start() {
    App.updateStyles();
    if (state.ai.gallery)
      App.startGallery();
    else
      App.startSingle();
  },

  startSingle() {
    Status.loading();
    if (state.ai.force && state.ai.preloadStart < 0) {
      App.commit();
      return;
    }
    state.ai.imageUrl = null;
    if (state.ai.rule.follow && !state.ai.rule.q && !state.ai.rule.s) {
      Req.findRedirect();
    } else if (state.ai.rule.q && !isArray(state.ai.urls)) {
      App.startFromQ();
    } else {
      Popup.create(state.ai.url);
      Ruler.runC();
    }
  },

  async startFromQ() {
    try {
      const {responseText, doc, finalUrl} = await Req.getDoc(state.ai.url);
      const url = Ruler.runQ(responseText, doc, finalUrl);
      if (!url) {
        App.handleError(['The "q" rule did not produce any URL.', '\nRemote doc: %o', doc]);
        return;
      }
      if (RuleMatcher.isFollowableUrl(url, state.ai.rule)) {
        const info = RuleMatcher.find(url, state.ai.node, {noHtml: true});
        if (!info || !info.url)
          throw `Couldn't follow URL: ${url}`;
        Object.assign(state.ai, info);
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
      const startUrl = state.ai.url;
      const p = await Req.getDoc(state.ai.rule.s !== 'gallery' && startUrl);
      const items = await new Promise(cb => {
        const res = state.ai.gallery(
          p.responseText, p.doc, p.finalUrl, state.ai.match, state.ai.rule, state.ai.node, cb);
        if (res !== undefined) cb(res);
      });
      // bail out if the gallery's async callback took too long
      if (state.ai.url !== startUrl) return;
      state.ai.gNum = items.length;
      state.ai.gItems = items.length && items;
      if (state.ai.gItems) {
        const i = items.index;
        state.ai.gIndex = i >= 0 && items[i] ? +i :
          Gallery.findIndex(typeof i === 'string' ? i : state.ai.url);
        setTimeout(Gallery.next);
      } else {
        throw 'Empty gallery';
      }
    } catch (e) {
      App.handleError(e);
    }
  },

  stopTimers(bar) {
    for (const timer of ['timer', 'timerStatus', bar && 'timerBar'])
      clearTimeout(state.ai[timer]);
    clearInterval(state.timerProgress);
  },

  toggleZoom({keepScale} = {}) {
    const p = state.ai.popup;
    if (!p || !state.ai.scales || state.ai.scales.length < 2)
      return;
    state.ai.zoomed = !state.ai.zoomed;
    state.ai.scale = state.ai.zoomed && Calc.scaleForFirstZoom(keepScale) || state.ai.scales[0];
    if (state.ai.zooming)
      p.classList.add(`${PREFIX}zooming`);
    Popup.move();
    Bar.updateDetails();
    Status.set(state.ai.zoomed ? 'zoom' : false);
    return state.ai.zoomed;
  },

  updateStyles() {
    Util.addStyle('global', (App.globalStyle || createGlobalStyle()) + state.cfg._getCss());
    Util.addStyle('rule', state.ai.rule.css || '');
  },
};

export {
  App,
};
