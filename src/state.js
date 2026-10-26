/** @type {mpiv.Config} */
export let cfg;
/** @type {mpiv.AppInfo} */
export let ai = {rule: {}};
/** @type {Element} */
export let elSetup;
export let nonce;
export let timerProgress;
export let trustedHTML;
export let trustedScript;

export const setCfg = val => (cfg = val);
export const setAi = val => (ai = val);
export const setElSetup = val => (elSetup = val);
export const setNonce = val => (nonce = val);
export const setTimerProgress = val => (timerProgress = val);
export const setTrustedHTML = val => (trustedHTML = val);
export const setTrustedScript = val => (trustedScript = val);
