import {ensureArray, isArray} from './util.js';

export const doc = document;

export const $ = (sel, node = doc) => node.querySelector(sel) || false;

export const $$ = (sel, node = doc) => node.querySelectorAll(sel);

export const $css = (el, props) =>
  Object.entries(props).forEach(([k, v]) =>
    el.style.setProperty(k, v, 'important'));

export const $dataset = ({dataset: d}, key, val) =>
  val == null ? delete d[key] : (d[key] = val);

export const $many = (q, doc) => {
  for (const selector of ensureArray(q)) {
    const el = selector && $(selector, doc);
    if (el)
      return el;
  }
};

export const $new = (sel, props, children) => {
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

export const $parseHtml = str =>
  new DOMParser().parseFromString(str, 'text/html');

export const $prop = (sel, prop, node = doc) =>
  (node = $(sel, node)) && node[prop] || '';

export const $propUp = (node, prop) =>
  (node = node.closest(`[${prop}]`)) &&
  (prop.startsWith('data-') ? node.getAttribute(prop) : node[prop]) ||
  '';

export const $remove = node => node && node.remove();
