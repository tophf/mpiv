import {state} from './state.js';
import {CspSniffer} from './csp.js';
import {App} from './app.js';
import {Req} from './request.js';
import {GM} from './gm.js';
import {BLANK_PIXEL, PREFIX, doc, SETTLE_TIME, isArray} from './constants.js';
import {PopupVideo} from './popup-video.js';
import {$new, $dataset, $, $css, isFunction, clamp} from './helpers.js';
import {Status} from './status.js';

const Popup = {

  async create(src, pageUrl, error) {
    let p = state.ai.popup, blank;
    const inGallery = p && !state.cfg.uiFadeinGallery && state.ai.gItems && !state.ai.zooming;
    if (inGallery && p === document.fullscreenElement) {
      Popup.destroyBlob();
    } else if (p) {
      Popup.destroy();
      p = null;
    }
    state.ai.imageUrl = src;
    if (!src)
      return;
    const myAi = state.ai;
    let [xhr, isVideo] = await CspSniffer.check(src, error);
    if (state.ai !== myAi)
      return;
    if (!xhr && error) {
      App.handleError(error);
      return;
    }
    Object.assign(state.ai, {pageUrl, xhr});
    if (xhr)
      [src, isVideo] = await Req.getImage(src, pageUrl, xhr).catch(App.handleError) || [];
    let vol;
    if (state.ai !== myAi || !src || isVideo && (vol = await GM.getValue('volume'), state.ai !== myAi))
      return;
    if (p) {
      p.src = blank = BLANK_PIXEL;
      p.classList.remove(PREFIX + 'show');
      p.removeAttribute('style');
      state.ai.popupShown = null;
      state.ai.popupLoaded = false;
    } else p = state.ai.popup = isVideo ? PopupVideo.create(vol) : $new('img');
    p.id = `${PREFIX}popup`;
    p.src = src;
    p.addEventListener('error', App.handleError);
    if ((state.ai.night = (state.ai.night != null ? state.ai.night : state.cfg.night)))
      p.classList.add(`${PREFIX}night`);
    if (state.ai.zooming)
      p.addEventListener('transitionend', Popup.onZoom);
    $dataset(p, 'galleryFlip', inGallery ? '' : null);
    p.toggleAttribute('loaded', !!inGallery);
    const poo = state.ai.popover || typeof p.showPopover === 'function' && $('[popover]:popover-open');
    state.ai.popover = poo && poo.getBoundingClientRect().width &&
      ($css(poo, {opacity: 0}), poo) || null;
    if (p.parentElement !== doc.body)
      doc.body.insertBefore(p,
        state.ai.bar && state.ai.bar.parentElement === doc.body && state.ai.bar || null);
    await 0;
    if (state.ai.popup !== p || App.checkProgress({start: true}) === false)
      return;
    if (!blank && p.complete)
      Popup.onLoad.call(p);
    else if (!isVideo)
      p.addEventListener('load', Popup.onLoad, {once: true});
  },

  destroy() {
    const p = state.ai.popup;
    if (!p) return;
    p.removeEventListener('load', Popup.onLoad);
    p.removeEventListener('error', App.handleError);
    if (state.ai.popover) {
      state.ai.popover.style.removeProperty('opacity');
      state.ai.popover = null;
    }
    if (isFunction(p.pause))
      p.pause();
    p.remove();
    Popup.destroyBlob();
    state.ai.zoomed = state.ai.popup = state.ai.popupLoaded = null;
  },

  destroyBlob() {
    if (!state.ai.blobUrl) return;
    setTimeout(URL.revokeObjectURL, SETTLE_TIME, state.ai.blobUrl);
    state.ai.blobUrl = null;
  },

  move() {
    let x, y;
    const {cx, cy, extras, view} = state.ai;
    const vw = view.w - extras.outw;
    const vh = view.h - extras.outh;
    const w0 = state.ai.scale * state.ai.nwidth + extras.inw;
    const h0 = state.ai.scale * state.ai.nheight + extras.inh;
    const isSwapped = state.ai.rotate % 180;
    const w = isSwapped ? h0 : w0;
    const h = isSwapped ? w0 : h0;
    if (!state.ai.zoomed && state.ai.gNum < 2 && !state.cfg.center) {
      const r = state.ai.rect;
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
    $css(state.ai.popup, {
      transform: `translate(${Math.round(x)}px, ${Math.round(y)}px) ` +
                 `rotate(${state.ai.rotate || 0}deg) ` +
                 `scale(${state.ai.flipX ? -1 : 1},${state.ai.flipY ? -1 : 1})`,
      width: `${Math.round(w0)}px`,
      height: `${Math.round(h0)}px`,
    });
  },

  onLoad() {
    if (this === state.ai.popup) {
      this.setAttribute('loaded', '');
      state.ai.popupLoaded = true;
      Status.set('-loading');
      App.checkProgress();
      let i = state.ai.gItem;
      if (i) i.url = this.src;
      if ((i = state.ai.gItemNext))
        Popup.preload(this, i);
    }
  },

  onZoom() {
    this.classList.remove(`${PREFIX}zooming`);
  },

  async preload(p, item, u = item.url, el = $new('img')) {
    state.ai.gItemNext = null;
    if (!isArray(u)) {
      el.src = u;
      return;
    }
    for (const arr = u; p === state.ai.popup && item.url === arr && (u = arr[0]);) {
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
  },
};

export {
  Popup,
};
