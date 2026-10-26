// Mutable values shared by the runtime modules. Keep reads on this object so
// replacing the active preview or configuration is visible to every consumer.
const state = {
  /** @type {mpiv.Config} */
  cfg: undefined,
  /** @type {mpiv.AppInfo} */
  ai: {rule: {}},
  /** @type {Element} */
  elSetup: undefined,
  nonce: undefined,
  timerProgress: undefined,
  trustedHTML: undefined,
  trustedScript: undefined,
};

export {
  state,
};
