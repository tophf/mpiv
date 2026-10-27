import {ai, handleError, startSingle} from './app.js';
import * as Bar from './bar.js';
import {$new, $parseHtml, $prop, doc} from './dom.js';
import * as GM from './gm.js';
import * as RuleMatcher from './rule-matcher.js';
import * as Status from './status.js';
import {decodeHtmlEntities, extractFileExt, isFunction, now, rel2abs, tryCatch} from './util.js';

let RX_IMAGE_URL;

export function gmXhr(url, opts = {}) {
  if (ai.req)
    tryCatch(ai.req.abort);
  return new Promise((resolve, reject) => {
    const {anonymous} = ai.rule || {};
    ai.req = GM.xmlHttpRequest(Object.assign({
      url,
      anonymous,
      withCredentials: !anonymous,
      method: 'GET',
      timeout: 30e3,
    }, opts, {
      onload: done,
      onerror: done,
      ontimeout() {
        ai.req = null;
        reject(`Timeout fetching ${url}`);
      },
    }));
    function done(r) {
      ai.req = null;
      if (r.status < 400 && !r.error)
        resolve(r);
      else
        reject(`Server error ${r.status} ${r.error}\nURL: ${url}`);
    }
  });
}

export async function getDoc(url) {
  if (!url) {
    // current document
    return {
      doc,
      finalUrl: location.href,
      responseText: doc.documentElement.outerHTML,
    };
  }
  const r = await (!ai.post ?
    gmXhr(url) :
    gmXhr(url, {
      method: 'POST',
      data: ai.post,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': url,
      },
    }));
  r.doc = $parseHtml(r.responseText);
  return r;
}

export async function getImage(url, pageUrl, xhr = ai.xhr) {
  ai.bufBar = false;
  ai.bufStart = now();
  const response = await gmXhr(url, {
    responseType: 'blob',
    headers: {
      Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
      Referer: pageUrl || (isFunction(xhr) ? xhr() : url),
    },
    onprogress: getImageProgress,
  });
  Bar.set(false);
  const type = guessMimeType(response);
  let b = response.response;
  if (!b) throw 'Empty response';
  if (b.type !== type)
    b = b.slice(0, b.size, type);
  const res = xhr === 'blob'
    ? (ai.blobUrl = URL.createObjectURL(b))
    : await blobToDataUrl(b);
  return [res, type.startsWith('video')];
}

export function getImageProgress(e) {
  if (!ai.bufBar && now() - ai.bufStart > 3000 && e.loaded / e.total < 0.5)
    ai.bufBar = true;
  if (ai.bufBar) {
    const pct = e.loaded / e.total * 100 | 0;
    const size = e.total / 1024 | 0;
    Bar.set(`${pct}% of ${size} kiB`, 'xhr');
  }
}

export async function findRedirect() {
  try {
    const {finalUrl} = await gmXhr(ai.url, {
      method: 'HEAD',
      headers: {
        'Referer': location.href.split('#', 1)[0],
      },
    });
    const info = RuleMatcher.find(finalUrl, ai.node, {noHtml: true});
    if (!info || !info.url)
      throw `Couldn't follow redirection target: ${finalUrl}`;
    Object.assign(ai, info);
    startSingle();
  } catch (e) {
    handleError(e);
  }
}

export async function saveFile() {
  const url = ai.popup.src || ai.popup.currentSrc;
  let name = getFileName(ai.imageUrl || url);
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
      onprogress: getImageProgress,
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
}

export function getFileName(url) {
  return decodeURIComponent(url).split(/[#?&]/, 1)[0].split('/').pop();
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export function guessMimeType({responseHeaders, finalUrl}) {
  if (/Content-Type:\s*(\S+)/i.test(responseHeaders) &&
      !RegExp.$1.includes('text/plain'))
    return RegExp.$1;
  const ext = extractFileExt(finalUrl) || 'jpg';
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
}

export function findImageUrl(n, url) {
  if (!n) return;
  RX_IMAGE_URL ||= /https?:\/\/[^\s"<>]+?\.(jpe?g|gif|png|svg|web[mp]|mp4)[^\s"<>]*|$/i;
  let tmp;
  const path =
    // prefer data-* over `src` which is often a small thumbnail or empty pixel
    Object.values(n.dataset).some(v => (tmp = v.match(RX_IMAGE_URL)[0])) && tmp ||
    n.getAttribute('src') ||
    n.getAttribute('href') ||
    n.getAttribute('content') ||
    (tmp = n.outerHTML).includes('http') && tmp.match(RX_IMAGE_URL)[0];
  return !!path && rel2abs(decodeHtmlEntities(path),
    $prop('base[href]', 'href', n.ownerDocument) || url);
}
