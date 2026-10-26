import {isArray, doc} from './constants.js';

const clamp = (v, min, max) =>
  v < min ? min : v > max ? max : v;

const compareNumbers = (a, b) =>
  a - b;

const flattenHtml = str =>
  str.trim().replace(/\n\s*/g, '');

const dropEvent = e =>
  ((e.preventDefault(), e.stopPropagation()));

const ensureArray = v =>
  isArray(v) ? v : [v];

/** @param {KeyboardEvent} e */
const eventModifiers = e =>
  (e.altKey ? '!' : '') +
  (e.ctrlKey ? '^' : '') +
  (e.metaKey ? '#' : '') +
  (e.shiftKey ? '+' : '');

/** @param {KeyboardEvent} e */
const describeKey = e => eventModifiers(e) + (e.key && e.key.length > 1 ? e.key : e.code);

const isFunction = val => typeof val === 'function';

const isVideo = el => el && el.tagName === 'VIDEO';

const now = performance.now.bind(performance);

const sumProps = (...props) => {
  let sum = 0;
  for (const p of props)
    sum += parseFloat(p) || 0;
  return sum;
};

const tryCatch = (fn, ...args) => {
  try {
    return fn(...args);
  } catch (e) {}
};

const tryJSON = str =>
  tryCatch(JSON.parse, str);

const pick = (obj, path, fn) => {
  if (obj && path)
    for (const p of path.split('.'))
      if (obj) obj = obj[p]; else break;
  return fn && obj !== undefined ? fn(obj) : obj;
};

const $ = (sel, node = doc) =>
  node.querySelector(sel) || false;

const $$ = (sel, node = doc) =>
  node.querySelectorAll(sel);

const $new = (sel, props, children) => {
  if (typeof sel !== 'string') {
    children = props;
    props = sel;
    sel = '';
  }
  if (!children && props != null && ({}).toString.call(props) !== '[object Object]') {
    children = props;
    props = null;
  }
  const isFrag = sel === 'fragment';
  const [, tag, id, cls] = sel.match(/^(\w*)(?:#([^.]+))?(?:\.(.+))?$/);
  const el = isFrag ? doc.createDocumentFragment() : doc.createElement(tag || 'div');
  if (id) el.id = id;
  if (cls) el.className = cls.replace(/\./g, ' ');
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (!k.startsWith('data-')) {
        el[k] = v;
      } else if (v != null) {
        el.setAttribute(k, v);
      }
    }
  }
  if (children != null) {
    if (isArray(children))
      el.append(...children.filter(Boolean));
    else if (children instanceof Node)
      el.appendChild(children);
    else
      el.textContent = children;
  }
  return el;
};

const $css = (el, props) =>
  Object.entries(props).forEach(([k, v]) =>
    el.style.setProperty(k, v, 'important'));

const $parseHtml = str =>
  new DOMParser().parseFromString(str, 'text/html');

const $many = (q, doc) => {
  for (const selector of ensureArray(q)) {
    const el = selector && $(selector, doc);
    if (el)
      return el;
  }
};

const $prop = (sel, prop, node = doc) =>
  (node = $(sel, node)) && node[prop] || '';

const $propUp = (node, prop) =>
  (node = node.closest(`[${prop}]`)) &&
  (prop.startsWith('data-') ? node.getAttribute(prop) : node[prop]) ||
  '';

const $remove = node =>
  node && node.remove();

const $dataset = ({dataset: d}, key, val) =>
  val == null ? delete d[key] : (d[key] = val);

export {
  clamp, compareNumbers, flattenHtml, dropEvent, ensureArray, eventModifiers, describeKey,
  isFunction, isVideo, now, sumProps, tryCatch, tryJSON, pick, $, $$, $new, $css, $parseHtml,
  $many, $prop, $propUp, $remove, $dataset,
};
