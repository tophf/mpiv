import {ai, cfg} from './state.js';
import * as CspSniffer from './csp.js';
import * as App from './app.js';
import * as Req from './request.js';
import * as GM from './gm.js';
import {BLANK_PIXEL, PREFIX, doc, SETTLE_TIME, isArray} from './constants.js';
import * as PopupVideo from './popup-video.js';
import {$new, $dataset, $, $css, isFunction, clamp} from './helpers.js';
import * as Status from './status.js';

export async function create(src, pageUrl, error) {
  let p = ai.popup, blank;
  const inGallery = p && !cfg.uiFadeinGallery && ai.gItems && !ai.zooming;
  if (inGallery && p === document.fullscreenElement) {
    destroyBlob();
  } else if (p) {
    destroy();
    p = null;
  }
  ai.imageUrl = src;
  if (!src)
    return;
  const myAi = ai;
  let [xhr, isVideo] = await CspSniffer.check(src, error);
  if (ai !== myAi)
    return;
  if (!xhr && error) {
    App.handleError(error);
    return;
  }
  Object.assign(ai, {pageUrl, xhr});
  if (xhr)
    [src, isVideo] = await Req.getImage(src, pageUrl, xhr).catch(App.handleError) || [];
  let vol;
  if (ai !== myAi || !src || isVideo && (vol = await GM.getValue('volume'), ai !== myAi))
    return;
  if (p) {
    p.src = blank = BLANK_PIXEL;
    p.classList.remove(PREFIX + 'show');
    p.removeAttribute('style');
    ai.popupShown = null;
    ai.popupLoaded = false;
  } else p = ai.popup = isVideo ? PopupVideo.create(vol) : $new('img');
  p.id = `${PREFIX}popup`;
  p.src = src;
  p.addEventListener('error', App.handleError);
  if ((ai.night = (ai.night != null ? ai.night : cfg.night)))
    p.classList.add(`${PREFIX}night`);
  if (ai.zooming)
    p.addEventListener('transitionend', onZoom);
  $dataset(p, 'galleryFlip', inGallery ? '' : null);
  p.toggleAttribute('loaded', !!inGallery);
  const poo = ai.popover || typeof p.showPopover === 'function' && $('[popover]:popover-open');
  ai.popover = poo && poo.getBoundingClientRect().width &&
    ($css(poo, {opacity: 0}), poo) || null;
  if (p.parentElement !== doc.body)
    doc.body.insertBefore(p,
      ai.bar && ai.bar.parentElement === doc.body && ai.bar || null);
  await 0;
  if (ai.popup !== p || App.checkProgress({start: true}) === false)
    return;
  if (!blank && p.complete)
    onLoad.call(p);
  else if (!isVideo)
    p.addEventListener('load', onLoad, {once: true});
}

export function destroy() {
  const p = ai.popup;
  if (!p) return;
  p.removeEventListener('load', onLoad);
  p.removeEventListener('error', App.handleError);
  if (ai.popover) {
    ai.popover.style.removeProperty('opacity');
    ai.popover = null;
  }
  if (isFunction(p.pause))
    p.pause();
  p.remove();
  destroyBlob();
  ai.zoomed = ai.popup = ai.popupLoaded = null;
}

export function destroyBlob() {
  if (!ai.blobUrl) return;
  setTimeout(URL.revokeObjectURL, SETTLE_TIME, ai.blobUrl);
  ai.blobUrl = null;
}

export function move() {
  let x, y;
  const {cx, cy, extras, view} = ai;
  const vw = view.w - extras.outw;
  const vh = view.h - extras.outh;
  const w0 = ai.scale * ai.nwidth + extras.inw;
  const h0 = ai.scale * ai.nheight + extras.inh;
  const isSwapped = ai.rotate % 180;
  const w = isSwapped ? h0 : w0;
  const h = isSwapped ? w0 : h0;
  if (!ai.zoomed && ai.gNum < 2 && !cfg.center) {
    const r = ai.rect;
    const rx = (r.left + r.right) / 2;
    const ry = (r.top + r.bottom) / 2;
    if (vw - r.right - 40 > w || w < r.left - 40) {
      if (h < vh - 60)
        y = clamp(ry - h / 2, 30, vh - h - 30);
      x = rx > vw / 2 ? r.left - 40 - w : r.right + 40;
    } else if (vh - r.bottom - 40 > h || h < r.top - 40) {
      if (w < vw - 60)
        x = clamp(rx - w / 2, 30, vw - w - 30);
      y = ry > vh / 2 ? r.top - 40 - h : r.bottom + 40;
    }
  }
  if (x == null) {
    x = vw > w
      ? (vw - w) / 2 + view.x
      : (vw - w) * clamp(5 / 3 * ((cx - view.x) / vw - .2), -1, 1);
  }
  if (y == null) {
    y = vh > h
      ? (vh - h) / 2 + view.y
      : (vh - h) * clamp(5 / 3 * ((cy - view.y) / vh - .2), -1, 1);
  }
  const diff = isSwapped ? (w0 - h0) / 2 : 0;
  x += extras.o - diff;
  y += extras.o + diff;
  $css(ai.popup, {
    transform: `translate(${Math.round(x)}px, ${Math.round(y)}px) ` +
               `rotate(${ai.rotate || 0}deg) ` +
               `scale(${ai.flipX ? -1 : 1},${ai.flipY ? -1 : 1})`,
    width: `${Math.round(w0)}px`,
    height: `${Math.round(h0)}px`,
  });
}

export function onLoad() {
  if (this === ai.popup) {
    this.setAttribute('loaded', '');
    ai.popupLoaded = true;
    Status.set('-loading');
    App.checkProgress();
    let i = ai.gItem;
    if (i) i.url = this.src;
    if ((i = ai.gItemNext))
      preload(this, i);
  }
}

export function onZoom() {
  this.classList.remove(`${PREFIX}zooming`);
}

export async function preload(p, item, u = item.url, el = $new('img')) {
  ai.gItemNext = null;
  if (!isArray(u)) {
    el.src = u;
    return;
  }
  for (const arr = u; p === ai.popup && item.url === arr && (u = arr[0]);) {
    const {type} = await new Promise(cb => {
      el.src = u;
      el.onload = el.onerror = cb;
    });
    if (arr[0] === u)
      arr.shift();
    if (type === 'load') {
      item.url = u;
      break;
    }
  }
}
