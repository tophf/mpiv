import {$prop} from './helpers.js';
import {Util} from './util.js';
import {state} from './state.js';
import {App} from './app.js';

const CspSniffer = {

  /** @type {?Object<string,string[]>} */
  csp: null,
  selfUrl: location.origin + '/',

  // will be null when done
  init() {
    this.busy = new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', location);
      xhr.timeout = Math.max(2000, (performance.timing.responseEnd - performance.timeOrigin) * 2);
      xhr.onreadystatechange = () => {
        if (xhr.readyState >= xhr.HEADERS_RECEIVED) {
          this.csp = this._parse([
            xhr.getResponseHeader('content-security-policy'),
            $prop('meta[http-equiv="Content-Security-Policy"]', 'content'),
          ].filter(Boolean).join(','));
          this.init = this.busy = xhr.onreadystatechange = null;
          xhr.abort();
          resolve();
        }
      };
      xhr.send();
    });
  },

  async check(url, allowInit) {
    if (allowInit && this.init) this.init();
    if (this.busy) await this.busy;
    const isVideo = Util.isVideoUrl(url);
    let mode;
    if (this.csp) {
      const src = this.csp[isVideo ? 'media' : 'img'] || this.csp.default;
      if (!src.some(this._srcMatches, url))
        mode = [mode, 'blob', 'data'].find(m => src.includes(`${m}:`));
    }
    return [mode || state.ai.xhr, isVideo];
  },

  _parse(csp) {
    if (!csp) return;
    const src = {};
    const rx = /(?:^|[;,])\s*(?:(default|img|media|script)-src|require-(trusted)-types-for) ([^;,]+)/g;
    for (let m; (m = rx.exec(csp));)
      src[m[1] || m[2]] = m[3].trim().split(/\s+/);
    if ((src.script || []).find(s => /^'nonce-(.+)'$/.test(s)))
      state.nonce = RegExp.$1;
    if ((src.trusted || []).includes("'script'"))
      App.NOP = () => {};
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
  },

  /** @this string */
  _srcMatches(src) {
    return src instanceof RegExp ? src.test(this) :
      src === '*' ||
      src && this.startsWith(src) && (src.endsWith('/') || this[src.length] === '/') ||
      src === "'self'" && this.startsWith(CspSniffer.selfUrl);
  },
};

export {
  CspSniffer,
};
