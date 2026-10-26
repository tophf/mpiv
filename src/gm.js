const api = typeof GM !== 'undefined' && GM.xmlHttpRequest
  ? GM : {__proto__: null, info: GM_info};
if (!api.getValue)
  api.getValue = GM_getValue; // we use it only with `await` so no need to return a Promise
if (!api.setValue)
  api.setValue = GM_setValue; // we use it only with `await` so no need to return a Promise
if (!api.openInTab)
  api.openInTab = GM_openInTab;
if (!api.registerMenuCommand && typeof GM_registerMenuCommand === 'function')
  api.registerMenuCommand = GM_registerMenuCommand;
if (!api.unregisterMenuCommand && typeof GM_unregisterMenuCommand === 'function')
  api.unregisterMenuCommand = GM_unregisterMenuCommand;
if (!api.setClipboard)
  api.setClipboard = GM_setClipboard;
if (!api.xmlHttpRequest)
  api.xmlHttpRequest = GM_xmlhttpRequest;

export const info = api.info;
export const getValue = api.getValue.bind(api);
export const setValue = api.setValue.bind(api);
export const openInTab = api.openInTab.bind(api);
export const setClipboard = api.setClipboard.bind(api);
export const xmlHttpRequest = api.xmlHttpRequest.bind(api);
export const registerMenuCommand = api.registerMenuCommand && api.registerMenuCommand.bind(api);
export const unregisterMenuCommand =
  api.unregisterMenuCommand && api.unregisterMenuCommand.bind(api);
