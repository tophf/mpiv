import {cfg, setCfg} from './app.js';
import * as Config from './config.js';
import {$$, $css, $new, $propUp, $remove, doc} from './dom.js';
import * as GM from './gm.js';
import * as Menu from './menu.js';
import * as Req from './request.js';
import * as Ruler from './ruler.js';
import {createSetupElement, CSS_SETUP_MAX_Y, CSS_SETUP_X} from './setup-view.js';
import {globalStyle, updateStyles} from './styles.js';
import * as Util from './util.js';
import {clamp, deepEqual, dropEvent, eventModifiers, isFunction, stringify} from './util.js';
import {hostname} from './vars.js';

/** @type {Element} */
export let elSetup;
export const setElSetup = val => (elSetup = val);

export async function setup({rule} = {}) {
  if (!isFunction(doc.body.attachShadow)) {
    alert('Cannot show MPIV config dialog: the browser is probably too old.\n' +
          'You can edit the script\'s storage directly in your userscript manager.');
    return;
  }
  const RULE = setup.RULE ||= Symbol('rule');
  let uiCfg;
  let root = (elSetup || 0).shadowRoot;
  let {blankRuleElement} = setup;
  let mover, moveX = 0, moveY = 0, moveBaseX = 0, moveBaseY = 0;
  /** @type {{[id:string]: HTMLElement}} */
  const UI = setup.UI = new Proxy({}, {
    get(_, id) {
      return root.getElementById(id);
    },
  });
  if (!elSetup)
    build();
  if (elSetup.parentElement !== doc.body) {
    init(await Config.load({save: true}));
    doc.body.append(elSetup);
  }
  if (rule)
    installRule(rule);

  function build() {
    setElSetup($new('div', {contentEditable: true}));
    root = elSetup.attachShadow({mode: 'open'});
    root.append(...createSetupElement());
    initEvents();
  }

  function init(data) {
    uiCfg = data;
    renderAll();
    renderVolatiles();
    renderRules();
    requestAnimationFrame(() => {
      UI.css.style.minHeight = clamp(UI.css.scrollHeight, 40, elSetup.clientHeight / 4) + 'px';
    });
  }

  function initEvents() {
    UI._mover.onmousedown = e => {
      if (e.button || eventModifiers(e))
        return;
      if (!mover) {
        mover = UI._cssSetup.sheet;
        mover.insertRule(':host {}');
        mover = mover.cssRules[1];
      }
      addEventListener('mousemove', onMove, true);
      addEventListener('mouseup', onMoveDone, true);
      addEventListener('keydown', onMoveKey, true);
      moveX = e.x - moveBaseX;
      moveY = e.y - moveBaseY;
      $css(mover, {opacity: .75});
    };
    UI._apply.onclick = UI._cancel.onclick = UI._ok.onclick = UI._x.onclick = closeSetup;
    UI._export.onclick = e => {
      dropEvent(e);
      GM.setClipboard(stringify(collectConfig(), null, '  '));
      UI._exportNotification.hidden = false;
      setTimeout(() => (UI._exportNotification.hidden = true), 1000);
    };
    UI._import.onclick = e => {
      dropEvent(e);
      const s = prompt('Paste settings:');
      if (s)
        init(Config.create({data: s}));
    };
    UI._install.onclick = setupRuleInstaller;
    const /** @type {HTMLTextAreaElement} */ cssApp = UI._cssApp;
    UI._reveal.onclick = e => {
      e.preventDefault();
      cssApp.hidden = !cssApp.hidden;
      if (!cssApp.hidden) {
        if (!cssApp.value) {
          updateStyles();
          cssApp.value = globalStyle.trim();
          cssApp.setSelectionRange(0, 0);
        }
        cssApp.focus();
      }
    };
    UI.start.onchange = function () {
      UI[PREFIX + 'setup'].dataset.start = this.value;
    };
    UI.xhr.onclick = ({target: el}) => el.checked || confirm($propUp(el, 'title'));
    // color
    for (const el of $$('[type="color"]', root)) {
      el.oninput = colorOnInput;
      el.elSwatch = el.nextElementSibling;
      el.elOpacity = UI[el.id.replace('Color', 'Opacity')];
      el.elOpacity.elColor = el;
    }
    function onMove({x, y}) {
      x = moveBaseX = clamp(x - moveX,
        -innerWidth + CSS_SETUP_X * 4, elSetup.clientWidth - CSS_SETUP_X);
      y = moveBaseY = clamp(y - moveY, 0, innerHeight - CSS_SETUP_X * 3);
      $css(mover, {transform: `translate(${x}px, ${y}px)`});
      UI._ul.style.maxHeight = `calc(100vh - ${CSS_SETUP_MAX_Y + y - CSS_SETUP_X}px)`;
    }
    function onMoveDone() {
      removeEventListener('mousemove', onMove, true);
      removeEventListener('mouseup', onMoveDone, true);
      removeEventListener('keydown', onMoveKey, true);
      $css(mover, {opacity: ''});
    }
    function onMoveKey(e) {
      if (e.key === 'Escape' && !eventModifiers(e)) {
        e.stopPropagation();
        onMove({x: moveX, y: moveY});
        onMoveDone();
      }
    }
    function colorOnInput() {
      this.elSwatch.style.setProperty('--color',
        Util.getUiColor(this.value, this.elOpacity.valueAsNumber));
    }
    // range
    for (const el of $$('[type="range"]', root)) {
      el.oninput = rangeOnInput;
      el.onblur = rangeOnBlur;
      el.addEventListener('focusin', rangeOnFocus);
    }
    function rangeOnBlur(e) {
      if (this.elEdit && e.relatedTarget !== this.elEdit)
        this.elEdit.onblur(e);
    }
    function rangeOnFocus() {
      if (this.elEdit) return;
      const {min, max, step, value} = this;
      this.elEdit = $new('input', {
        value, min, max, step,
        className: 'range-edit',
        style: `left: ${this.offsetLeft}px; margin-top: ${this.offsetHeight + 1}px`,
        type: 'number',
        elRange: this,
        onblur: rangeEditOnBlur,
        oninput: rangeEditOnInput,
      });
      this.insertAdjacentElement('afterend', this.elEdit);
    }
    function rangeOnInput() {
      this.title = (this.dataset.title || '').replace('$', this.value);
      if (this.elColor) this.elColor.oninput();
      if (this.elEdit) this.elEdit.valueAsNumber = this.valueAsNumber;
    }
    // range-edit
    function rangeEditOnBlur(e) {
      if (e.relatedTarget !== this.elRange) {
        this.remove();
        this.elRange.elEdit = null;
      }
    }
    function rangeEditOnInput() {
      this.elRange.valueAsNumber = this.valueAsNumber;
      this.elRange.oninput();
    }
    // prevent the main page from interpreting key presses in inputs as hotkeys
    // which may happen since it sees only the outer <div> in the event |target|
    root.addEventListener('keydown', e => !e.altKey && !e.metaKey && e.stopPropagation(), true);
  }

  function closeSetup(event) {
    const isApply = this.id === '_apply';
    if (event && (this.id === '_ok' || isApply)) {
      setCfg(uiCfg = collectConfig({save: true, clone: isApply}));
      Ruler.init();
      Menu.reRegisterAlt();
      if (isApply)
        return renderVolatiles();
    }
    $remove(elSetup);
    setElSetup(null);
  }

  function collectConfig({save, clone} = {}) {
    let data = {};
    for (const el of $$('input[id], select[id]', root))
      data[el.id] = el.type === 'checkbox' ? el.checked :
        (el.type === 'number' || el.type === 'range') ? el.valueAsNumber :
          el.value || '';
    Object.assign(data, {
      css: UI.css.value.trim(),
      delay: UI.delay.valueAsNumber * 1000,
      hosts: collectRules(),
      scale: clamp(UI.scale.valueAsNumber / 100, 0, 1) + 1,
      scales: UI.scales.value
        .trim()
        .split(/[,;]*\s+/)
        .map(x => x.replace(',', '.'))
        .filter(x => !isNaN(parseFloat(x))),
    });
    if (clone)
      data = JSON.parse(stringify(data));
    return Config.create({data, save});
  }

  function collectRules() {
    return [...UI._rules.children]
      .map(el => [el.value.trim(), el[RULE]])
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      .map(([s, json]) => json || s)
      .filter(Boolean);
  }

  function checkRule({target: el}) {
    let json, error, title;
    const prev = el.previousElementSibling;
    if (el.value) {
      json = Ruler.parse(el.value);
      error = json instanceof Error && (json.message || String(json));
      const invalidDomain = !error && json && typeof json.d === 'string' &&
        !/^[-.a-z0-9]*$/i.test(json.d);
      title = [invalidDomain && 'Disabled due to invalid characters in "d"', error]
        .filter(Boolean).join('\n');
      el.classList.toggle('invalid-domain', invalidDomain);
      el.classList.toggle('matching-domain', !!json.d && hostname.includes(json.d));
      if (!prev)
        el.insertAdjacentElement('beforebegin', blankRuleElement.cloneNode());
    } else if (prev) {
      prev.focus();
      el.remove();
    }
    el[RULE] = !error && json;
    el.title = title;
    el.setCustomValidity(error || '');
  }

  async function focusRule({target: el, relatedTarget: from}) {
    if (el === this)
      return;
    await new Promise(setTimeout);
    if (el[RULE] && el.rows < 2) {
      let i = el.selectionStart;
      const txt = el.value = Ruler.format(el[RULE], {expand: true});
      i += txt.slice(0, i).match(/^\s*/gm).reduce((len, s) => len + s.length, 0);
      el.setSelectionRange(i, i);
      el.rows = txt.match(/^/gm).length;
    }
    if (!this.contains(from))
      from = [...$$('[style*="height"]', this)].find(_ => _ !== el);
  }

  function installRule(rule) {
    const inputs = UI._rules.children;
    let el = [...inputs].find(el => deepEqual(el[RULE], rule));
    if (!el) {
      el = inputs[0];
      el[RULE] = rule;
      el.value = Ruler.format(rule);
      el.hidden = false;
      const i = Math.max(0, collectRules().indexOf(rule));
      inputs[i].insertAdjacentElement('afterend', el);
      inputs[0].insertAdjacentElement('beforebegin', blankRuleElement.cloneNode());
    }
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 ||
        rect.bottom > el.parentNode.offsetHeight)
      el.scrollIntoView();
    el.classList.add('highlight');
    el.addEventListener('animationend', () => el.classList.remove('highlight'), {once: true});
    el.focus();
  }

  function renderRules() {
    const rules = UI._rules;
    rules.addEventListener('input', checkRule);
    rules.addEventListener('focusin', focusRule);
    rules.addEventListener('paste', focusRule);
    blankRuleElement =
      setup.blankRuleElement =
        setup.blankRuleElement || rules.firstElementChild.cloneNode();
    if (blankRuleElement.nextElementSibling) {
      rules.textContent = '';
      rules.appendChild(blankRuleElement.cloneNode());
    }
    for (const rule of uiCfg.hosts || []) {
      const el = blankRuleElement.cloneNode();
      el.value = typeof rule === 'string' ? rule : Ruler.format(rule);
      rules.appendChild(el);
      checkRule({target: el});
    }
    const search = UI._search;
    search.oninput = () => {
      setup.search = search.value;
      const s = search.value.toLowerCase();
      for (const el of rules.children)
        el.hidden = s && !el.value.toLowerCase().includes(s);
    };
    search.value = setup.search || '';
    if (search.value)
      search.oninput();
  }

  function renderVolatiles() {
    UI.scales.value = uiCfg.scales.join(' ').trim() || Config.DEFAULTS.scales.join(' ');
    UI._css.textContent = Config.getCss(cfg);
  }

  function renderAll() {
    for (const el of $$('input[id], select[id], textarea[id]', root))
      if (el.id in uiCfg)
        el[el.type === 'checkbox' ? 'checked' : 'value'] = uiCfg[el.id];
    for (const el of $$('input[type="range"]', root))
      el.oninput();
    for (const el of $$('a[href^="http"]', root))
      Object.assign(el, {target: '_blank', rel: 'noreferrer noopener external'});
    UI.delay.valueAsNumber = uiCfg.delay / 1000;
    UI.scale.valueAsNumber = Math.round(clamp(uiCfg.scale - 1, 0, 1) * 100);
    UI.start.onchange();
  }
}

