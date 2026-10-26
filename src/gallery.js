import {isFunction, ensureArray, $$, tryCatch, $} from './helpers.js';
import {state} from './state.js';
import {isArray, RX_HAS_CODE} from './constants.js';
import {App} from './app.js';
import {Bar} from './bar.js';
import {Util} from './util.js';
import {Req} from './request.js';
import {Ruler} from './rules.js';

const Gallery = {

  makeParser(g) {
    return isFunction(g) ? g : Gallery.defaultParser;
  },

  findIndex(gUrl) {
    return Math.max(0,
      state.ai.gItems.findIndex(({url}) => isArray(url) ? url.includes(gUrl) : url === gUrl));
  },

  next(dir) {
    if (dir) state.ai.gIndex = Gallery.nextIndex(dir);
    const item = state.ai.gItem = state.ai.gItems[state.ai.gIndex];
    if (isArray(item.url)) {
      state.ai.urls = item.url.slice(1);
      state.ai.url = item.url[0];
    } else {
      state.ai.urls = null;
      state.ai.url = item.url;
    }
    state.ai.gItemNext = state.ai.gItems[Gallery.nextIndex(dir || 1)];
    state.ai.committed = false;
    App.startSingle();
    Bar.updateName();
    if (dir) Bar.show(0);
  },

  nextIndex(dir) {
    return (state.ai.gIndex + dir + state.ai.gNum) % state.ai.gNum;
  },

  defaultParser(text, doc, docUrl, m, rule) {
    const {g} = rule;
    const gi = g.index;
    const qEntry = g.entry;
    const qCaption = ensureArray(g.caption);
    const qImage = g.image || 'img';
    const qTitle = g.title;
    const fix =
      (typeof g.fix === 'string' ? Util.newFunction('s', 'isURL', g.fix) : g.fix) ||
      (s => s.trim());
    const elems = [...$$(qEntry || qImage, doc)];
    const items = elems.map(processEntry).filter(Boolean);
    items.title = processTitle();
    items.index =
      RX_HAS_CODE.test(gi) ? Util.newFunction('items', 'node', gi)(items, state.ai.node) :
        typeof gi === 'string' ? Req.findImageUrl(tryCatch($, gi, doc), docUrl) :
          gi == null ? Math.max(0, elems.indexOf(state.ai.node)) :
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
  },
};

export {
  Gallery,
};
