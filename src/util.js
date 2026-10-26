import {doc, isArray, RX_MEDIA_URL, isFF, RX_EVAL_BLOCKED} from './constants.js';
import {$new, $, pick, flattenHtml} from './helpers.js';
import {state} from './state.js';
import {App} from './app.js';

const Util = {

  styles: {__proto__: null},
  addStyle(name, css) {
    const el = Util.styles[name] || css && (
      Util.styles[name] = typeof GM_addStyle === 'function'
        ? GM_addStyle(css)
        : doc.head.appendChild($new('style', css))
    );
    if (!el) return;
    if (el.textContent !== css)
      el.textContent = css;
    return el;
  },

  color(color, opacity = state.cfg[`ui${color}Opacity`]) {
    return (color.startsWith('#') ? color : state.cfg[`ui${color}Color`]) +
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
    if (!url || typeof url !== 'string') return url;
    const iPct = url.indexOf('%');
    const iColon = url.indexOf(':');
    return iPct >= 0 && (iPct < iColon || iColon < 0) ?
      decodeURIComponent(url) :
      url;
  },

  deepEqual(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof a !== typeof b)
      return a === b;
    if (isArray(a)) {
      return isArray(b) &&
        a.length === b.length &&
        a.every((v, i) => Util.deepEqual(v, b[i]));
    }
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
      keys.every(k => Util.deepEqual(a[k], b[k]));
  },

  extractFileExt: url => (url = RX_MEDIA_URL.exec(url)) && url[1],

  forceLayout(node) {
    // eslint-disable-next-line no-unused-expressions
    node.clientHeight;
  },

  formatError(e, rule) {
    const arr = isArray(e);
    const msg = arr ? e[0] : e.message;
    const {url: u, imageUrl: iu} = state.ai;
    e = msg ? e :
      e.readyState && 'Request failed.' ||
      e.type === 'error' && `File can't be displayed.${
        $('div[bgactive*="flashblock"]', doc) ? ' Check Flashblock settings.' : ''
      }` ||
      e;
    let fmt;
    const res = [
      fmt = '%c%s%c', 'font-weight:bold', arr ? msg : e, 'font-weight:normal',
      (fmt += '\nNode: %o', state.ai.node),
      (fmt += '\nRule: %o', rule),
      u && (fmt += '\nURL: %s', u),
      iu && iu !== u && (fmt += '\nFile: %s', iu),
      ...arr ? (fmt += e[1], e.slice(2)) : [],
      e.stack,
    ].filter(Boolean);
    res[0] = fmt;
    res.message = msg || e;
    return res;
  },

  getReactChildren(el, path) {
    if (isFF) el = el.wrappedJSObject || el;
    for (const k of Object.keys(el))
      if (typeof k === 'string' && k.startsWith('__reactProps'))
        return (el = el[k].children) && (path ? pick(el, path) : el);
  },

  isVideoUrl: url => url.startsWith('data:video') || Util.isVideoUrlExt(url),

  isVideoUrlExt: url => (url = Util.extractFileExt(url)) && /^(webm|mp4)$/i.test(url),

  newFunction(...args) {
    try {
      return App.NOP || (state.trustedScript
        // eslint-disable-next-line no-eval
        ? window.eval(state.trustedScript(`(function anonymous(${args.slice(0, -1).join(',')}){${args.slice(-1)[0]}})`))
        : new Function(...args) // eslint-disable-line no-new-func
      );
    } catch (e) {
      if (!RX_EVAL_BLOCKED.test(e.message))
        throw e;
      App.NOP = () => {};
      return App.NOP;
    }
  },

  rel2abs(rel, abs = location.href) {
    try {
      return /^(data:|blob:|[-\w]+:\/\/)/.test(rel) ? rel :
        new URL(rel, abs).href;
    } catch (e) {
      return rel;
    }
  },

  stringify(...args) {
    const p = Array.prototype;
    const {toJSON} = p;
    if (toJSON) p.toJSON = null;
    const res = JSON.stringify(...args);
    if (toJSON) p.toJSON = toJSON;
    return res;
  },

  suppressTooltip() {
    for (const node of [
      state.ai.node.parentNode,
      state.ai.node,
      state.ai.node.firstElementChild,
    ]) {
      const t = (node || 0).title;
      if (t && t !== node.textContent && !doc.title.includes(t) && !/^https?:\S+$/.test(t)) {
        state.ai.tooltip = {node, text: t};
        node.title = '';
        break;
      }
    }
  },

  tabFixUrl() {
    const {tabfix = App.tabfix} = state.ai.rule;
    return tabfix && state.ai.popup.tagName === 'IMG' && !state.ai.xhr &&
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
        <img onclick="document.body.classList.toggle('fit')" src="${state.ai.popup.src}">
      </body>
    `).replace(/\x20?([:>])\x20/g, '$1').replace(/#/g, '%23');
  },
};

export {
  Util,
};
