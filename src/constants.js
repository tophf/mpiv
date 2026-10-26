const doc = document;
const hostname = location.hostname;
const dotDomain = '.' + hostname;
const isFF = CSS.supports('-moz-appearance', 'none');
const {AudioContext = function () {}} = window;
const {from: arrayFrom, isArray} = Array;

const PREFIX = 'mpiv-';
const NOAA_ATTR = 'data-no-aa';
const STATUS_ATTR = `${PREFIX}status`;
const MSG = Object.assign({}, ...[
  'getViewSize',
  'viewSize',
].map(k => ({[k]: `${PREFIX}${k}`})));
const WHEEL_EVENT = 'onwheel' in doc ? 'wheel' : 'mousewheel';
// time for volatile things to settle down meanwhile we postpone action
// examples: loading image from cache, quickly moving mouse over one element to another
const SETTLE_TIME = 50;
// used to detect JS code in host rules
const RX_HAS_CODE = /(^|[^-\w])return[\W\s]/;
const RX_EVAL_BLOCKED = /'Trusted(Script| Type)'|unsafe-eval/;
const RX_IMAGE_URL = /https?:\/\/[^\s"<>]+?\.(jpe?g|gif|png|svg|web[mp]|mp4)[^\s"<>]*|$/i;
const RX_MEDIA_URL = /^(?!data:)[^?#]+?\.(avif|bmp|jpe?g?|gif|mp4|png|svgz?|web[mp])($|[?#])/i;
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const ZOOM_MAX = 16;
const SYM_U = Symbol('u');
const FN_ARGS = {
  s: ['m', 'node', 'rule'],
  c: ['text', 'doc', 'node', 'rule'],
  q: ['text', 'doc', 'node', 'rule'],
  g: ['text', 'doc', 'url', 'm', 'rule', 'node', 'cb'],
};

export {
  doc, hostname, dotDomain, isFF, AudioContext, arrayFrom, isArray, PREFIX, NOAA_ATTR,
  STATUS_ATTR, MSG, WHEEL_EVENT, SETTLE_TIME, RX_HAS_CODE, RX_EVAL_BLOCKED, RX_IMAGE_URL,
  RX_MEDIA_URL, BLANK_PIXEL, ZOOM_MAX, SYM_U, FN_ARGS,
};
