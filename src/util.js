import {ai, cfg} from './app.js';
import {$, doc} from './dom.js';
import {dotDomain, isFF, RX_EVAL_BLOCKED, RX_MEDIA_URL, TT} from './vars.js';

export const setNOP = val => (NOP = val);
export const {isArray} = Array;
export const clamp = (v, min, max) => v < min ? min : v > max ? max : v;

export const compareNumbers = (a, b) => a - b;

/** @param {KeyboardEvent} e */
export const describeKey = e => eventModifiers(e) + (e.key && e.key.length > 1 ? e.key : e.code);

export const dropEvent = e => ((e.preventDefault(), e.stopPropagation()));

export const ensureArray = v => isArray(v) ? v : [v];

/** @param {KeyboardEvent} e */
export const eventModifiers = e =>
  (e.altKey ? '!' : '') +
  (e.ctrlKey ? '^' : '') +
  (e.metaKey ? '#' : '') +
  (e.shiftKey ? '+' : '');

export const extractFileExt = url => (url = RX_MEDIA_URL.exec(url)) && url[1];

export const flattenHtml = str => str.trim().replace(/\n\s*/g, '');

export const getUiColor = (color, opacity = cfg[`ui${color}Opacity`]) =>
  (color.startsWith('#') ? color : cfg[`ui${color}Color`]) +
  (0x100 + Math.round(opacity / 100 * 255)).toString(16).slice(1);

export const isFunction = val => typeof val === 'function';

export const isVideo = el => el && el.tagName === 'VIDEO';
export const isVideoUrl = url => url.startsWith('data:video') || isVideoUrlExt(url);
export const isVideoUrlExt = url => /^(webm|mp4)$/i.test(extractFileExt(url));

export const now = performance.now.bind(performance);

export const pick = (obj, path, fn) => {
  if (obj && path)
    for (const p of path.split('.'))
      if (obj) obj = obj[p]; else break;
  return fn && obj !== undefined ? fn(obj) : obj;
};

export const sumProps = (...props) => {
  let sum = 0;
  for (const p of props)
    sum += parseFloat(p) || 0;
  return sum;
};

export const tryCatch = (fn, ...args) => {
  try {
    return fn(...args);
  } catch (e) {}
};

export const tryJSON = str => tryCatch(JSON.parse, str);

export let NOP = /\.(facebook|instagram|chrome|google)\.com$/.test(dotDomain) && (() => {});
export let trustedHTML;
export let trustedScript;

export function decodeHtmlEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// decode only if the main part of the URL is encoded to preserve the encoded parameters
export function decodeUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const iPct = url.indexOf('%');
  const iColon = url.indexOf(':');
  return iPct >= 0 && (iPct < iColon || iColon < 0) ?
    decodeURIComponent(url) :
    url;
}

export function deepEqual(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof a !== typeof b)
    return a === b;
  if (isArray(a)) {
    return isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => deepEqual(v, b[i]));
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length &&
    keys.every(k => deepEqual(a[k], b[k]));
}

export function forceLayout(node) {
  // eslint-disable-next-line no-unused-expressions
  node.clientHeight;
}

export function formatError(e, rule) {
  const arr = isArray(e);
  const msg = arr ? e[0] : e.message;
  const {url: u, imageUrl: iu} = ai;
  e = msg ? e :
    e.readyState && 'Request failed.' ||
    e.type === 'error' && `File can't be displayed.${
      $('div[bgactive*="flashblock"]', doc) ? ' Check Flashblock settings.' : ''
    }` ||
    e;
  let fmt;
  const res = [
    fmt = '%c%s%c', 'font-weight:bold', arr ? msg : e, 'font-weight:normal',
    (fmt += '\nNode: %o', ai.node),
    (fmt += '\nRule: %o', rule),
    u && (fmt += '\nURL: %s', u),
    iu && iu !== u && (fmt += '\nFile: %s', iu),
    ...arr ? (fmt += e[1], e.slice(2)) : [],
    e.stack,
  ].filter(Boolean);
  res[0] = fmt;
  res.message = msg || e;
  return res;
}

export function getReactChildren(el, path) {
  if (isFF) el = el.wrappedJSObject || el;
  for (const k of Object.keys(el))
    if (typeof k === 'string' && k.startsWith('__reactProps'))
      return (el = el[k].children) && (path ? pick(el, path) : el);
}

export function newFunction(...args) {
  try {
    return NOP || (trustedScript
      // eslint-disable-next-line no-eval
      ? window.eval(trustedScript(`(function anonymous(${args.slice(0, -1).join(',')}){${args.slice(-1)[0]}})`))
      : new Function(...args) // eslint-disable-line no-new-func
    );
  } catch (e) {
    if (!RX_EVAL_BLOCKED.test(e.message))
      throw e;
    NOP = () => {};
    return NOP;
  }
}

export function rel2abs(rel, abs = location.href) {
  try {
    return /^(data:|blob:|[-\w]+:\/\/)/.test(rel) ? rel :
      new URL(rel, abs).href;
  } catch (e) {
    return rel;
  }
}

export function stringify(...args) {
  const p = Array.prototype;
  const {toJSON} = p;
  if (toJSON) p.toJSON = null;
  const res = JSON.stringify(...args);
  if (toJSON) p.toJSON = toJSON;
  return res;
}

export function tabFixUrl() {
  const {tabfix = /\.(dumpoir|greatfon|picuki)\.com$/.test(dotDomain)} = ai.rule;
  return tabfix && ai.popup.tagName === 'IMG' && !ai.xhr &&
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
  `).replace(/\x20?([:>])\x20/g, '$1').replace(/#/g, '%23');
}

if (TT) {
  const CP = 'createPolicy';
  const createPolicy = TT[CP];
  TT[CP] = function ovr(name, opts) {
    let fn;
    const p = createPolicy.call(TT, name, opts);
    if ((trustedHTML || opts[fn = 'createHTML'] && (trustedHTML = p[fn].bind(p))) &&
        (trustedScript || opts[fn = 'createScript'] && (trustedScript = p[fn].bind(p))) &&
        TT[CP] === ovr)
      delete TT[CP];
    return p;
  };
}
