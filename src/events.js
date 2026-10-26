import {ai, elSetup, cfg} from './state.js';
import * as Instagram from './instagram.js';
import * as App from './app.js';
import {doc, SETTLE_TIME, NOAA_ATTR, PREFIX, isFF, WHEEL_EVENT} from './constants.js';
import {now, dropEvent, describeKey, isVideo} from './helpers.js';
import * as Ruler from './rules.js';
import * as RuleMatcher from './rule-matcher.js';
import * as Popup from './popup.js';
import * as Status from './status.js';
import * as Gallery from './gallery.js';
import * as Bar from './bar.js';
import * as Req from './request.js';
import * as GM from './gm.js';
import * as Util from './util.js';
import * as Calc from './calc.js';

export let ctrl = false;
export let hoverData = null;
export let hoverTimer = 0;
export let ignoreKeyHeld = false;

export const setCtrl = val => (ctrl = val);

export function onMouseOver(e) {
  if (Instagram.relayEmbedEvent(e)) return;
  let node = e.target;
  ignoreKeyHeld = e.shiftKey;
  if (!App.isEnabled ||
      e.shiftKey ||
      ai.zoomed ||
      node === ai.popup ||
      node === doc.body ||
      node === doc.documentElement ||
      node === elSetup ||
      ai.gallery && ai.rectHovered ||
      !App.canClose())
    return;
  if (node.shadowRoot)
    node = pierceShadow(node, e.clientX, e.clientY);
  // we don't want to process everything in the path of a quickly moving mouse cursor
  hoverData = {e, node, start: now()};
  hoverTimer = hoverTimer || setTimeout(onMouseOverThrottled, SETTLE_TIME);
  node.addEventListener('mouseout', onMouseOutThrottled);
}

export function onMouseOverThrottled(force) {
  const {start, e, node, nodeOut} = hoverData || {};
  if (!node || node === nodeOut && (hoverData = null, 1))
    return;
  // clearTimeout + setTimeout is expensive so we'll use the cheaper perf.now() for rescheduling
  const wait = force ? 0 : start + SETTLE_TIME - now();
  const t = hoverTimer = wait > 10 && setTimeout(onMouseOverThrottled, wait);
  if (t)
    return;
  hoverData = null;
  if (!Ruler.rules)
    Ruler.init();
  const info = RuleMatcher.adaptiveFind(node);
  if (info && info.url && info.node !== ai.node)
    App.activate(info, e);
}

export function onMouseOut(e) {
  if (!e.relatedTarget && !cfg.keepOnBlur && !e.shiftKey && App.canClose())
    App.deactivate();
}

export function onMouseOutThrottled(/*e*/) {
  const d = hoverData;
  if (d) d.nodeOut = this;
  this.removeEventListener('mouseout', onMouseOutThrottled);
  hoverTimer = 0;
}

export function onMouseOutShadow(e) {
  const root = e.target.shadowRoot;
  if (root) {
    root.removeEventListener('mouseover', onMouseOver);
    root.removeEventListener('mouseout', onMouseOutShadow);
  }
}

export function onMouseMove(e) {
  trackMouse(e);
  if (e.shiftKey)
    return;
  if (!ai.zoomed && !ai.rectHovered && App.canClose()) {
    App.deactivate();
  } else if (ai.zoomed) {
    Popup.move();
    const {cx, cy, view: {w, h}} = ai;
    const bx = w / 6;
    const by = h / 6;
    const onEdge = cx < bx || cx > w - bx || cy < by || cy > h - by;
    Status.set(`${onEdge ? '+' : '-'}edge`);
  }
}

export function onMouseDown({shiftKey, button, target}) {
  if (!button && target === ai.popup && ai.popup.controls &&
      (shiftKey || !App.canClose())) {
    ai.controlled = ai.zoomed = true;
  } else if (button === 2 || shiftKey) {
    // Shift = ignore; RMB will be processed in onContext
  } else {
    App.deactivate({wait: true});
    doc.addEventListener('mouseup', App.enable, {once: true});
  }
}

