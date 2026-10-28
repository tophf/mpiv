import {ai, startSingle} from './app.js';
import * as Bar from './bar.js';
import {$, $$} from './dom.js';
import * as Req from './request.js';
import * as Ruler from './ruler.js';
import {ensureArray, isArray, isFunction, newFunction, tryCatch} from './util.js';
import {RX_HAS_CODE} from './vars.js';

export function makeParser(g) {
  return isFunction(g) ? g : defaultParser;
}

export function findIndex(gUrl) {
  return Math.max(0,
    ai.gItems.findIndex(({url}) => isArray(url) ? url.includes(gUrl) : url === gUrl));
}

export function next(dir) {
  if (dir) ai.gIndex = nextIndex(dir);
  const item = ai.gItem = ai.gItems[ai.gIndex];
  if (isArray(item.url)) {
    ai.urls = item.url.slice(1);
    ai.url = item.url[0];
  } else {
    ai.urls = null;
    ai.url = item.url;
  }
  ai.gItemNext = ai.gItems[nextIndex(dir || 1)];
  ai.committed = false;
  startSingle();
  Bar.updateName();
  if (dir) Bar.show(0);
}

export function nextIndex(dir) {
  return (ai.gIndex + dir + ai.gNum) % ai.gNum;
}

export function defaultParser(text, doc, docUrl, m, rule) {
  const {g} = rule;
  const gi = g.index;
  const qEntry = g.entry;
  const qCaption = ensureArray(g.caption);
  const qImage = g.image || 'img';
  const qTitle = g.title;
  const fix =
    (typeof g.fix === 'string' ? newFunction('s', 'isURL', g.fix) : g.fix) ||
    (s => s.trim());
  const elems = [...$$(qEntry || qImage, doc)];
  const items = elems.map(processEntry).filter(Boolean);
  items.title = processTitle();
  items.index =
    RX_HAS_CODE.test(gi) ? newFunction('items', 'node', gi)(items, ai.node) :
      typeof gi === 'string' ? Req.findImageUrl(tryCatch($, gi, doc), docUrl) :
        gi == null ? Math.max(0, elems.indexOf(ai.node)) :
          gi;
  return items;

  function processEntry(entry) {
    const item = {};
    try {
      const img = qEntry ? $(qImage, entry) : entry;
      item.url = fix(Req.findImageUrl(img, docUrl), true);
      item.desc = qCaption.map(processCaption, entry).filter(Boolean).join(' - ');
    } catch (e) {}
    return item.url && item;
  }
  /** @this {HTMLElement} */
  function processCaption(sel) {
    const el = !sel ? this
      : $(sel, this) ||
        $orSelf(sel, this.previousElementSibling) ||
        $orSelf(sel, this.nextElementSibling);
    return el && fix(Ruler.runCHandler.default(el) || el.textContent);
  }
  function processTitle() {
    const el = $(qTitle, doc);
    return el && fix(el.getAttribute('content') || el.textContent) || '';
  }
  function $orSelf(selector, el) {
    if (el && !el.matches(qEntry))
      return el.matches(selector) ? el : $(selector, el);
  }
}
