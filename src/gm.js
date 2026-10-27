export const {
  info = GM_info,
  getValue = GM_getValue, // we use it only with `await` so no need to return a Promise,
  setValue = GM_setValue, // we use it only with `await` so no need to return a Promise,
  openInTab = typeof GM_openInTab === 'function' && GM_openInTab,
  setClipboard = typeof GM_setClipboard === 'function' && GM_setClipboard,
  xmlHttpRequest = typeof GM_xmlhttpRequest === 'function' && GM_xmlhttpRequest,
  registerMenuCommand = typeof GM_registerMenuCommand === 'function' && GM_registerMenuCommand,
  unregisterMenuCommand = typeof GM_unregisterMenuCommand === 'function' && GM_unregisterMenuCommand,
} = typeof GM !== 'undefined' && GM.info ? GM : {__proto__: null};
