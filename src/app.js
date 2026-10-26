import {cfg, ai, setAi, elSetup, setTimerProgress, timerProgress} from './state.js';
import * as Config from './config.js';
import {dotDomain, PREFIX, isFF, MSG, doc, isArray} from './constants.js';
import {isVideo, now, isFunction, tryCatch} from './helpers.js';
import * as Events from './events.js';
import * as Util from './util.js';
import * as Calc from './calc.js';
import * as Status from './status.js';
import * as Popup from './popup.js';
import * as Bar from './bar.js';
import * as CspSniffer from './csp.js';
import * as Instagram from './instagram.js';
import * as Req from './request.js';
import * as Ruler from './rules.js';
import * as RuleMatcher from './rule-matcher.js';
import * as Gallery from './gallery.js';
import {createGlobalStyle} from './styles.js';

export let isEnabled = true;
export let isImageTab = false;
export let globalStyle = '';
export let popupStyleBase = '';
export let NOP = /\.(facebook|instagram|chrome|google)\.com$/.test(dotDomain) &&
  (() => {});
export const setGlobalStyle = val => (globalStyle = val);
export const setNOP = val => (NOP = val);
export const setIsImageTab = val => (isImageTab = val);
export const setIsEnabled = val => (isEnabled = val);
export const setPopupStyleBase = val => (popupStyleBase = val);
export const tabfix = /\.(dumpoir|greatfon|picuki)\.com$/.test(dotDomain);

export function activate(info, event) {
  const {match, node, rule, url} = info;
  const auto = cfg.start === 'auto';
  const vidCtrl = cfg.videoCtrl && isVideo(node);
  if (elSetup) console.info({node, rule, url, match});
  if (auto && vidCtrl && !Events.ctrl)
    return;
  if (ai.node) deactivate();
  setAi(info);
  ai.force = Events.ctrl;
  ai.gNum = 0;
  ai.zooming = cfg.css.includes(`${PREFIX}zooming`);
  if (auto) Util.suppressTooltip();
  Calc.updateViewSize();
  Events.setCtrl(false);
  Events.toggle(true);
  Events.trackMouse(event);
  if (ai.force && (auto || cfg.start === 'ctrl' || cfg.start === 'context')) {
    start();
  } else if ((auto || cfg.preload) && !vidCtrl && !rule.manual) {
    belate(auto);
  } else {
    Status.set('ready');
  }
}

export function belate(auto) {
  if (cfg.preload) {
    ai.preloadStart = auto ? now() : -1;
    start();
    Status.set('+preloading');
  } else {
    ai.timer = setTimeout(start, cfg.delay);
  }
}

export function checkProgress({start: startValue} = {}) {
  const p = ai.popup;
  if (!p || ai.committed)
    return;
  const w = ai.nwidth =
    p.naturalWidth || p.videoWidth || ai.popupLoaded && innerWidth / 2;
  const h = ai.nheight =
    p.naturalHeight || p.videoHeight || ai.popupLoaded && innerHeight / 2;
  if (h)
    return canCommit(w, h);
  if (startValue) {
    clearInterval(timerProgress);
    setTimerProgress(setInterval(checkProgress, 150));
  }
}

export const canClose = (p = ai.popup) => !p || (
  isVideo(p)
    ? !cfg.keepVids
    : document.fullscreenElement !== p
);

export function canCommit(w, h) {
  if (!ai.force && ai.rect && !ai.gItems &&
      Math.max(w / (ai.rect.width || 1), h / (ai.rect.height || 1)) <
        cfg.scale) {
    deactivate();
    return false;
  }
  stopTimers();
  let wait = ai.preloadStart;
  if (wait < 0 && !ai.force || !ai.popup)
    return;
  if (wait > 0 && (wait += cfg.delay - now()) > 0) {
    ai.timer = setTimeout(checkProgress, wait);
  } else if ((!w || !h) && (ai.urls || []).length) {
    handleError({type: 'error'});
  } else {
    commit();
    ai.committed = true;
  }
  return true;
}

export async function commit() {
  const p = ai.popupShown = ai.popup;
  const isDecoded = cfg.waitLoad && isFunction(p.decode);
  if (isDecoded) {
    await p.decode();
    if (p !== ai.popup)
      return;
  }
  Status.set('-preloading');
  updateStyles();
  Calc.measurePopup();
  const willZoom = cfg.zoom === 'auto' || isImageTab && cfg.imgtab;
  const willMove = !willZoom || toggleZoom({keepScale: true}) === undefined;
  if (willMove)
    Popup.move();
  Bar.updateName();
  Bar.updateDetails();
  Status.set(!ai.popupLoaded && 'loading');
  ai.large = ai.nwidth > p.clientWidth + ai.extras.w ||
             ai.nheight > p.clientHeight + ai.extras.h;
  if (ai.large) {
    Status.set('+large');
    // prevent a blank bg+border in FF
    if (isFF && p.complete && !isDecoded)
      p.style.backgroundImage = `url('${p.src}')`;
  }
  if (ai.preloadStart < 0 && isFunction(p.play))
    p.play().catch(now);
}

