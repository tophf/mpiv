import {state} from './state.js';
import {now, $new, clamp} from './helpers.js';
import {AudioContext, PREFIX} from './constants.js';
import {Bar} from './bar.js';
import {Popup} from './popup.js';
import {GM} from './gm.js';

const PopupVideo = {
  create(volume) {
    state.ai.bufBar = false;
    state.ai.bufStart = now();
    return $new('video', {
      autoplay: state.ai.preloadStart !== -1,
      controls: true,
      muted: state.cfg.mute || new AudioContext().state === 'suspended',
      loop: true,
      volume: clamp(+volume || .5, 0, 1),
      onprogress: PopupVideo.progress,
      oncanplaythrough: PopupVideo.progressDone,
      onvolumechange: PopupVideo.rememberVolume,
    });
  },

  progress() {
    const {duration} = this;
    if (duration && this.buffered.length && now() - state.ai.bufStart > 2000) {
      const pct = Math.round(this.buffered.end(0) / duration * 100);
      if (state.ai.bar && (state.ai.bufBar |= pct > 0 && pct < 50))
        Bar.set(`${pct}% of ${Math.round(duration)}s`, 'xhr');
    }
  },

  progressDone() {
    this.onprogress = this.oncanplaythrough = null;
    if (state.ai.bar && state.ai.bar.classList.contains(`${PREFIX}xhr`))
      Bar.set(false);
    Popup.onLoad.call(this);
  },

  rememberVolume() {
    GM.setValue('volume', this.volume);
  },
};

export {
  PopupVideo,
};
