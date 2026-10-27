import {ai, cfg} from './app.js';
import * as Calc from './calc.js';
import {$dataset, $new, $remove, doc} from './dom.js';
import {updateStyles} from './styles.js';
import {forceLayout, trustedHTML} from './util.js';

export function set(label, cls, prefix) {
  let b = ai.bar;
  if (typeof label !== 'string') {
    $remove(b);
    ai.bar = null;
    return;
  }
  const force = !b && 0;
  if (!b) b = ai.bar = $new('div', {id: PREFIX + 'bar', className: PREFIX + cls});
  ai.barText = label;
  updateStyles();
  updateDetails();
  setText(cfg.uiInfoCaption || cls === 'error' || cls === 'xhr' ? label : '');
  $dataset(b, 'prefix', prefix);
  setTimeout(show, 0, force);
  if (!b.parentNode) {
    doc.body.appendChild(b);
    forceLayout(b);
  }
}

export function setText(text) {
  if (/<([a-z][-a-z]*)[^<>]*>[^<>]*<\/\1\s*>/i.test(text)) { // checking for <tag...>...</tag>
    ai.bar.innerHTML = trustedHTML ? trustedHTML(text) : text;
  } else {
    ai.bar.textContent = text;
  }
}

export function show(force) {
  const b = ai.bar;
  if (!force && (!cfg.uiInfo || force !== 0 && cfg.uiInfoOnce) || ai.barShown)
    return;
  clearTimeout(ai.timerBar);
  b.classList.add(PREFIX + 'show');
  $dataset(b, 'force', force === 2 ? '' : null);
  ai.timerBar = !force && setTimeout(hide, cfg.uiInfoHide * 1000);
  ai.barShown = true;
}

export function hide(force) {
  const b = ai.bar;
  if (!b || !force && (!cfg.uiInfo || b.dataset.force) || !ai.barShown)
    return;
  $dataset(b, 'force', force === 2 ? '' : null);
  b.classList.remove(PREFIX + 'show');
  ai.barShown = false;
}

export function updateName() {
  const {gItems: gi, gIndex: i, gNum: n} = ai;
  if (gi) {
    const item = gi[i];
    const noDesc = !gi.some(_ => _.desc);
    const c = [
      gi.title && (!i || noDesc) && !`${item.desc || ''}`.includes(gi.title) && gi.title || '',
      item.desc,
    ].filter(Boolean).join(' - ');
    set(c.trim() || ' ', 'gallery', n > 1 ? `${i + 1}/${n}` : null);
  } else if ('caption' in ai) {
    set(ai.caption, 'caption');
  } else if (ai.tooltip) {
    set(ai.tooltip.text, 'tooltip');
  } else {
    set(' ', 'info');
  }
}

export function updateDetails() {
  if (!ai.bar) return;
  const r = ai.rotate;
  const zoom = ai.nwidth && `${
    Math.round(ai.scale * 100)
  }%${
    ai.flipX || ai.flipY ? `, ${ai.flipX ? '⇆' : ''}${ai.flipY ? '⇅' : ''}` : ''
  }${
    r ? ', ' + (r > 180 ? r - 360 : r) + '°' : ''
  }, ${
    ai.nwidth
  } x ${
    ai.nheight
  } px, ${
    Math.round(100 * (ai.nwidth * ai.nheight / 1e6)) / 100
  } MP, ${
    Calc.aspectRatio(ai.nwidth, ai.nheight)
  }`.replace(/\x20/g, '\xA0');
  if (ai.bar.dataset.zoom !== zoom || !ai.nwidth) {
    $dataset(ai.bar, 'zoom', zoom || null);
    show();
  }
}
