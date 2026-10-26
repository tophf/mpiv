import {GM} from './gm.js';
import {state} from './state.js';
import {setup} from './setup.js';

const Menu = window === top && GM.registerMenuCommand && {
  curAltName: '',
  unreg: GM.unregisterMenuCommand,
  makeAltName: () => Menu.unreg
    ? `MPIV: auto-start is ${state.cfg.start === 'auto' ? 'ON' : 'OFF'}`
    : 'MPIV: toggle auto-start',
  register() {
    GM.registerMenuCommand('MPIV: configure', setup);
    Menu.registerAlt();
  },
  registerAlt() {
    if (state.cfg.startAltShown) {
      Menu.curAltName = Menu.makeAltName();
      GM.registerMenuCommand(Menu.curAltName, Menu.onAltToggled);
    }
  },
  reRegisterAlt() {
    const old = Menu.curAltName;
    if (old && Menu.unreg) Menu.unreg(old);
    if (!old || Menu.unreg) Menu.registerAlt();
  },
  onAltToggled() {
    const wasAuto = state.cfg.start === 'auto';
    if (wasAuto) {
      state.cfg.start = state.cfg.startAlt || (state.cfg.startAlt = 'context');
    } else {
      state.cfg.startAlt = state.cfg.start;
      state.cfg.start = 'auto';
    }
    Menu.reRegisterAlt();
  },
};

export {
  Menu,
};
