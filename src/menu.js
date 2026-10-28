import {cfg} from './app.js';
import * as GM from './gm.js';

let curAltName = '';

const unreg = GM.unregisterMenuCommand;

const makeAltName = () => unreg
  ? `MPIV: auto-start is ${cfg.start === 'auto' ? 'ON' : 'OFF'}`
  : 'MPIV: toggle auto-start';

export function registerAlt() {
  if (cfg.startAltShown) {
    curAltName = makeAltName();
    GM.registerMenuCommand(curAltName, onAltToggled);
  }
}

export function reRegisterAlt() {
  const old = curAltName;
  if (old && unreg) unreg(old);
  if (!old || unreg) registerAlt();
}

function onAltToggled() {
  const wasAuto = cfg.start === 'auto';
  if (wasAuto) {
    cfg.start = cfg.startAlt ||= 'context';
  } else {
    cfg.startAlt = cfg.start;
    cfg.start = 'auto';
  }
  reRegisterAlt();
}
