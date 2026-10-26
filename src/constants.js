export const doc = document;
export const hostname = location.hostname;
export const dotDomain = '.' + hostname;
export const isFF = CSS.supports('-moz-appearance', 'none');
export const {AudioContext = function () {}} = window;
export const {from: arrayFrom, isArray} = Array;

export const PREFIX = 'mpiv-';
export const NOAA_ATTR = 'data-no-aa';
export const STATUS_ATTR = `${PREFIX}status`;
export const MSG = Object.assign({}, ...[
  'getViewSize',
  'viewSize',
].map(k => ({[k]: `${PREFIX}${k}`})));
export const WHEEL_EVENT = 'onwheel' in doc ? 'wheel' : 'mousewheel';
// time for volatile things to settle down meanwhile we postpone action
// examples: loading image from cache, quickly moving mouse over one element to another
export const SETTLE_TIME = 50;
// used to detect JS code in host rules
export const RX_HAS_CODE = /(^|[^-\w])return[\W\s]/;
export const RX_EVAL_BLOCKED = /'Trusted(Script| Type)'|unsafe-eval/;
export const RX_IMAGE_URL = /https?:\/\/[^\s"<>]+?\.(jpe?g|gif|png|svg|web[mp]|mp4)[^\s"<>]*|$/i;
export const RX_MEDIA_URL = /^(?!data:)[^?#]+?\.(avif|bmp|jpe?g?|gif|mp4|png|svgz?|web[mp])($|[?#])/i;
export const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const ZOOM_MAX = 16;
export const SYM_U = Symbol('u');
export const FN_ARGS = {
  s: ['m', 'node', 'rule'],
  c: ['text', 'doc', 'node', 'rule'],
  q: ['text', 'doc', 'node', 'rule'],
  g: ['text', 'doc', 'url', 'm', 'rule', 'node', 'cb'],
};
