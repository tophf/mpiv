import {tryJSON} from './helpers.js';
import {GM} from './gm.js';
import {state} from './state.js';
import {App} from './app.js';
import {isArray, PREFIX} from './constants.js';

class Config {

  constructor({data: c, save}) {
    if (typeof c === 'string')
      c = tryJSON(c);
    if (typeof c !== 'object' || !c)
      c = {};
    const {DEFAULTS} = Config;
    c.fit = ['all', 'large', 'no', ''].includes(c.fit) ? c.fit :
      !(c.scales || 0).length || `${c.scales}` === `${DEFAULTS.scales}` ? 'large' :
        '';
    if (c.version !== DEFAULTS.version) {
      if (typeof c.hosts === 'string')
        c.hosts = c.hosts.split('\n')
          .map(s => tryJSON(s) || s)
          .filter(Boolean);
      if (c.close === true || c.close === false)
        c.zoomOut = c.close ? 'auto' : 'stay';
      for (const key in DEFAULTS)
        if (typeof c[key] !== typeof DEFAULTS[key])
          c[key] = DEFAULTS[key];
      if (c.version === 3 && c.scales[0] === 0)
        c.scales[0] = '0!';
      for (const key in c)
        if (!(key in DEFAULTS))
          delete c[key];
      c.version = DEFAULTS.version;
      if (save)
        GM.setValue('cfg', c);
    }
    if (Object.keys(state.cfg || {}).some(k => /^ui|^(css|globalStatus)$/.test(k) && state.cfg[k] !== c[k]))
      App.globalStyle = '';
    if (!isArray(c.scales))
      c.scales = [];
    c.scales = [...new Set(c.scales)].sort((a, b) => parseFloat(a) - parseFloat(b));
    Object.assign(this, DEFAULTS, c);
  }

  static async load(opts) {
    opts.data = await GM.getValue('cfg');
    return new Config(opts);
  }

  _getCss() {
    const {css} = this;
    return css.includes('{') ? css : `#${PREFIX}-popup {${css}}`;
  }
}

Config.DEFAULTS = /** @type mpiv.Config */ {
  __proto__: null,
  center: false,
  css: '',
  delay: 500,
  fit: '',
  globalStatus: false,
  // prefer ' inside rules because " will be displayed as \"
  // example: "img[src*='icon']"
  hosts: [{
    name: 'No popup for YouTube thumbnails',
    d: 'www.youtube.com',
    e: 'ytd-rich-item-renderer *, ytd-thumbnail *',
    s: '',
  }, {
    name: 'No popup for SVG/PNG icons',
    d: '',
    e: "img[src*='icon']",
    r: '//[^/]+/.*\\bicons?\\b.*\\.(?:png|svg)',
    s: '',
  }],
  imgtab: false,
  keepOnBlur: false,
  keepVids: false,
  mute: false,
  night: false,
  preload: false,
  scale: 1.05,
  scales: ['0!', 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 8, 16],
  start: 'auto',
  startAlt: 'context',
  startAltShown: false,
  uiBackgroundColor: '#ffffff',
  uiBackgroundOpacity: 100,
  uiBorderColor: '#000000',
  uiBorderOpacity: 100,
  uiBorder: 0,
  uiFadein: true,
  uiFadeinGallery: true, // some computers show white background while loading so fading hides it
  uiInfo: true,
  uiInfoCaption: true,
  uiInfoHide: 3,
  uiInfoOnce: true,
  uiShadowColor: '#000000',
  uiShadowOpacity: 80,
  uiShadow: 20,
  uiShadowOnLoad: true,
  uiPadding: 0,
  uiMargin: 0,
  version: 6,
  videoCtrl: true,
  waitLoad: false,
  xhr: true,
  zoom: 'context',
  zoomOut: 'auto',
  zoomStep: 133,
};

export {
  Config,
};
