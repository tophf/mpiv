import {ai, cfg} from './app.js';
import {doc} from './dom.js';
import {SETTLE_TIME} from './events.js';
import {STATUS_ATTR} from './styles.js';

export function set(status) {
  if (!status && !cfg.globalStatus) {
    if (ai.node) ai.node.removeAttribute(STATUS_ATTR);
    return;
  }
  const prefix = cfg.globalStatus ? PREFIX : '';
  const action = status && /^[+-]/.test(status) && status[0];
  const name = status && `${prefix}${action ? status.slice(1) : status}`;
  const el = cfg.globalStatus ? doc.documentElement :
    name === 'edge' ? ai.popup :
      ai.node;
  if (!el) return;
  const attr = cfg.globalStatus ? 'class' : STATUS_ATTR;
  const oldValue = (el.getAttribute(attr) || '').trim();
  const cls = new Set(oldValue ? oldValue.split(/\s+/) : []);
  switch (action) {
    case '-':
      cls.delete(name);
      break;
    case false:
      for (const c of cls)
        if (c.startsWith(prefix) && c !== name)
          cls.delete(c);
    // fallthrough to +
    case '+':
      if (name)
        cls.add(name);
      break;
  }
  const newValue = [...cls].join(' ');
  if (newValue !== oldValue)
    el.setAttribute(attr, newValue);
}

export function loading(force) {
  if (!force) {
    clearTimeout(ai.timerStatus);
    ai.timerStatus = setTimeout(loading, SETTLE_TIME, true);
  } else if (!ai.popupLoaded) {
    set('+loading');
  }
}
