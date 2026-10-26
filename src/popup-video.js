import {cfg, ai} from './state.js';
import {now, $new, clamp} from './helpers.js';
import {AudioContext, PREFIX} from './constants.js';
import * as Bar from './bar.js';
import * as Popup from './popup.js';
import * as GM from './gm.js';

export function create(volume) {
  ai.bufBar = false;
  ai.bufStart = now();
  return $new('video', {
    autoplay: ai.preloadStart !== -1,
    controls: true,
    muted: cfg.mute || new AudioContext().state === 'suspended',
    loop: true,
    volume: clamp(+volume || .5, 0, 1),
    onprogress: progress,
    oncanplaythrough: progressDone,
    onvolumechange: rememberVolume,
  });
}

export function progress() {
  const {duration} = this;
  if (duration && this.buffered.length && now() - ai.bufStart > 2000) {
    const pct = Math.round(this.buffered.end(0) / duration * 100);
    if (ai.bar && (ai.bufBar |= pct > 0 && pct < 50))
      Bar.set(`${pct}% of ${Math.round(duration)}s`, 'xhr');
  }
}

export function progressDone() {
  this.onprogress = this.oncanplaythrough = null;
  if (ai.bar && ai.bar.classList.contains(`${PREFIX}xhr`))
    Bar.set(false);
  Popup.onLoad.call(this);
}

export function rememberVolume() {
  GM.setValue('volume', this.volume);
}
