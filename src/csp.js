import {ai} from './app.js';
import {$prop} from './dom.js';
import {isVideoUrl, setNOP} from './util.js';

let busy;
/** @type {?Object<string,string[]>} */
export let csp = null;
export let nonce;

// will be null when done
export let init = function () {
  busy = new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', location);
    xhr.timeout = Math.max(2000, (performance.timing.responseEnd - performance.timeOrigin) * 2);
    xhr.onreadystatechange = () => {
      if (xhr.readyState >= xhr.HEADERS_RECEIVED) {
        csp = _parse([
          xhr.getResponseHeader('content-security-policy'),
          $prop('meta[http-equiv="Content-Security-Policy"]', 'content'),
        ].filter(Boolean).join(','));
        init = busy = xhr.onreadystatechange = null;
        xhr.abort();
        resolve();
      }
    };
    xhr.send();
  });
};

export const setNonce = val => (nonce = val);

export async function check(url, allowInit) {
  if (allowInit && init) init();
  if (busy) await busy;
  const isVideo = isVideoUrl(url);
  let mode;
  if (csp) {
    const src = csp[isVideo ? 'media' : 'img'] || csp.default;
    if (!src.some(_srcMatches, url))
      mode = [mode, 'blob', 'data'].find(m => src.includes(`${m}:`));
  }
  return [mode || ai.xhr, isVideo];
}

function _parse(cspValue) {
  if (!cspValue) return;
  const src = {};
  const rx = /(?:^|[;,])\s*(?:(default|img|media|script)-src|require-(trusted)-types-for) ([^;,]+)/g;
  for (let m; (m = rx.exec(cspValue));)
    src[m[1] || m[2]] = m[3].trim().split(/\s+/);
  if ((src.script || []).find(s => /^'nonce-(.+)'$/.test(s)))
    nonce = RegExp.$1;
  if ((src.trusted || []).includes("'script'"))
    setNOP(() => {});
  for (const set of new Set([src.img || src.default, src.media || src.default])) {
    set.forEach((item, i) => {
      if (item !== '*' && item.includes('*')) {
        set[i] = new RegExp(
          (/^\w+:/.test(item) ? '^' : '^\\w+://') +
          item
            .replace(/[.+?^$|()[\]{}]/g, '\\$&')
            .replace(/(\\\.)?(\*)(\\\.)?/g, (_, a, b, c) =>
              `${a ? '\\.?' : ''}[^:/]*${c ? '\\.?' : ''}`)
            .replace(/[^/]$/, '$&/'));
      }
    });
  }
  return src;
}

/** @this string */
function _srcMatches(src) {
  return src instanceof RegExp ? src.test(this) :
    src === '*' ||
    src && this.startsWith(src) && (src.endsWith('/') || this[src.length] === '/') ||
    src === "'self'" && this.startsWith(location.origin + '/');
}