export function setupClickedRule(event) {
  let rule;
  const el = event.target.closest('blockquote, code, pre');
  if (el && !event.button && !eventModifiers(event) && (rule = Ruler.fromElement(el))) {
    dropEvent(event);
    setup({rule});
  }
}

/** @this {HTMLButtonElement} */
export async function setupRuleInstaller(e) {
  dropEvent(e);
  const parent = setup.UI._rules2;
  this.disabled = true;
  this.textContent = 'Loading...';
  let rules;

  try {
    rules = extractRules(await Req.getDoc(this.parentElement.href));
    this.textContent = 'Rules loaded.';
    const el = $new('select', {
      size: 8,
      style: 'width: 100%',
      ondblclick: e => e.target !== el && maybeSetup(e),
      onkeyup: e => e.key === 'Enter' && maybeSetup(e),
    }, rules.map(renderRule));
    const i = el.selectedIndex = findMatchingRuleIndex();
    parent.append(
      $new('div#_installHint', [
        'Double-click the rule (or select and press Enter) to add it. ',
        'Click ', $new('code', 'Apply'), ' or ', $new('code', 'OK'), ' to confirm.',
      ]),
      el
    );
    if (i) requestAnimationFrame(() => {
      const optY = el.selectedOptions[0].offsetTop - el.offsetTop;
      el.scrollTo(0, optY - el.offsetHeight / 2);
    });
    el.focus();
  } catch (e) {
    parent.textContent = 'Error loading rules: ' + (e.message || e);
  }

  function extractRules({doc}) {
    // sort by name
    return [...$$('#wiki-body tr', doc)]
      .map(tr => [
        tr.cells[0].textContent.trim(),
        Ruler.fromElement(tr.cells[1]),
      ])
      .filter(([name, r]) =>
        name && r && (!r.d || hostname.includes(r.d)))
      .sort(([a], [b]) =>
        (a = a.toLowerCase()) < (b = b.toLowerCase()) ? -1 :
          a > b ? 1 :
            0);
  }

  function findMatchingRuleIndex() {
    const dottedHost = `.${hostname}.`;
    let maxCount = 0, maxIndex = 0, index = 0;
    for (const [name, {d}] of rules) {
      let count = !!(d && hostname.includes(d)) * 10;
      for (const part of name.toLowerCase().split(/[^a-z\d.-]+/i))
        count += dottedHost.includes(`.${part}.`) && part.length;
      if (count > maxCount) {
        maxCount = count;
        maxIndex = index;
      }
      index++;
    }
    return maxIndex;
  }

  function renderRule([name, rule]) {
    return $new('option', {
      textContent: name,
      title: Ruler.format(rule, {expand: true})
        .replace(/^{|\s*}$/g, '')
        .split('\n')
        .slice(0, 12)
        .map(renderTitleLine)
        .filter(Boolean)
        .join('\n'),
    });
  }

  function renderTitleLine(line, i, arr) {
    return (
      // show ... on 10th line if there are more lines
      i === 9 && arr.length > 10 ? '...' :
        i > 10 ? '' :
          // truncate to 100 chars
          (line.length > 100 ? line.slice(0, 100) + '...' : line)
            // strip the leading space
            .replace(/^\s/, ''));
  }

  function maybeSetup(e) {
    if (!eventModifiers(e))
      setup({rule: rules[e.currentTarget.selectedIndex][1]});
  }
}
