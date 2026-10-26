import {state} from './state.js';
import {ZOOM_MAX, PREFIX, doc, MSG} from './constants.js';
import {App} from './app.js';
import {clamp, sumProps, compareNumbers} from './helpers.js';

const Calc = {

  aspectRatio(w, h) {
    for (let rat = w / h, a, b = 0; ;) {
      b++;
      a = Math.round(w * b / h);
      if (a > 10 && b > 10 || a > 100 || b > 100)
        return rat.toFixed(2);
      if (Math.abs(a / b - rat) < .01)
        return `${a}:${b}`;
    }
  },

  frameSize(elFrame, wnd) {
    if (!elFrame) return;
    const r = elFrame.getBoundingClientRect();
    const w = Math.min(r.right, wnd.innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, wnd.innerHeight) - Math.max(r.top, 0);
    const x = r.left < 0 ? -r.left : 0;
    const y = r.top < 0 ? -r.top : 0;
    return [w, h, x, y];
  },

  generateScales(fit) {
    let [scale, goal] = fit < 1 ? [fit, 1] : [1, fit];
    const zoomStep = state.cfg.zoomStep / 100;
    const arr = [scale];
    if (fit !== 1) {
      const diff = goal / scale;
      const steps = Math.log(diff) / Math.log(zoomStep) | 0;
      const step = steps && Math.pow(diff, 1 / steps);
      for (let i = steps; --i > 0;)
        arr.push((scale *= step));
      arr.push(scale = goal);
    }
    while ((scale *= zoomStep) <= ZOOM_MAX)
      arr.push(scale);
    return arr;
  },

  measurePopup() {
    let {popup: p, nwidth: nw, nheight: nh} = state.ai;
    // overriding custom CSS to detect an unrestricted SVG that scales to the entire page
    p.setAttribute('style', 'display:inline !important;' + App.popupStyleBase);
    if (p.clientWidth > nw) {
      const w = clamp(p.clientWidth, nw, innerWidth / 2) | 0;
      nh = state.ai.nheight = w / nw * nh | 0;
      nw = state.ai.nwidth = w;
      p.style.cssText = `width: ${nw}px !important; height: ${nh}px !important;`;
    } else
      p.style.cssText = '';
    p.classList.add(`${PREFIX}show`);
    const s = getComputedStyle(p);
    const o2 = sumProps(s.outlineOffset, s.outlineWidth) * 2;
    const inw = sumProps(s.paddingLeft, s.paddingRight, s.borderLeftWidth, s.borderRightWidth);
    const inh = sumProps(s.paddingTop, s.paddingBottom, s.borderTopWidth, s.borderBottomWidth);
    const outw = o2 + sumProps(s.marginLeft, s.marginRight);
    const outh = o2 + sumProps(s.marginTop, s.marginBottom);
    state.ai.extras = {
      inw, inh,
      outw, outh,
      o: o2 / 2,
      w: inw + outw,
      h: inh + outh,
    };
    const fit = Math.min(
      (state.ai.view.w - state.ai.extras.w) / state.ai.nwidth,
      (state.ai.view.h - state.ai.extras.h) / state.ai.nheight) || 1;
    const isCustom = !state.cfg.fit && state.cfg.scales.length;
    let cutoff = Math.min(1, fit);
    let scaleZoom = state.cfg.fit === 'all' && fit || state.cfg.fit === 'no' && 1 || cutoff;
    if (isCustom) {
      const dst = [];
      for (const scale of state.cfg.scales) {
        const val = parseFloat(scale) || fit;
        dst.push(val);
        if (isCustom && typeof scale === 'string') {
          if (scale.includes('!')) cutoff = val;
          if (scale.includes('*')) scaleZoom = val;
        }
      }
      state.ai.scales = dst.sort(compareNumbers).filter(Calc.scaleBiggerThan, cutoff);
    } else {
      state.ai.scales = Calc.generateScales(fit);
    }
    state.ai.scale = state.cfg.zoom === 'auto' ? scaleZoom : Math.min(1, fit);
    state.ai.scaleFit = fit;
    state.ai.scaleZoom = scaleZoom;
  },

  rect() {
    const {node, rule} = state.ai;
    let n = rule.rect && node.closest(rule.rect);
    if (n) return n.getBoundingClientRect();
    const nested = (n = node).firstElementChild
      ? document.elementsFromPoint(state.ai.cx, state.ai.cy) : [];
    let maxArea = 0;
    let maxBounds;
    let i = 0;
    do {
      const bounds = n.getBoundingClientRect();
      const area = bounds.width * bounds.height;
      if (area > maxArea) {
        maxArea = area;
        maxBounds = bounds;
      }
    } while ((n = nested[i++]) && node.contains(n));
    return maxBounds;
  },

  scaleBiggerThan(scale, i, arr) {
    return scale >= this && (!i || Math.abs(scale - arr[i - 1]) > .01);
  },

  scaleIndex(dir) {
    const i = state.ai.scales.indexOf(state.ai.scale);
    if (i >= 0) return i + dir;
    for (
      let len = state.ai.scales.length,
        i = dir > 0 ? 0 : len - 1;
      i >= 0 && i < len;
      i += dir
    ) {
      if (Math.sign(state.ai.scales[i] - state.ai.scale) === dir)
        return i;
    }
    return -1;
  },

  scaleForFirstZoom(keepScale) {
    const z = state.ai.scaleZoom;
    return keepScale || z !== state.ai.scale ? z : state.ai.scales.find(x => x > z);
  },

  updateViewSize() {
    const view = doc.compatMode === 'BackCompat' ? doc.body : doc.documentElement;
    state.ai.view = {w: view.clientWidth, h: view.clientHeight, x: 0, y: 0};
    if (window === top) return;
    const [w, h] = Calc.frameSize(frameElement, parent) || [];
    if (w && h) {
      state.ai.view = {w, h, x: 0, y: 0};
    } else {
      addEventListener('message', App.onMessageChild, true);
      parent.postMessage(MSG.getViewSize, '*');
    }
  },
};

export {
  Calc,
};
