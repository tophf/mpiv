import {GM} from './gm.js';
import {$new} from './helpers.js';
import {PREFIX} from './constants.js';

const CSS_SETUP_X = 20;
const CSS_SETUP_MAX_Y = 200;
const CSS_SETUP = /*language=css*/ `
  :host {
    all: initial !important;
    position: fixed !important;
    z-index: 2147483647 !important;
    top: ${CSS_SETUP_X}px !important;
    right: 20px !important;
    padding: 1.5em !important;
    color: #000 !important;
    --bg: #eee;
    background: var(--bg) !important;
    box-shadow: 5px 5px 25px 2px #000 !important;
    width: 33em !important;
    border: 1px solid black !important;
    display: flex !important;
    flex-direction: column !important;
  }
  main {
    font: 12px/15px sans-serif;
  }
  main:not([data-start=auto]) [data-start-auto] {
    opacity: .5;
  }
  table {
    text-align:left;
  }
  ul {
    min-height: 430px;
    max-height: calc(100vh - ${CSS_SETUP_MAX_Y}px);
    margin: 0 0 15px 0;
    padding: 0;
    list-style: none;
  }
  li {
    margin: 0;
    padding: .25em 0;
  }
  li.options {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  li.row {
    align-items: start;
    flex-wrap: wrap;
  }
  li.row label {
    display: flex;
    flex-direction: row;
    align-items: center;
  }
  li.row input {
    margin-right: .25em;
  }
  li.stretch label {
    flex: 1;
    white-space: nowrap;
  }
  li.stretch label > span {
    display: flex;
    flex-direction: row;
    flex: 1;
  }
  label {
    display: inline-flex;
    flex-direction: column;
  }
  label:not(:last-child) {
    margin-right: 1em;
  }
  input, select {
    min-height: 1.3em;
    box-sizing: border-box;
  }
  input[type=checkbox] {
    margin-left: 0;
  }
  input[type=number] {
    width: 4em;
  }
  input:not([type=checkbox])  {
    padding: 0 .25em;
  }
  input[type=range] {
    flex: 1;
    width: 100%;
    margin: 0 .25em;
    padding: 0;
    filter: saturate(0);
    opacity: .5;
  }
  u + input[type=range] {
    max-width: 3em;
  }
  input[type=range]:hover {
    filter: none;
    opacity: 1;
  }
  input[type=color] {
    position: absolute;
    width: calc(1.5em + 2px);
    opacity: 0;
    cursor: pointer;
  }
  u {
    position: relative;
    flex: 0 0 1.5em;
    height: 1.5em;
    border: 1px solid #888;
    pointer-events: none;
    color: #888;
    background-image:
      linear-gradient(45deg, currentColor 25%, transparent 25%, transparent 75%, currentColor 75%),
      linear-gradient(45deg, currentColor 25%, transparent 25%, transparent 75%, currentColor 75%);
    background-size: .5em .5em;
    background-position: 0 0, .25em .25em;
  }
  u::after {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    content: "";
    background-color: var(--color);
  }
  .range-edit {
    position: absolute;
    box-shadow: 0 0.25em 1em #000;
    z-index: 99;
  }
  textarea {
    resize: vertical;
    margin: 1px 0;
    font: 11px/1.25 Consolas, monospace;
  }
  :invalid {
    background-color: #f002;
    border-color: #800;
  }
  code {
    font-weight: bold;
  }
  a {
    text-decoration: none;
    color: LinkText;
    cursor: pointer;
  }
  a:hover {
    text-decoration: underline;
  }
  button {
    padding: .2em .5em;
    margin-right: 1em;
  }
  kbd {
    padding: 1px 6px;
    font-weight: bold;
    font-family: Consolas, monospace;
    border: 1px solid #888;
    border-radius: 3px;
    box-shadow: inset 1px 1px 5px #8888, .25px .5px 2px #0008;
  }
  .column {
    display: flex;
    flex-direction: column;
  }
  .flex {
    display: flex;
  }
  .highlight {
    animation: 2s fade-in cubic-bezier(0, .75, .25, 1);
    animation-fill-mode: both;
  }
  #_rules > * {
    word-break: break-all;
  }
  #_rules > :not(:focus) {
    overflow: hidden; /* prevents wrapping in FF */
  }
  .invalid-domain {
    opacity: .5;
  }
  .matching-domain {
    border-color: #56b8ff;
    background: #d7eaff;
  }
  #_mover {
    cursor: move;
    user-select: none;
    position: absolute;
    top: 0;
    left: 8px;
    right: 24px;
    height: 24px;
    text-align: center;
    background: linear-gradient(transparent 10px, currentColor 10px, currentColor 11px, transparent 11px,
      transparent 13px, currentColor 13px, currentColor 14px, transparent 14px);
  }
  #_mover::after {
    content: 'MPIV ${GM.info.script.version}';
    font: bold 20px/1.3 sans;
    background: var(--bg);
    padding: 0 1ex;
  }
  #_x {
    position: absolute;
    top: 0;
    right: 0;
    padding: 4px 8px;
    cursor: pointer;
    user-select: none;
  }
  #_x:hover {
    background-color: #8884;
  }
  #_cssApp {
    color: seagreen;
  }
  #_exportNotification {
    color: green;
    font-weight: bold;
    position: absolute;
    bottom: 4px;
    right: 26px;
  }
  #_installHint {
    color: green;
  }
  #_usage {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 1em;
  }
  #_usage th {
    font-weight: normal;
    padding-right: .5em;
  }
  #_usage tr:nth-last-child(n + 2) > :not(br) {
    white-space: pre-line;
    border-bottom: 1px dotted #8888;
  }
  #_usage kbd {
    font-family: monospace;
    font-weight: bold;
  }
  @keyframes fade-in {
    from { background-color: deepskyblue }
    to {}
  }
  @media (prefers-color-scheme: dark) {
    :host {
      color: #aaa !important;
      --bg: #333 !important;
    }
    a {
      color: deepskyblue;
    }
    button {
      background: linear-gradient(-5deg, #333, #555);
      border: 1px solid #000;
      box-shadow: 0 2px 6px #181818;
      border-radius: 3px;
      cursor: pointer;
    }
    button:hover {
      background: linear-gradient(-5deg, #333, #666);
    }
    textarea, input, select {
      background: #111;
      color: #BBB;
      border: 1px solid #555;
    }
    input[type=checkbox] {
      filter: invert(1);
    }
    input[type=range] {
      filter: invert(1) saturate(0);
    }
    input[type=range]:hover {
      filter: invert(1);
    }
    kbd {
      border-color: #666;
    }
    @supports (-moz-appearance: none) {
      input[type=checkbox],
      input[type=range],
      input[type=range]:hover {
        filter: none;
      }
    }
    .range-edit {
      box-shadow: 0 .5em 1em .5em #000;
    }
    .matching-domain {
      border-color: #0065af;
      background: #032b58;
      color: #ddd;
    }
    #_cssApp {
      color: darkseagreen;
    }
    #_installHint {
      color: greenyellow;
    }
    ::-webkit-scrollbar {
      width: 14px;
      height: 14px;
      background: #333;
    }
    ::-webkit-scrollbar-button:single-button {
      background: radial-gradient(circle at center, #555 40%, #333 40%)
    }
    ::-webkit-scrollbar-track-piece {
      background: #444;
      border: 4px solid #333;
      border-radius: 8px;
    }
    ::-webkit-scrollbar-thumb {
      border: 3px solid #333;
      border-radius: 8px;
      background: #666;
    }
    ::-webkit-resizer {
      background: #111 linear-gradient(-45deg, transparent 3px, #888 3px, #888 4px, transparent 4px, transparent 6px, #888 6px, #888 7px, transparent 7px) no-repeat;
      border: 2px solid transparent;
    }
  }
`;

