import {cfg, setCfg, setTrustedScript, trustedScript, setTrustedHTML, trustedHTML} from './state.js';
import * as Config from './config.js';
import {doc, hostname} from './constants.js';
import * as App from './app.js';
import * as Menu from './menu.js';
import * as Instagram from './instagram.js';
import * as Events from './events.js';
import {setupClickedRule} from './setup.js';

(async () => {
  setCfg(await Config.load({save: true}));
  if (!doc.body) {
    await new Promise(resolve =>
      new MutationObserver((_, mo) => doc.body && (mo.disconnect(), resolve()))
        .observe(document, {subtree: true, childList: true}));
  }
  const el = doc.body.firstElementChild;
  if (el) {
    App.setIsImageTab(el === doc.body.lastElementChild && el.matches('img, video'));
    App.setIsEnabled(cfg.imgtab || !App.isImageTab);
  }
  Menu.register();
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
    if ((trustedHTML || opts[fn = 'createHTML'] && setTrustedHTML(p[fn].bind(p))) &&
        (trustedScript || opts[fn = 'createScript'] && setTrustedScript(p[fn].bind(p))) &&
        TT[CP] === ovr)
      delete TT[CP];
    return p;
  };
}
