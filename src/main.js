import {state} from './state.js';
import {Config} from './config.js';
import {doc, hostname} from './constants.js';
import {App} from './app.js';
import {Menu} from './menu.js';
import * as Instagram from './instagram.js';
import {Events} from './events.js';
import {setupClickedRule} from './setup.js';

(async () => {
  state.cfg = await Config.load({save: true});
  if (!doc.body) {
    await new Promise(resolve =>
      new MutationObserver((_, mo) => doc.body && (mo.disconnect(), resolve()))
        .observe(document, {subtree: true, childList: true}));
  }
  const el = doc.body.firstElementChild;
  if (el) {
    App.isImageTab = el === doc.body.lastElementChild && el.matches('img, video');
    App.isEnabled = state.cfg.imgtab || !App.isImageTab;
  }
  if (Menu) Menu.register();
  Instagram.initEmbed();
  addEventListener('mouseover', Events.onMouseOver, true);
  addEventListener('contextmenu', Events.onContext, true);
  addEventListener('keydown', Events.onKeyDown, true);
  addEventListener('visibilitychange', Events.onVisibility, true);
  addEventListener('blur', Events.onVisibility, true);
  if (['greasyfork.org', 'github.com'].includes(hostname))
    addEventListener('click', setupClickedRule, true);
  addEventListener('message', App.onMessage, true);
})();

if (window.trustedTypes) {
  const TT = window.trustedTypes;
  const CP = 'createPolicy';
  const createPolicy = TT[CP];
  TT[CP] = function ovr(name, opts) {
    let fn;
    const p = createPolicy.call(TT, name, opts);
    if ((state.trustedHTML || opts[fn = 'createHTML'] && (state.trustedHTML = p[fn].bind(p))) &&
        (state.trustedScript || opts[fn = 'createScript'] && (state.trustedScript = p[fn].bind(p))) &&
        TT[CP] === ovr)
      delete TT[CP];
    return p;
  };
}
