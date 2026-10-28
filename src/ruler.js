import {ai, cfg, handleError} from './app.js';
import {nonce, setNonce} from './csp.js';
import {$, $many, $propUp, doc} from './dom.js';
import * as GM from './gm.js';
import * as Instagram from './instagram.js';
import * as Req from './request.js';
import * as RuleMatcher from './rule-matcher.js';
import {addBuiltinRules} from './rules.js';
import {UrlMatcher} from './url-matcher.js';
import {
  arrayFrom, decodeUrl, deepEqual, ensureArray, getReactChildren, isArray, isFunction, newFunction,
  NOP, pick, stringify, trustedScript, tryJSON,
} from './util.js';
import {dotDomain, hostname, isFF, RX_EVAL_BLOCKED, RX_HAS_CODE} from './vars.js';

export let rules;
const FN_ARGS = {
  s: ['m', 'node', 'rule'],
  c: ['text', 'doc', 'node', 'rule'],
  q: ['text', 'doc', 'node', 'rule'],
  g: ['text', 'doc', 'url', 'm', 'rule', 'node', 'cb'],
};
const SYM_U = Symbol('u');

/**
 'u' works only with URLs so it's ignored if 'html' is true
 ||some.domain = matches some.domain, anything.some.domain, etc.
 |foo = url or text must start with foo
 ^ = separator like / or ? or : but not a letter/number, not %._-
     when used at the end like "foo^" it additionally matches when the source ends with "foo"
 'r' is checked only if 'u' matches first
*/
export function init() {
  const errors = new Map();
  const src = cfg.hosts || [];
  const uniq = src.filter((r, i, arr) => !i || !deepEqual(r, arr[i - 1]));
  if (uniq.length < src.length)
    GM.setValue('cfg', cfg);
  /** @type mpiv.HostRule[] */
  rules = uniq.map(parse, errors).filter(Boolean);
  const hasGMAE = typeof GM_addElement === 'function';
  const canEval = nonce || setNonce(($('script[nonce]') || {}).nonce || '') || hasGMAE;
  const evalId = canEval && `${GM.info.script.name}${Math.random()}`;
  const evalRules = [];
  const evalCode = [`window[${JSON.stringify(evalId)}]=[`];
  for (const [rule, err] of errors.entries()) {
    if (!RX_EVAL_BLOCKED.test(err)) {
      handleError('Invalid custom host rule:', rule);
      continue;
    }
    if (canEval) {
      evalCode.push(evalRules.length ? ',' : '',
        '[', rules.indexOf(rule), ',{',
        ...Object.keys(FN_ARGS)
          .map(k => RX_HAS_CODE.test(rule[k]) && `${k}(${FN_ARGS[k]}){${rule[k]}},`)
          .filter(Boolean),
        '}]');
    }
    evalRules.push(rule);
  }
  if (evalRules.length) {
    let result, wnd;
    if (canEval) {
      const GMAE = hasGMAE
        ? GM_addElement
        : (tag, {textContent: txt}) => document.head.appendChild(
          Object.assign(document.createElement(tag), {
            textContent: trustedScript ? trustedScript(txt) : txt,
            nonce,
          }));
      evalCode.push(']; document.currentScript.remove();');
      GMAE('script', {textContent: evalCode.join('')});
      result = (wnd = unsafeWindow)[evalId] ||
        isFF && (wnd = wnd.wrappedJSObject)[evalId];
    }
    if (result) {
      for (const [index, fns] of result)
        Object.assign(rules[index], fns);
      delete wnd[evalId];
    } else {
      console.warn('Site forbids compiling JS code in these custom rules', evalRules);
    }
  }

  // optimization: a rule is created only when on domain
  switch (dotDomain.match(/[^.]+(?=\.com?(?:\.[^.]+)?$)|[^.]+\.[^.]+$|$/)[0]) {

    case '4chan.org': rules.push({
      e: '.is_catalog .thread a[href*="/thread/"], .catalog-thread a[href*="/thread/"]',
      q: '.op .fileText a',
      css: '#post-preview{display:none}',
    }); break;

    case 'amazon': rules.push({
      r: /.+?images\/I\/.+?\./,
      s: m => {
        const uh = doc.getElementById('universal-hover');
        return uh ? '' : m[0] + 'jpg';
      },
      css: '#zoomWindow{display:none!important;}',
    }); break;

    case 'bing': rules.push({
      e: 'a[m*="murl"]',
      r: /murl&quot;:&quot;(.+?)&quot;/,
      s: '$1',
      html: true,
    }); break;

    case 'deviantart': rules.push({
      e: 'a[href*="/art/"] img[src*="/v1/"]',
      r: /^(.+)\/v1\/\w+\/[^/]+\/(.+)-\d+.(\.\w+)(\?.+)/,
      s: ([, base, name, ext, tok], node) => {
        let v = getReactChildren(node.closest('a'), 'props.deviation.media.types');
        return v && (v = v.find(t => t.t === 'fullview')) && `${base}${
          v.c ? v.c.replace('<prettyName>', name)
            : `/v1/fill/w_${v.w},h_${v.h}/${name}-fullview${ext}`}${tok}`;
      },
    }, {
      e: '.dev-view-deviation img',
      s: () => [
        $('.dev-page-download').href,
        $('.dev-content-full').src,
      ].filter(Boolean),
    }, {
      e: 'a[data-hook=deviation_link]',
      q: 'link[as=image]',
    }); break;

    case 'discord': rules.push({
      u: '||discordapp.net/external/',
      r: /\/https?\/(.+)/,
      s: '//$1',
      follow: true,
    }); break;

    case 'dropbox': rules.push({
      r: /(.+?&size_mode)=\d+(.*)/,
      s: '$1=5$2',
    }); break;

    case 'facebook': rules.push({
      e: 'a[href^="/photo/?"], a[href^="https://www.facebook.com/photo"]',
      s: (m, el) => (m = getReactChildren(el.parentNode)) &&
        pick(m, (m[0] ? '0.props.linkProps' : 'props') + '.passthroughProps.origSrc'),
    }); break;

    case 'flickr': if (pick(unsafeWindow, 'YUI_config.flickr.api.site_key')) rules.push({
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
      anonymous: true,
    }); break;

    case 'github': rules.push({
      r: new RegExp([
        /(avatars.+?&s=)\d+/,
        /(raw\.github)(\.com\/.+?\/img\/.+)$/,
        /\/(github)(\.com\/.+?\/)blob\/([^/]+\/.+?\.(?:avif|webp|png|jpe?g|bmp|gif|cur|ico|svg))$/,
      ].map(rx => rx.source).join('|')),
      s: m => `https://${
        m[1] ? `${m[1]}460` :
          m[2] ? `${m[2]}usercontent${m[3]}` :
            $('.AppHeader-context-item > .octicon-lock')
              ? `${m[4]}${m[5]}raw/${m[6]}`
              : `raw.${m[4]}usercontent${m[5]}${m[6]}`
      }`,
    }); break;

    case 'google': if (location.pathname === '/search') rules.push({
      e: /[&?](sclient=img|udm=2)(&|$)/.test(location.search)
        ? '[data-docid] img'
        : '[jsdata][id] img',
      s: (m, el, rule) => {
        el = el.closest(rule.e.split(' ')[0]);
        const id = el.dataset.docid || el.id;
        if (isFF) el = el.wrappedJSObject || el;
        if ((el = el.__jscontroller) && (el = el.pending) && (el = el.value))
          for (let a in el)
            if (({}).toString.call(a = el[a]) === '[object Object]')
              for (const b in a)
                if (Array.isArray(m = a[b]) && m.includes(id)
                && (m[1] === id || (m = m[1]) && Array.isArray(m = m[b]) && m[1] === id)
                && Array.isArray(m = m[3]))
                  return m[0];
      },
    }); break;

    case 'instagram': rules.push({
      e: 'img, video, main div, article div, [role="dialog"] div, ' + Instagram.links,
      s: Instagram.preview,
      c: (html, doc, node, rule) => (rule._img || {}).alt || '',
    }); break;

    case 'reddit': rules.push({
      u: '||i.reddituploads.com/',
    }, {
      e: '[data-url*="i.redd.it"] img[src*="thumb"]',
      s: (m, node) => $propUp(node, 'data-url'),
    }, {
      r: /preview(\.redd\.it\/\w+\.(jpe?g|png|gif))/,
      s: 'https://i$1',
    }); break;

    case 'stackoverflow': rules.push({
      e: '.post-tag, .post-tag img',
      s: '',
    }); break;

    case 'startpage': rules.push({
      r: /[&?]piurl=([^&]+)/,
      s: '$1',
      follow: true,
    }); break;

    case 'tumblr': rules.push({
      e: 'div.photo_stage_img, div.photo_stage > canvas',
      s: (m, node) => /http[^"]+/.exec(node.style.cssText + node.getAttribute('data-img-src'))[0],
      follow: true,
    }); break;

    case 'twitter': rules.push({
      e: '.grid-tweet > .media-overlay',
      s: (m, node) => node.previousElementSibling.src,
      follow: true,
    }); break;
  }

  addBuiltinRules(rules);
}

export function format(rule, {expand} = {}) {
  const s = stringify(rule, null, ' ');
  return expand ?
    /* {"a": ...,
        "b": ...,
        "c": ...
       } */
    s.replace(/^{\s+/g, '{') :
    /* {"a": ..., "b": ..., "c": ...} */
    s.replace(/\n\s*/g, ' ').replace(/^({)\s|\s+(})$/g, '$1$2');
}

export function fromElement(el) {
  const text = el.textContent.trim();
  if (text.startsWith('{') &&
      text.endsWith('}') &&
      /[{,]\s*"[degqrsu]"\s*:\s*"/.test(text)) {
    const rule = tryJSON(text);
    return rule && Object.keys(rule).some(k => /^[degqrsu]$/.test(k)) && rule;
  }
}

const isValidE2 = ([k, v]) => k.trim() && typeof v === 'string' && v.trim();

/** @returns mpiv.HostRule | Error | false | undefined */
export function parse(rule) {
  const isBatchOp = this instanceof Map;
  try {
    if (typeof rule === 'string')
      rule = JSON.parse(rule);
    if ('d' in rule && typeof rule.d !== 'string')
      rule.d = undefined;
    else if (isBatchOp && rule.d && !hostname.includes(rule.d))
      return false;
    let {e} = rule;
    if (e != null) {
      e = typeof e === 'string' ? e.trim()
        : isArray(e) ? e.join(',').trim()
          : Object.entries(e).every(isValidE2) && e;
      if (!e)
        throw new Error('Invalid syntax for "e". Examples: ' +
          '"e": ".image" or ' +
          '"e": [".image1", ".image2"] or ' +
          '"e": {".parent": ".image"} or ' +
          '"e": {".parent1": ".image1", ".parent2": ".image2"}');
      if (isBatchOp) rule.e = e || undefined;
    }
    let compileTo = isBatchOp ? rule : {};
    if (rule.r)
      compileTo.r = new RegExp(rule.r, 'i');
    if (NOP)
      compileTo = {};
    for (const key of Object.keys(FN_ARGS)) {
      if (RX_HAS_CODE.test(rule[key])) {
        const fn = newFunction(...FN_ARGS[key], rule[key]);
        if (fn !== NOP || !isBatchOp) {
          compileTo[key] = fn;
        } else if (isBatchOp) {
          this.set(rule, 'unsafe-eval');
        }
      }
    }
    return rule;
  } catch (err) {
    if (isBatchOp) {
      this.set(rule, err);
      return rule;
    } else {
      return err;
    }
  }
}

export function runC(text, doc = document) {
  const fn = runCHandler[typeof ai.rule.c] || runCHandler.default;
  ai.caption = fn(text, doc);
}

export const runCHandler = {
  function: (text, doc) =>
    ai.rule.c(text || doc.documentElement.outerHTML, doc, ai.node, ai.rule),
  string: (text, doc) => {
    const el = $many(ai.rule.c, doc);
    return !el ? '' :
      el.getAttribute('content') ||
      el.getAttribute('title') ||
      el.textContent;
  },
  default: (text, doc, el = ai.node) =>
    (ai.tooltip || 0).text ||
    el.alt ||
    $propUp(el, 'title') ||
    Req.getFileName(
      el.tagName === (ai.popup || 0).tagName
        ? ai.url
        : el.src || $propUp(el, 'href')),
};

export function runQ(text, doc, docUrl) {
  let url;
  if (isFunction(ai.rule.q)) {
    url = ai.rule.q(text, doc, ai.node, ai.rule);
    if (isArray(url)) {
      ai.urls = url.slice(1);
      url = url[0];
    }
  } else {
    const el = $many(ai.rule.q, doc);
    url = Req.findImageUrl(el, docUrl);
  }
  return url;
}

/** @returns {?boolean|mpiv.RuleMatchInfo} */
export function runE(rule, e, node) {
  let p, img, res, info;
  for (const selParent in e) {
    if ((p = node.closest(selParent)) && (img = $(e[selParent], p))) {
      if (img === node)
        res = true;
      else if ((info = RuleMatcher.adaptiveFind(img, {rules: [rule]})))
        return info;
    }
  }
  return res;
}

/** @returns {?Array} if falsy then the rule should be skipped */
export function runS(node, rule, m) {
  let urls = [], u;
  for (const s of ensureArray(rule.s))
    urls.push(
      typeof s === 'string' ? decodeUrl(substituteSingle(s, m)) :
        isFunction(s) ? s(m, node, rule) :
          s);
  if (rule.q && urls.length > 1) {
    console.warn('Rule discarded: "s" array is not allowed with "q"\n%o', rule);
    return;
  }
  if (isArray(u = urls[0]))
    u = [urls = u][0];
  return u === '' /* "stop all rules" */ ? urls
    : u && arrayFrom(new Set(urls), decodeUrl);
}

/** @returns {boolean} */
export function runU(rule, url) {
  const u = rule[SYM_U] ||= UrlMatcher(rule.u);
  return u.fn.call(u.data, url);
}

function substituteSingle(s, m) {
  if (!m || m.input == null) return s;
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
