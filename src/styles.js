import {ai, cfg} from './app.js';
import * as Config from './config.js';
import {$new, doc} from './dom.js';
import {getUiColor} from './util.js';

export let globalStyle = '';
export let popupStyleBase = '';

export const NOAA_ATTR = 'data-no-aa';
export const STATUS_ATTR = PREFIX + 'status';
export const setGlobalStyle = val => (globalStyle = val);

const styles = {__proto__: null};

function createGlobalStyle() {
  globalStyle = /*language=CSS*/(String.raw`
#mpiv-bar {
  position: fixed;
  z-index: 2147483647;
  top: 0;
  left: 0;
  right: 0;
  text-align: center;
  font-family: sans-serif;
  font-size: 15px;
  font-weight: bold;
  background: #0005;
  color: white;
  padding: 4px 10px;
  text-shadow: .5px .5px 2px #000;
  transition: opacity 1s ease .25s;
  opacity: 0;
}
#mpiv-bar[data-force] {
  transition: none;
}
#mpiv-bar.mpiv-show {
  opacity: 1;
}
#mpiv-bar[data-zoom][data-prefix]::before {
  content: "[" attr(data-prefix) "] ";
  color: gold;
}
#mpiv-bar[data-zoom]:not(:empty)::after {
  content: " (" attr(data-zoom) ")";
  opacity: .8;
}
#mpiv-bar[data-zoom]:empty::after {
  content: attr(data-zoom);
}
#mpiv-popup.mpiv-show {
  display: inline;
}
#mpiv-popup {
  display: none;
  cursor: none;
  box-shadow: none;
${cfg.uiFadein ? String.raw`
  animation: .2s mpiv-fadein both;
  transition: box-shadow .25s, background-color .25s;
  ` : ''}
${popupStyleBase = `
  border: none;
  box-sizing: border-box;
  background-size: cover;
  position: fixed;
  z-index: 2147483647;
  padding: 0;
  margin: 0;
  top: 0;
  left: 0;
  width: auto;
  height: auto;
  transform-origin: center;
  max-width: none;
  max-height: none;
`}
}
#mpiv-popup.mpiv-show {
  ${cfg.uiBorder ? `border: ${cfg.uiBorder}px solid ${getUiColor('Border')};` : ''}
  ${cfg.uiPadding ? `padding: ${cfg.uiPadding}px;` : ''}
  ${cfg.uiMargin ? `margin: ${cfg.uiMargin}px;` : ''}
}
#mpiv-popup.mpiv-show${cfg.uiShadowOnLoad ? '[loaded]' : ''} {
  background-color: ${getUiColor('Background')};
  ${cfg.uiShadow ? `box-shadow: 2px 4px ${cfg.uiShadow}px 4px ${getUiColor('Shadow')};` : ''}
}
#mpiv-popup[data-gallery-flip] {
  animation: none;
  transition: none;
}
#mpiv-popup[${NOAA_ATTR}],
#mpiv-popup.mpiv-zoom-max {
  image-rendering: pixelated;
}
#mpiv-popup.mpiv-night:not(#\\0) {
  box-shadow: 0 0 0 ${Math.max(screen.width, screen.height)}px #000;
}
body:has(#mpiv-popup.mpiv-night)::-webkit-scrollbar {
  background: #000;
}
#mpiv-setup {
}
@keyframes mpiv-fadein {
  from {
    opacity: 0;
    border-color: transparent;
  }
  to {
    opacity: 1;
  }
}
` + (cfg.globalStatus ? String.raw`
:root.mpiv-loading:not(.mpiv-preloading) *:hover {
  cursor: progress !important;
}
:root.mpiv-edge #mpiv-popup {
  cursor: default;
}
:root.mpiv-error *:hover {
  cursor: not-allowed !important;
}
:root.mpiv-ready *:hover,
:root.mpiv-large *:hover {
  cursor: zoom-in !important;
}
:root.mpiv-shift *:hover {
  cursor: default !important;
}
` : String.raw`
[mpiv-status~="loading"]:not([mpiv-status~="preloading"]):hover {
  cursor: progress;
}
[mpiv-status~="edge"]:hover {
  cursor: default;
}
[mpiv-status~="error"]:hover {
  cursor: not-allowed;
}
[mpiv-status~="ready"]:hover,
[mpiv-status~="large"]:hover {
  cursor: zoom-in;
}
[mpiv-status~="shift"]:hover {
  cursor: default;
}
`)).replace(/mpiv-status/g, STATUS_ATTR);
  popupStyleBase = popupStyleBase.replace(/;/g, '!important;');
}

function updateStyle(name, css) {
  const el = styles[name] || css && (
    styles[name] = typeof GM_addStyle === 'function'
      ? GM_addStyle(css)
      : doc.head.appendChild($new('style', css))
  );
  if (!el) return;
  if (el.textContent !== css)
    el.textContent = css;
  return el;
}

export function updateStyles() {
  if (!globalStyle) createGlobalStyle();
  updateStyle('global', globalStyle + Config.getCss(cfg));
  updateStyle('rule', ai.rule.css || '');
}
