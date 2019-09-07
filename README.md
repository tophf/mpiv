Direct installation link for Tampermonkey: [script.user.js](https://github.com/tophf/mpiv/raw/master/script.user.js)

A fork of [MPIV](https://greasyfork.org/en/scripts/404-mouseover-popup-image-viewer/) (Mouseover Popup Image Viewer).

* Ancient browsers aren't supported because the code was refactored to the common JS norms and ES2015+ syntax
* Quite a few rules were updated/enhanced, some added, some dead hostings removed
* ShadowDOM support added for sites built with Web Components e.g. Polymer
* New rule property `"u"` (a single string or an array of strings) that performs a very fast plain-string check and only if it succeeds MPIV would proceed to a slow regexp check in `"r"`
* Special symbols may be specified in `"d"` and `"u"` properties to increase the reliability of matching: `||`, `|`, `^` - same syntax as in AdBlock filters, see the source code of the script for usage examples 
