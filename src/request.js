import {state} from './state.js';
import {tryCatch, $parseHtml, now, isFunction, $new, $prop} from './helpers.js';
import {GM} from './gm.js';
import {doc, RX_IMAGE_URL} from './constants.js';
import {Bar} from './bar.js';
import {RuleMatcher} from './rule-matcher.js';
import {App} from './app.js';
import {Status} from './status.js';
import {Util} from './util.js';

const Req = {

  gmXhr(url, opts = {}) {
    if (state.ai.req)
      tryCatch(state.ai.req.abort);
    return new Promise((resolve, reject) => {
      const {anonymous} = state.ai.rule || {};
      state.ai.req = GM.xmlHttpRequest(Object.assign({
        url,
        anonymous,
        withCredentials: !anonymous,
        method: 'GET',
        timeout: 30e3,
      }, opts, {
        onload: done,
        onerror: done,
        ontimeout() {
          state.ai.req = null;
          reject(`Timeout fetching ${url}`);
        },
      }));
      function done(r) {
        state.ai.req = null;
        if (r.status < 400 && !r.error)
          resolve(r);
        else
          reject(`Server error ${r.status} ${r.error}\nURL: ${url}`);
      }
    });
  },

  async getDoc(url) {
    if (!url) {
      // current document
      return {
        doc,
        finalUrl: location.href,
        responseText: doc.documentElement.outerHTML,
      };
    }
    const r = await (!state.ai.post ?
      Req.gmXhr(url) :
      Req.gmXhr(url, {
        method: 'POST',
        data: state.ai.post,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': url,
        },
      }));
    r.doc = $parseHtml(r.responseText);
    return r;
  },

  async getImage(url, pageUrl, xhr = state.ai.xhr) {
    state.ai.bufBar = false;
    state.ai.bufStart = now();
    const response = await Req.gmXhr(url, {
      responseType: 'blob',
      headers: {
        Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
        Referer: pageUrl || (isFunction(xhr) ? xhr() : url),
      },
      onprogress: Req.getImageProgress,
    });
    Bar.set(false);
    const type = Req.guessMimeType(response);
    let b = response.response;
    if (!b) throw 'Empty response';
    if (b.type !== type)
      b = b.slice(0, b.size, type);
    const res = xhr === 'blob'
      ? (state.ai.blobUrl = URL.createObjectURL(b))
      : await Req.blobToDataUrl(b);
    return [res, type.startsWith('video')];
  },

  getImageProgress(e) {
    if (!state.ai.bufBar && now() - state.ai.bufStart > 3000 && e.loaded / e.total < 0.5)
      state.ai.bufBar = true;
    if (state.ai.bufBar) {
      const pct = e.loaded / e.total * 100 | 0;
      const size = e.total / 1024 | 0;
      Bar.set(`${pct}% of ${size} kiB`, 'xhr');
    }
  },

  async findRedirect() {
    try {
      const {finalUrl} = await Req.gmXhr(state.ai.url, {
        method: 'HEAD',
        headers: {
          'Referer': location.href.split('#', 1)[0],
        },
      });
      const info = RuleMatcher.find(finalUrl, state.ai.node, {noHtml: true});
      if (!info || !info.url)
        throw `Couldn't follow redirection target: ${finalUrl}`;
      Object.assign(state.ai, info);
      App.startSingle();
    } catch (e) {
      App.handleError(e);
    }
  },

  async saveFile() {
    const url = state.ai.popup.src || state.ai.popup.currentSrc;
    let name = Req.getFileName(state.ai.imageUrl || url);
    if (!name.includes('.'))
      name += '.jpg';
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      $new('a', {href: url, download: name})
        .dispatchEvent(new MouseEvent('click'));
    } else {
      Status.set('+loading');
      const onload = () => Status.set('-loading');
      const gmDL = typeof GM_download === 'function';
      (gmDL ? GM_download : GM.xmlHttpRequest)({
        url,
        name,
        headers: {Referer: url},
        method: 'GET', // polyfilling GM_download
        responseType: 'blob', // polyfilling GM_download
        overrideMimeType: 'application/octet-stream', // polyfilling GM_download
        onerror: e => {
          Bar.set(`Could not download ${name}: ${e.error || e.message || e}.`, 'error');
          onload();
        },
        onprogress: Req.getImageProgress,
        onload({response}) {
          onload();
          if (!gmDL) { // polyfilling GM_download
            const a = Object.assign(document.createElement('a'), {
              href: URL.createObjectURL(response),
              download: name,
            });
            a.dispatchEvent(new MouseEvent('click'));
            setTimeout(URL.revokeObjectURL, 10e3, a.href);
          }
        },
      });
    }
  },

  getFileName(url) {
    return decodeURIComponent(url).split(/[#?&]/, 1)[0].split('/').pop();
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
    const ext = Util.extractFileExt(finalUrl) || 'jpg';
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
    if (!n) return;
    let tmp;
    const path =
      // prefer data-* over `src` which is often a small thumbnail or empty pixel
      Object.values(n.dataset).some(v => (tmp = v.match(RX_IMAGE_URL)[0])) && tmp ||
      n.getAttribute('src') ||
      n.getAttribute('href') ||
      n.getAttribute('content') ||
      (tmp = n.outerHTML).includes('http') && tmp.match(RX_IMAGE_URL)[0];
    return !!path && Util.rel2abs(Util.decodeHtmlEntities(path),
      $prop('base[href]', 'href', n.ownerDocument) || url);
  },
};

export {
  Req,
};
