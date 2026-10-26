import {cfg, ai, trustedScript} from './state.js';
import {doc, isArray, RX_MEDIA_URL, isFF, RX_EVAL_BLOCKED} from './constants.js';
import {$new, $, pick, flattenHtml} from './helpers.js';
import * as App from './app.js';

export const styles = {__proto__: null};

export function addStyle(name, css) {
  const el = styles[name] || css && (
    styles[name] = typeof GM_addStyle === 'function'
      ? GM_addStyle(css)
      : doc.head.appendChild($new('style', css))
  );
  if (!el) return;
  if (el.textContent !== css)
    el.textContent = css;
  return el;
}

export function color(colorValue, opacity = cfg[`ui${colorValue}Opacity`]) {
  return (colorValue.startsWith('#') ? colorValue : cfg[`ui${colorValue}Color`]) +
         (0x100 + Math.round(opacity / 100 * 255)).toString(16).slice(1);
}

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

export const extractFileExt = url => (url = RX_MEDIA_URL.exec(url)) && url[1];

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

export const isVideoUrl = url => url.startsWith('data:video') || isVideoUrlExt(url);

export const isVideoUrlExt = url => (url = extractFileExt(url)) && /^(webm|mp4)$/i.test(url);

export function newFunction(...args) {
  try {
    return App.NOP || (trustedScript
      // eslint-disable-next-line no-eval
      ? window.eval(trustedScript(`(function anonymous(${args.slice(0, -1).join(',')}){${args.slice(-1)[0]}})`))
      : new Function(...args) // eslint-disable-line no-new-func
    );
  } catch (e) {
    if (!RX_EVAL_BLOCKED.test(e.message))
      throw e;
    App.setNOP(() => {});
    return App.NOP;
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

export function suppressTooltip() {
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

export function tabFixUrl() {
  const {tabfix = App.tabfix} = ai.rule;
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
