import * as Bar from './bar.js';
import * as Calc from './calc.js';
import * as Config from './config.js';
import * as CspSniffer from './csp.js';
import {doc} from './dom.js';
import * as Events from './events.js';
import * as Gallery from './gallery.js';
import * as Instagram from './instagram.js';
import * as Menu from './menu.js';
import * as MSG from './msg.js';
import * as Popup from './popup.js';
import * as Req from './request.js';
import * as RuleMatcher from './rule-matcher.js';
import * as Ruler from './ruler.js';
import {elSetup, setup, setupClickedRule} from './setup.js';
import * as Status from './status.js';
import {updateStyles} from './styles.js';
import {formatError, isArray, isFunction, isVideo, now, tryCatch, tryJSON} from './util.js';
import {hostname, isFF} from './vars.js';

/** @type {Partial<mpiv.AppInfo>} */
export let ai = {rule: {}};
/** @type {mpiv.Config} */
export let cfg;
export let isEnabled = true;
export let isImageTab = false;
export let timerProgress;
export const setCfg = val => (cfg = val);

export function activate(info, event) {
  const {match, node, rule, url} = info;
  const auto = cfg.start === 'auto';
  const vidCtrl = cfg.videoCtrl && isVideo(node);
  if (elSetup) console.info({node, rule, url, match});
  if (auto && vidCtrl && !Events.ctrl)
    return;
  if (ai.node) deactivate();
  ai = info;
  ai.force = Events.ctrl;
  ai.gNum = 0;
  ai.zooming = cfg.css.includes(PREFIX + 'zooming');
  if (auto) suppressTooltip();
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
    timerProgress = setInterval(checkProgress, 150);
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
  const willMove = !willZoom || Popup.toggleZoom({keepScale: true}) === undefined;
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
  ai = {rule: {}};
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
  const fe = formatError(e, rule);
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

export async function init() {
  cfg = await Config.load({save: true});
  let {body} = doc;
  if (!body) await new Promise(resolve =>
    new MutationObserver((_, mo) => (body = doc.body) && resolve(mo.disconnect()))
      .observe(document, {subtree: true, childList: true}));
  const el = body.firstElementChild;
  if (el) {
    isImageTab = el === body.lastElementChild && el.matches('img, video');
    isEnabled = cfg.imgtab || !isImageTab;
  }
  if (window !== top) {
    Instagram.initEmbed();
  } else if (GM.registerMenuCommand) {
    GM.registerMenuCommand('MPIV: configure', setup);
    Menu.registerAlt();
  }
  addEventListener('mouseover', Events.onMouseOver, true);
  addEventListener('contextmenu', Events.onContext, true);
  addEventListener('keydown', Events.onKeyDown, true);
  addEventListener('visibilitychange', Events.onVisibility, true);
  addEventListener('blur', Events.onVisibility, true);
  if (['greasyfork.org', 'github.com'].includes(hostname))
    addEventListener('click', setupClickedRule, true);
  addEventListener('message', onMessage, true);
}

/** @param {MessageEvent} e */
function onMessage(e) {
  let {data} = e;
  if (typeof data !== 'string')
    return;
  if (data === MSG.getViewSize) {
    e.stopImmediatePropagation();
    for (const el of doc.getElementsByTagName('iframe')) {
      if (el.contentWindow === e.source) {
        const s = Calc.frameSize(el, window).join(':');
        e.source.postMessage(`${MSG.viewSize}:${s}`, '*');
        return;
      }
    }
  } else if (data.startsWith(MSG.instaEmbed)
  && (data = tryJSON(data.slice(MSG.instaEmbed.length)))
  && data.width > 0 && data.height > 0) {
    Instagram.onEmbedMessage(e, data);
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

function suppressTooltip() {
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