export function onMouseScroll(e) {
  const dir = (e.deltaY || -e.wheelDelta) < 0 ? 1 : -1;
  if (ai.zoomed) {
    zoomInOut(dir);
  } else if (ai.gNum > 1 && ai.popup) {
    Gallery.next(-dir);
  } else if (cfg.zoom === 'wheel' && dir > 0 && ai.popup) {
    App.toggleZoom();
  } else if (App.canClose()) {
    App.deactivate();
    return;
  }
  dropEvent(e);
}

export function onKeyDown(e) {
  // Synthesized events may be of the wrong type and not have a `key`
  const key = describeKey(e);
  const p = ai.popupShown;
  if (!p && key === '^Control') {
    addEventListener('keyup', onKeyUp, true);
    ctrl = true;
  }
  if (!p && key === '^ContextMenu')
    return onContext.call(this, e);
  if (!p || e.repeat)
    return;
  switch (key) {
    case '+Shift':
      if (ai.shiftKeyTime)
        return;
      ai.shiftKeyTime = now();
      Status.set('+shift');
      if (cfg.uiInfo)
        Bar.show(1);
      if (isVideo(p))
        p.controls = true;
      return;
    case 'KeyA':
      p.toggleAttribute(NOAA_ATTR);
      break;
    case 'ArrowRight':
    case 'KeyJ':
      Gallery.next(1);
      break;
    case 'ArrowLeft':
    case 'KeyK':
      Gallery.next(-1);
      break;
    case 'KeyC':
      if (ai.bar.firstChild) {
        Bar.setText('');
        Bar.hide(0);
      } else {
        Bar.setText(ai.barText);
        Bar.show(2);
      }
      break;
    case 'KeyD':
      Req.saveFile();
      break;
    case 'KeyF':
      if (p !== document.fullscreenElement) p.requestFullscreen();
      else document.exitFullscreen();
      break;
    case 'KeyH': // flip horizontally
    case 'KeyV': // flip vertically
    case 'KeyL': // rotate left
    case 'KeyR': // rotate right
      if (!p)
        return;
      if (key === 'KeyH' || key === 'KeyV') {
        const side = !!(ai.rotate % 180) ^ (key === 'KeyH') ? 'flipX' : 'flipY';
        ai[side] = !ai[side];
      } else {
        ai.rotate = ((ai.rotate || 0) + 90 * (key === 'KeyL' ? -1 : 1) + 360) % 360;
      }
      Bar.updateDetails();
      Popup.move();
      break;
    case 'KeyI':
      (ai.barShown ? Bar.hide : Bar.show)(2);
      break;
    case 'KeyM':
      if (isVideo(p))
        p.muted = !p.muted;
      break;
    case 'KeyN':
      ai.night = p.classList.toggle(`${PREFIX}night`);
      break;
    case 'KeyT':
      GM.openInTab(Util.tabFixUrl() || p.src);
      App.deactivate();
      break;
    case 'Minus':
    case 'NumpadSubtract':
      if (ai.zoomed) {
        zoomInOut(-1);
      } else {
        App.toggleZoom();
      }
      break;
    case 'Equal':
    case 'NumpadAdd':
      if (ai.zoomed) {
        zoomInOut(1);
      } else {
        App.toggleZoom();
      }
      break;
    case 'Escape':
      App.deactivate({wait: true});
      break;
    case '!Alt':
      return;
    default:
      App.deactivate({wait: true});
      return;
  }
  dropEvent(e);
}

