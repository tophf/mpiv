import {state} from './state.js';
import {$remove, $new, $dataset} from './helpers.js';
import {PREFIX, doc} from './constants.js';
import {App} from './app.js';
import {Util} from './util.js';
import {Calc} from './calc.js';

const Bar = {

  set(label, cls, prefix) {
    let b = state.ai.bar;
    if (typeof label !== 'string') {
      $remove(b);
      state.ai.bar = null;
      return;
    }
    const force = !b && 0;
    if (!b) b = state.ai.bar = $new('div', {id: `${PREFIX}bar`, className: `${PREFIX}${cls}`});
    state.ai.barText = label;
    App.updateStyles();
    Bar.updateDetails();
    Bar.setText(state.cfg.uiInfoCaption || cls === 'error' || cls === 'xhr' ? label : '');
    $dataset(b, 'prefix', prefix);
    setTimeout(Bar.show, 0, force);
    if (!b.parentNode) {
      doc.body.appendChild(b);
      Util.forceLayout(b);
    }
  },

  setText(text) {
    if (/<([a-z][-a-z]*)[^<>]*>[^<>]*<\/\1\s*>/i.test(text)) { // checking for <tag...>...</tag>
      state.ai.bar.innerHTML = state.trustedHTML ? state.trustedHTML(text) : text;
    } else {
      state.ai.bar.textContent = text;
    }
  },

  show(force) {
    const b = state.ai.bar;
    if (!force && (!state.cfg.uiInfo || force !== 0 && state.cfg.uiInfoOnce) || state.ai.barShown)
      return;
    clearTimeout(state.ai.timerBar);
    b.classList.add(PREFIX + 'show');
    $dataset(b, 'force', force === 2 ? '' : null);
    state.ai.timerBar = !force && setTimeout(Bar.hide, state.cfg.uiInfoHide * 1000);
    state.ai.barShown = true;
  },

  hide(force) {
    const b = state.ai.bar;
    if (!b || !force && (!state.cfg.uiInfo || b.dataset.force) || !state.ai.barShown)
      return;
    $dataset(b, 'force', force === 2 ? '' : null);
    b.classList.remove(PREFIX + 'show');
    state.ai.barShown = false;
  },

  updateName() {
    const {gItems: gi, gIndex: i, gNum: n} = state.ai;
    if (gi) {
      const item = gi[i];
      const noDesc = !gi.some(_ => _.desc);
      const c = [
        gi.title && (!i || noDesc) && !`${item.desc || ''}`.includes(gi.title) && gi.title || '',
        item.desc,
      ].filter(Boolean).join(' - ');
      Bar.set(c.trim() || ' ', 'gallery', n > 1 ? `${i + 1}/${n}` : null);
    } else if ('caption' in state.ai) {
      Bar.set(state.ai.caption, 'caption');
    } else if (state.ai.tooltip) {
      Bar.set(state.ai.tooltip.text, 'tooltip');
    } else {
      Bar.set(' ', 'info');
    }
  },

  updateDetails() {
    if (!state.ai.bar) return;
    const r = state.ai.rotate;
    const zoom = state.ai.nwidth && `${
      Math.round(state.ai.scale * 100)
    }%${
      state.ai.flipX || state.ai.flipY ? `, ${state.ai.flipX ? '⇆' : ''}${state.ai.flipY ? '⇅' : ''}` : ''
    }${
      r ? ', ' + (r > 180 ? r - 360 : r) + '°' : ''
    }, ${
      state.ai.nwidth
    } x ${
      state.ai.nheight
    } px, ${
      Math.round(100 * (state.ai.nwidth * state.ai.nheight / 1e6)) / 100
    } MP, ${
      Calc.aspectRatio(state.ai.nwidth, state.ai.nheight)
    }`.replace(/\x20/g, '\xA0');
    if (state.ai.bar.dataset.zoom !== zoom || !state.ai.nwidth) {
      $dataset(state.ai.bar, 'zoom', zoom || null);
      Bar.show();
    }
  },
};

export {
  Bar,
};