export function deactivate({wait} = {}) {
  stopTimers(true);
  if (ai.req)
    tryCatch(ai.req.abort);
  if (ai.tooltip)
    ai.tooltip.node.title = ai.tooltip.text;
  Status.set(false);
  Bar.set(false);
  Events.toggle(false);
  Popup.destroy();
  if (wait) {
    isEnabled = false;
    setTimeout(enable, 200);
  }
  setAi({rule: {}});
}

export function enable() {
  isEnabled = true;
}

export function handleError(e, rule = ai.rule) {
  if (rule && rule.onerror === 'skip')
    return;
  if (ai.imageUrl &&
      !ai.xhr &&
      !ai.imageUrl.startsWith(location.origin + '/') &&
      location.protocol === 'https:' &&
      CspSniffer.init) {
    Popup.create(ai.imageUrl, ai.pageUrl, e);
    return;
  }
  const fe = Util.formatError(e, rule);
  if (!rule || !ai.urls || !ai.urls.length)
    console.warn(...fe);
  if (ai.urls && ai.urls.length) {
    ai.url = ai.urls.shift();
    if (ai.url) {
      ai.committed = false;
      stopTimers();
      startSingle();
    } else {
      deactivate();
    }
  } else if (ai.node) {
    Status.set('error');
    Bar.set(fe.message, 'error');
  }
}

/** @param {MessageEvent} e */
export function onMessage(e) {
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
}

/** @param {MessageEvent} e */
export function onMessageChild(e) {
  if (e.source === parent && typeof e.data === 'string' && e.data.startsWith(MSG.viewSize)) {
    e.stopImmediatePropagation();
    removeEventListener('message', onMessageChild, true);
    const [w, h, x, y] = e.data.split(':').slice(1).map(parseFloat);
    if (w && h) ai.view = {w, h, x, y};
  }
}

export function start() {
  updateStyles();
  if (ai.gallery)
    startGallery();
  else
    startSingle();
}

export function startSingle() {
  Status.loading();
  if (ai.force && ai.preloadStart < 0) {
    commit();
    return;
  }
  ai.imageUrl = null;
  if (ai.rule.follow && !ai.rule.q && !ai.rule.s) {
    Req.findRedirect();
  } else if (ai.rule.q && !isArray(ai.urls)) {
    startFromQ();
  } else {
    Popup.create(ai.url);
    Ruler.runC();
  }
}

export async function startFromQ() {
  try {
    const {responseText, doc, finalUrl} = await Req.getDoc(ai.url);
    const url = Ruler.runQ(responseText, doc, finalUrl);
    if (!url) {
      handleError(['The "q" rule did not produce any URL.', '\nRemote doc: %o', doc]);
      return;
    }
    if (RuleMatcher.isFollowableUrl(url, ai.rule)) {
      const info = RuleMatcher.find(url, ai.node, {noHtml: true});
      if (!info || !info.url)
        throw `Couldn't follow URL: ${url}`;
      Object.assign(ai, info);
      startSingle();
    } else {
      Popup.create(url, finalUrl);
      Ruler.runC(responseText, doc);
    }
  } catch (e) {
    handleError(e);
  }
}

export async function startGallery() {
  Status.loading();
  try {
    const startUrl = ai.url;
    const p = await Req.getDoc(ai.rule.s !== 'gallery' && startUrl);
    const items = await new Promise(cb => {
      const res = ai.gallery(
        p.responseText, p.doc, p.finalUrl, ai.match, ai.rule, ai.node, cb);
      if (res !== undefined) cb(res);
    });
    // bail out if the gallery's async callback took too long
    if (ai.url !== startUrl) return;
    ai.gNum = items.length;
    ai.gItems = items.length && items;
    if (ai.gItems) {
      const i = items.index;
      ai.gIndex = i >= 0 && items[i] ? +i :
        Gallery.findIndex(typeof i === 'string' ? i : ai.url);
      setTimeout(Gallery.next);
    } else {
      throw 'Empty gallery';
    }
  } catch (e) {
    handleError(e);
  }
}

export function stopTimers(bar) {
  for (const timer of ['timer', 'timerStatus', bar && 'timerBar'])
    clearTimeout(ai[timer]);
  clearInterval(timerProgress);
}

export function toggleZoom({keepScale} = {}) {
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
}

export function updateStyles() {
  Util.addStyle('global', (globalStyle || createGlobalStyle()) + Config.getCss(cfg));
  Util.addStyle('rule', ai.rule.css || '');
}