export function onKeyUp(e) {
  const p = ai.popupShown || false;
  if (e.key === 'Control') {
    if (!p) removeEventListener('keyup', onKeyUp, true);
    setTimeout(() => (ctrl = false));
  }
  if (p && e.key === 'Shift' && ai.shiftKeyTime) {
    Status.set('-shift');
    if (cfg.uiInfo)
      Bar.hide(1);
    if (p.controls)
      p.controls = false;
    // Chrome doesn't expose events for clicks on video controls so we'll guess
    if (ai.controlled || !isFF && now() - ai.shiftKeyTime > 500)
      ai.controlled = false;
    else if (p && (ai.zoomed || ai.rectHovered !== false))
      App.toggleZoom();
    else
      App.deactivate({wait: true});
    ai.shiftKeyTime = 0;
  } else if (
    describeKey(e) === 'Control' && !p && !ignoreKeyHeld &&
    (cfg.start === 'ctrl' || cfg.start === 'context' || ai.rule.manual)
  ) {
    dropEvent(e);
    if (hoverData) {
      hoverData.e = e;
      onMouseOverThrottled(true);
    }
    if (ai.node) {
      ai.force = true;
      App.start();
    }
  }
}

export function onContext(e) {
  if (ignoreKeyHeld)
    return;
  const p = ai.popupShown;
  if (cfg.zoom === 'context' && p && App.toggleZoom()) {
    dropEvent(e);
  } else if (!p && (!cfg.videoCtrl || !isVideo(ai.node) || ctrl) && (
    cfg.start === 'context' ||
    cfg.start === 'contextMK' ||
    cfg.start === 'contextM' && (e.button === 2) ||
    cfg.start === 'contextK' && (e.button !== 2) ||
    (cfg.start === 'auto' && ai.rule.manual)
  )) {
    // right-clicked on an image while the context menu is shown for something else
    if (!ai.node) {
      if (!hoverData)
        onMouseOver(e);
      onMouseOverThrottled(true);
    }
    if (ai.node) {
      ai.force = true;
      App.start();
      dropEvent(e);
    }
  } else if (p) {
    setTimeout(App.deactivate, SETTLE_TIME, {wait: true});
  }
}

export function onVisibility(/*e*/) {
  ctrl = false;
}

export function pierceShadow(node, x, y) {
  for (let root; (root = node.shadowRoot);) {
    root.addEventListener('mouseover', onMouseOver, {passive: true});
    root.addEventListener('mouseout', onMouseOutShadow);
    const inner = root.elementFromPoint(x, y);
    if (!inner || inner === node)
      break;
    node = inner;
  }
  return node;
}

export function toggle(enable) {
  const onOff = enable ? 'addEventListener' : 'removeEventListener';
  const passive = {passive: true, capture: true};
  window[onOff]('mousemove', onMouseMove, passive);
  window[onOff]('mouseout', onMouseOut, passive);
  window[onOff]('mousedown', onMouseDown, passive);
  window[onOff]('keyup', onKeyUp, true);
  window[onOff](WHEEL_EVENT, onMouseScroll, {passive: false, capture: true});
  ai.node.removeEventListener('mouseout', onMouseOutThrottled);
}

export function trackMouse(e) {
  const cx = ai.cx = e.clientX;
  const cy = ai.cy = e.clientY;
  const r = ai.rect || (ai.rect = Calc.rect());
  ai.rectHovered = !r ? false :
    cx > r.left - 2 && cx < r.right + 2 &&
    cy > r.top - 2 && cy < r.bottom + 2;
}

export function zoomInOut(dir) {
  const i = Calc.scaleIndex(dir);
  const n = ai.scales.length;
  if (i >= 0 && i < n)
    ai.scale = ai.scales[i];
  const zo = cfg.zoomOut;
  if (i <= 0 && zo !== 'stay') {
    if (ai.scaleFit < ai.scale * .99) {
      ai.scales.unshift(ai.scale = ai.scaleFit);
    } else if ((i <= 0 && zo === 'close' || i < 0 && !ai.rectHovered) && ai.gNum < 2) {
      App.deactivate({wait: true});
      return;
    }
    ai.zoomed = zo !== 'unzoom';
  } else {
    ai.popup.classList.toggle(`${PREFIX}zoom-max`, ai.scale >= 4 && i >= n - 1);
  }
  if (ai.zooming)
    ai.popup.classList.add(`${PREFIX}zooming`);
  Popup.move();
  Bar.updateDetails();
}
