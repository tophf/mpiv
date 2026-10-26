import {state} from './state.js';
import {STATUS_ATTR, PREFIX, doc, SETTLE_TIME} from './constants.js';

const Status = {

  set(status) {
    if (!status && !state.cfg.globalStatus) {
      if (state.ai.node) state.ai.node.removeAttribute(STATUS_ATTR);
      return;
    }
    const prefix = state.cfg.globalStatus ? PREFIX : '';
    const action = status && /^[+-]/.test(status) && status[0];
    const name = status && `${prefix}${action ? status.slice(1) : status}`;
    const el = state.cfg.globalStatus ? doc.documentElement :
      name === 'edge' ? state.ai.popup :
        state.ai.node;
    if (!el) return;
    const attr = state.cfg.globalStatus ? 'class' : STATUS_ATTR;
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
  },

  loading(force) {
    if (!force) {
      clearTimeout(state.ai.timerStatus);
      state.ai.timerStatus = setTimeout(Status.loading, SETTLE_TIME, true);
    } else if (!state.ai.popupLoaded) {
      Status.set('+loading');
    }
  },
};

export {
  Status,
};
