import * as Instagram from './instagram.js';
import {App} from './app.js';
import {state} from './state.js';
import {doc, SETTLE_TIME, NOAA_ATTR, PREFIX, isFF, WHEEL_EVENT} from './constants.js';
import {now, dropEvent, describeKey, isVideo} from './helpers.js';
import {Ruler} from './rules.js';
import {RuleMatcher} from './rule-matcher.js';
import {Popup} from './popup.js';
import {Status} from './status.js';
import {Gallery} from './gallery.js';
import {Bar} from './bar.js';
import {Req} from './request.js';
import {GM} from './gm.js';
import {Util} from './util.js';
import {Calc} from './calc.js';

const Events = {

  ctrl: false,
  hoverData: null,
  hoverTimer: 0,
  ignoreKeyHeld: false,

  onMouseOver(e) {
    if (Instagram.relayEmbedEvent(e)) return;
    let node = e.target;
    Events.ignoreKeyHeld = e.shiftKey;
    if (!App.isEnabled ||
        e.shiftKey ||
        state.ai.zoomed ||
        node === state.ai.popup ||
        node === doc.body ||
        node === doc.documentElement ||
        node === state.elSetup ||
        state.ai.gallery && state.ai.rectHovered ||
        !App.canClose())
      return;
    if (node.shadowRoot)
      node = Events.pierceShadow(node, e.clientX, e.clientY);
    // we don't want to process everything in the path of a quickly moving mouse cursor
    Events.hoverData = {e, node, start: now()};
    Events.hoverTimer = Events.hoverTimer || setTimeout(Events.onMouseOverThrottled, SETTLE_TIME);
    node.addEventListener('mouseout', Events.onMouseOutThrottled);
  },

  onMouseOverThrottled(force) {
    const {start, e, node, nodeOut} = Events.hoverData || {};
    if (!node || node === nodeOut && (Events.hoverData = null, 1))
      return;
    // clearTimeout + setTimeout is expensive so we'll use the cheaper perf.now() for rescheduling
    const wait = force ? 0 : start + SETTLE_TIME - now();
    const t = Events.hoverTimer = wait > 10 && setTimeout(Events.onMouseOverThrottled, wait);
    if (t)
      return;
    Events.hoverData = null;
    if (!Ruler.rules)
      Ruler.init();
    const info = RuleMatcher.adaptiveFind(node);
    if (info && info.url && info.node !== state.ai.node)
      App.activate(info, e);
  },

  onMouseOut(e) {
    if (!e.relatedTarget && !state.cfg.keepOnBlur && !e.shiftKey && App.canClose())
      App.deactivate();
  },

  onMouseOutThrottled(/*e*/) {
    const d = Events.hoverData;
    if (d) d.nodeOut = this;
    this.removeEventListener('mouseout', Events.onMouseOutThrottled);
    Events.hoverTimer = 0;
  },

  onMouseOutShadow(e) {
    const root = e.target.shadowRoot;
    if (root) {
      root.removeEventListener('mouseover', Events.onMouseOver);
      root.removeEventListener('mouseout', Events.onMouseOutShadow);
    }
  },

  onMouseMove(e) {
    Events.trackMouse(e);
    if (e.shiftKey)
      return;
    if (!state.ai.zoomed && !state.ai.rectHovered && App.canClose()) {
      App.deactivate();
    } else if (state.ai.zoomed) {
      Popup.move();
      const {cx, cy, view: {w, h}} = state.ai;
      const bx = w / 6;
      const by = h / 6;
      const onEdge = cx < bx || cx > w - bx || cy < by || cy > h - by;
      Status.set(`${onEdge ? '+' : '-'}edge`);
    }
  },

  onMouseDown({shiftKey, button, target}) {
    if (!button && target === state.ai.popup && state.ai.popup.controls &&
        (shiftKey || !App.canClose())) {
      state.ai.controlled = state.ai.zoomed = true;
    } else if (button === 2 || shiftKey) {
      // Shift = ignore; RMB will be processed in onContext
    } else {
      App.deactivate({wait: true});
      doc.addEventListener('mouseup', App.enable, {once: true});
    }
  },

  onMouseScroll(e) {
    const dir = (e.deltaY || -e.wheelDelta) < 0 ? 1 : -1;
    if (state.ai.zoomed) {
      Events.zoomInOut(dir);
    } else if (state.ai.gNum > 1 && state.ai.popup) {
      Gallery.next(-dir);
    } else if (state.cfg.zoom === 'wheel' && dir > 0 && state.ai.popup) {
      App.toggleZoom();
    } else if (App.canClose()) {
      App.deactivate();
      return;
    }
    dropEvent(e);
  },

  onKeyDown(e) {
    // Synthesized events may be of the wrong type and not have a `key`
    const key = describeKey(e);
    const p = state.ai.popupShown;
    if (!p && key === '^Control') {
      addEventListener('keyup', Events.onKeyUp, true);
      Events.ctrl = true;
    }
    if (!p && key === '^ContextMenu')
      return Events.onContext.call(this, e);
    if (!p || e.repeat)
      return;
    switch (key) {
      case '+Shift':
        if (state.ai.shiftKeyTime)
          return;
        state.ai.shiftKeyTime = now();
        Status.set('+shift');
        if (state.cfg.uiInfo)
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
        if (state.ai.bar.firstChild) {
          Bar.setText('');
          Bar.hide(0);
        } else {
          Bar.setText(state.ai.barText);
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
          const side = !!(state.ai.rotate % 180) ^ (key === 'KeyH') ? 'flipX' : 'flipY';
          state.ai[side] = !state.ai[side];
        } else {
          state.ai.rotate = ((state.ai.rotate || 0) + 90 * (key === 'KeyL' ? -1 : 1) + 360) % 360;
        }
        Bar.updateDetails();
        Popup.move();
        break;
      case 'KeyI':
        (state.ai.barShown ? Bar.hide : Bar.show)(2);
        break;
      case 'KeyM':
        if (isVideo(p))
          p.muted = !p.muted;
        break;
      case 'KeyN':
        state.ai.night = p.classList.toggle(`${PREFIX}night`);
        break;
      case 'KeyT':
        GM.openInTab(Util.tabFixUrl() || p.src);
        App.deactivate();
        break;
      case 'Minus':
      case 'NumpadSubtract':
        if (state.ai.zoomed) {
          Events.zoomInOut(-1);
        } else {
          App.toggleZoom();
        }
        break;
      case 'Equal':
      case 'NumpadAdd':
        if (state.ai.zoomed) {
          Events.zoomInOut(1);
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
  },

  onKeyUp(e) {
    const p = state.ai.popupShown || false;
    if (e.key === 'Control') {
      if (!p) removeEventListener('keyup', Events.onKeyUp, true);
      setTimeout(() => (Events.ctrl = false));
    }
    if (p && e.key === 'Shift' && state.ai.shiftKeyTime) {
      Status.set('-shift');
      if (state.cfg.uiInfo)
        Bar.hide(1);
      if (p.controls)
        p.controls = false;
      // Chrome doesn't expose events for clicks on video controls so we'll guess
      if (state.ai.controlled || !isFF && now() - state.ai.shiftKeyTime > 500)
        state.ai.controlled = false;
      else if (p && (state.ai.zoomed || state.ai.rectHovered !== false))
        App.toggleZoom();
      else
        App.deactivate({wait: true});
      state.ai.shiftKeyTime = 0;
    } else if (
      describeKey(e) === 'Control' && !p && !Events.ignoreKeyHeld &&
      (state.cfg.start === 'ctrl' || state.cfg.start === 'context' || state.ai.rule.manual)
    ) {
      dropEvent(e);
      if (Events.hoverData) {
        Events.hoverData.e = e;
        Events.onMouseOverThrottled(true);
      }
      if (state.ai.node) {
        state.ai.force = true;
        App.start();
      }
    }
  },

  onContext(e) {
    if (Events.ignoreKeyHeld)
      return;
    const p = state.ai.popupShown;
    if (state.cfg.zoom === 'context' && p && App.toggleZoom()) {
      dropEvent(e);
    } else if (!p && (!state.cfg.videoCtrl || !isVideo(state.ai.node) || Events.ctrl) && (
      state.cfg.start === 'context' ||
      state.cfg.start === 'contextMK' ||
      state.cfg.start === 'contextM' && (e.button === 2) ||
      state.cfg.start === 'contextK' && (e.button !== 2) ||
      (state.cfg.start === 'auto' && state.ai.rule.manual)
    )) {
      // right-clicked on an image while the context menu is shown for something else
      if (!state.ai.node) {
        if (!Events.hoverData)
          Events.onMouseOver(e);
        Events.onMouseOverThrottled(true);
      }
      if (state.ai.node) {
        state.ai.force = true;
        App.start();
        dropEvent(e);
      }
    } else if (p) {
      setTimeout(App.deactivate, SETTLE_TIME, {wait: true});
    }
  },

  onVisibility(/*e*/) {
    Events.ctrl = false;
  },

  pierceShadow(node, x, y) {
    for (let root; (root = node.shadowRoot);) {
      root.addEventListener('mouseover', Events.onMouseOver, {passive: true});
      root.addEventListener('mouseout', Events.onMouseOutShadow);
      const inner = root.elementFromPoint(x, y);
      if (!inner || inner === node)
        break;
      node = inner;
    }
    return node;
  },

  toggle(enable) {
    const onOff = enable ? 'addEventListener' : 'removeEventListener';
    const passive = {passive: true, capture: true};
    window[onOff]('mousemove', Events.onMouseMove, passive);
    window[onOff]('mouseout', Events.onMouseOut, passive);
    window[onOff]('mousedown', Events.onMouseDown, passive);
    window[onOff]('keyup', Events.onKeyUp, true);
    window[onOff](WHEEL_EVENT, Events.onMouseScroll, {passive: false, capture: true});
    state.ai.node.removeEventListener('mouseout', Events.onMouseOutThrottled);
  },

  trackMouse(e) {
    const cx = state.ai.cx = e.clientX;
    const cy = state.ai.cy = e.clientY;
    const r = state.ai.rect || (state.ai.rect = Calc.rect());
    state.ai.rectHovered = !r ? false :
      cx > r.left - 2 && cx < r.right + 2 &&
      cy > r.top - 2 && cy < r.bottom + 2;
  },

  zoomInOut(dir) {
    const i = Calc.scaleIndex(dir);
    const n = state.ai.scales.length;
    if (i >= 0 && i < n)
      state.ai.scale = state.ai.scales[i];
    const zo = state.cfg.zoomOut;
    if (i <= 0 && zo !== 'stay') {
      if (state.ai.scaleFit < state.ai.scale * .99) {
        state.ai.scales.unshift(state.ai.scale = state.ai.scaleFit);
      } else if ((i <= 0 && zo === 'close' || i < 0 && !state.ai.rectHovered) && state.ai.gNum < 2) {
        App.deactivate({wait: true});
        return;
      }
      state.ai.zoomed = zo !== 'unzoom';
    } else {
      state.ai.popup.classList.toggle(`${PREFIX}zoom-max`, state.ai.scale >= 4 && i >= n - 1);
    }
    if (state.ai.zooming)
      state.ai.popup.classList.add(`${PREFIX}zooming`);
    Popup.move();
    Bar.updateDetails();
  },
};

export {
  Events,
};