function createSetupElement() {
  const MPIV_BASE_URL = 'https://github.com/tophf/mpiv/wiki/';
  const scalesHint = 'Leave it empty and click Apply or OK to restore the default values.';
  const $newLink = (text, href, props) =>
    $new('a', Object.assign({target: '_blank'}, href && {href}, props), text);
  const $newCheck = (label, id, title = '', props) =>
    $new('label', Object.assign({title}, props), [
      $new('input', {id, type: 'checkbox'}),
      label,
    ]);
  const $newKbd = s => s[0] === '{' ? $new('kbd', s.slice(1, -1)) : s;
  const $newRange = (id, title = '', min = 0, max = 100, step = 1, type = 'range') =>
    $new('input', {id, min, max, step, type, 'data-title': title});
  const $newSelect = (label, id, values) =>
    $new('label', [
      label,
      $new('select', {id}, Object.entries(values).map(([k, v]) =>
        $new('option', Object.assign({value: k}, typeof v === 'object' ? v : {textContent: v})))),
    ]);
  const $newTR = ([name, val]) =>
    $new('tr', !name ? $new('br') : [
      $new('th', ((name = name.split(/(\n)/))[0] = $new('b', name[0])) && name),
      $new('td', val.split(/({.+?})/).map($newKbd)),
    ]);
  const kAutoTooltip = '...when the "popup shows" option is "automatically"';
  const kAutoProps = {'data-start-auto': ''};
  return [
    $new('style#_cssSetup', CSS_SETUP),
    $new('style#_css'),
    $new(`main#${PREFIX}setup`, [
      $new('#_mover'),
      $new('#_x', 'x'),
      $new('ul#_ul.column', [
        $new('details', {style: 'order:1; padding-top: .5em;'}, [
          $new('summary', {style: 'cursor: pointer'},
            $new('b', 'Help & hotkeys...')),
          $new('#_usage', [
            $new('table', [
              ['Activate', 'hover the target'],
              ['Deactivate', 'move cursor off target, or click, or zoom out fully'],
              ['Ignore target', 'hold {Shift} ⏵ hover the target ⏵ release the key'],
              ['Freeze popup', 'hold {Shift} ⏵ leave the target ⏵ release the key'],
              ['Force-activate\n(videos or small pics)', 'hold {Ctrl} ⏵ hover the target ⏵ release the key'],
            ].map($newTR)),
            $new('table', [
              ['Start zooming', 'configurable (automatic or via right-click)\nor tap {Shift} while popup is visible'],
              ['Zoom', 'mouse wheel'],
              [],
              ['Rotate', '{L} {r} for "left" or "right"'],
              ['Flip/mirror', '{h} {v} for "horizontal" or "vertical"'],
              ['Previous/next\n(in album)', 'mouse wheel, {j} {k} or {←} {→} keys'],
            ].map($newTR)),
            $new('table', [
              ['Antialiasing', '{a}'],
              ['Caption in info', '{c}'],
              ['Download', '{d}'],
              ['Fullscreen', '{f}'],
              ['Info', '{i}'],
              ['Mute', '{m}'],
              ['Night mode', '{n}'],
              ['Open in tab', '{t}'],
            ].map($newTR)),
          ]),
        ]),
        $new('li.options.stretch', [
          $newSelect('Popup shows on', 'start', {
            context: 'Right-click / \u2261 / Ctrl',
            contextMK: 'Right-click / \u2261',
            contextM: 'Right-click',
            contextK: {
              textContent: '\u2261 key',
              title: '\u2261 is the Menu key (near the right Ctrl)',
            },
            ctrl: 'Ctrl',
            auto: 'automatically',
          }),
          $new('label', {title: kAutoTooltip, ...kAutoProps},
            ['after, sec', $newRange('delay', 'seconds', .05, 10, .05, 'number')]),
          $new('label', {title: '(if the full version of the hovered image is ...% larger)'},
            ['if larger, %', $newRange('scale', null, 0, 100, 1, 'number')]),
          $newSelect('Zoom activates on', 'zoom', {
            context: 'Right click / Shift',
            wheel: 'Wheel up / Shift',
            shift: 'Shift',
            auto: 'automatically',
          }),
          $newSelect('...and zooms to', 'fit', {
            'all': 'fit to window',
            'large': 'fit if larger',
            'no': '100%',
            '': {textContent: 'custom', title: 'Use custom scale factors'},
          }),
        ]),
        $new('li.options', [
          $new('label', ['Zoom step, %', $newRange('zoomStep', null, 100, 400, 1, 'number')]),
          $newSelect('When fully zoomed out:', 'zoomOut', {
            stay: 'stay in zoom mode',
            auto: 'stay if still hovered',
            unzoom: 'undo zoom mode',
            close: 'close popup',
          }),
          $new('label', {
            style: 'flex: 1',
            title: `
              Scale factors to use when “zooms to” selector is set to “custom”.
              0 = fit to window,
              0! = same as 0 but also removes smaller values,
              * after a value marks the default zoom factor, for example: 1*
              The popup won't shrink below the image's natural size or window size for bigger mages.
              ${scalesHint}
            `.trim().replace(/\n\s+/g, '\r'),
          }, ['Custom scale factors:', $new('input#scales', {placeholder: scalesHint})]),
        ]),
        $new('li.options.row', [
          $new([
            $newCheck('Centered*', 'center',
              '...or try to keep the original link/thumbnail unobscured by the popup'),
            $newCheck('Preload on hover*', 'preload',
              'Provides smoother experience but increases network traffic'),
            $newCheck('Require Ctrl key for video*', 'videoCtrl', kAutoTooltip, kAutoProps),
            $newCheck('Mute videos*', 'mute', 'Hotkey: "m" in the popup'),
            $newCheck('Keep playing video*', 'keepVids',
              '...until you press Esc key or click elsewhere'),
            $newCheck('Keep preview on blur*', 'keepOnBlur',
              'i.e. when mouse pointer moves outside the page'),
          ]),
          $new([
            $newCheck('Show complete image*', 'waitLoad',
              '...or immediately show a partial image while still loading'),
            $newCheck('Shadow only when complete*', 'uiShadowOnLoad',
              '...to avoid showing the semi-transparent background while still loading from a slow site'),
            $new('div.flex', {style: 'align-items:center'}, [
              $newCheck('Info: show for', 'uiInfo', 'Hotkey: "i" (or hold "Shift") in the popup'),
              $new('input#uiInfoHide', {min: 1, step: 'any', type: 'number'}),
              'sec',
            ]),
            $newCheck('Info: only once*', 'uiInfoOnce', '...or every time the info changes'),
            $newCheck('Info: caption*', 'uiInfoCaption', 'Hotkey: "c" in the popup'),
            $newCheck('Fade-in transition', 'uiFadein'),
            $newCheck('Fade-in transition in gallery', 'uiFadeinGallery'),
          ]),
          $new([
            $newCheck('Night mode*', 'night', 'Hotkey: "n" in the popup'),
            $newCheck('Run in image tabs', 'imgtab'),
            $newCheck('Spoof hotlinking*', 'xhr',
              'Disable only if you spoof the HTTP headers yourself'),
            $newCheck('Set status on <html>*', 'globalStatus',
              "Causes slowdowns so don't enable unless you explicitly use it in your custom CSS"),
            $newCheck('Auto-start switch in menu*', 'startAltShown',
              "Show a switch for 'auto-start' mode in userscript manager menu"),
          ]),
        ]),
        $new('li.options.stretch', [
          $new('label', [
            'Background',
            $new('span', [
              $new('input#uiBackgroundColor', {type: 'color'}), $new('u'),
              $newRange('uiBackgroundOpacity', 'Opacity: $%'),
            ]),
          ]),
          $new('label', [
            'Border color, opacity, size',
            $new('span', [
              $new('input#uiBorderColor', {type: 'color'}), $new('u'),
              $newRange('uiBorderOpacity', 'Opacity: $%'),
              $newRange('uiBorder', 'Border size: $px', 0, 20),
            ]),
          ]),
          $new('label', [
            'Shadow color, opacity, size',
            $new('span', [
              $new('input#uiShadowColor', {type: 'color'}), $new('u'),
              $newRange('uiShadowOpacity', 'Opacity: $%'),
              $newRange('uiShadow', 'Shadow blur radius: $px\n"0" disables the shadow.', 0, 20),
            ]),
          ]),
          $new('label', ['Padding', $new('span', $newRange('uiPadding', 'Padding: $px'))]),
          $new('label', ['Margin', $new('span', $newRange('uiMargin', 'Margin: $px'))]),
        ]),
        $new('li', [
          $newLink('Custom CSS:', `${MPIV_BASE_URL}Custom-CSS`),
          ' e.g. ', $new('b', '#mpiv-popup { animation: none !important }'),
          $newLink('View the built-in CSS', '', {
            id: '_reveal',
            tabIndex: 0,
            style: 'float: right',
            title: 'You can copy parts of it to override them in your custom CSS',
          }),
          $new('.column', [
            $new('textarea#css', {spellcheck: false}),
            $new('textarea#_cssApp', {spellcheck: false, hidden: true, readOnly: true, rows: 30}),
          ]),
        ]),
        $new('li.flex', {style: 'justify-content: space-between;'}, [
          $new('div',
            $newLink('Custom host rules:', `${MPIV_BASE_URL}Custom-host-rules`)),
          $new('div', {style: 'white-space: pre-line'}, [
            'To disable, put any symbol except ', $new('code', 'a..z 0..9 - .'),
            '\nin "d" value, for example ', $new('code', '"d": "!foo.com"'),
          ]),
          $new('div',
            $new('input#_search',
              {type: 'search', placeholder: 'Search', style: 'width: 10em; margin-left: 1em'})),
        ]),
        $new('li', {
          style: 'margin-left: -3px; margin-right: -3px; overflow-y: auto; ' +
                 'padding-left: 3px; padding-right: 3px;',
        }, [
          $new('div#_rules.column',
            $new('textarea', {spellcheck: false, rows: 1})),
        ]),
        $new('li#_rules2'),
      ]),
      $new('div.flex', [
        $new('button#_ok', {accessKey: 'o'}, 'OK'),
        $new('button#_apply', {accessKey: 'a'}, 'Apply'),
        $new('button#_cancel', 'Cancel'),
        $new('a', {href: `${MPIV_BASE_URL}Rules`, style: 'margin: 0 auto'},
          $new('button#_install', {style: 'color: inherit'}, 'Find rule...')),
        $new('button#_import', 'Import'),
        $new('button#_export', {style: 'margin: 0'}, 'Export'),
        $new('div#_exportNotification', {hidden: true}, 'Copied to clipboard'),
      ]),
    ]),
  ];
}

export {
  CSS_SETUP_X, CSS_SETUP_MAX_Y, CSS_SETUP, createSetupElement,
};
