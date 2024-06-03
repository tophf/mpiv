A fork of [MPIV](https://greasyfork.org/en/scripts/404-mouseover-popup-image-viewer/) (Mouseover Popup Image Viewer).

### Installation

* on GreasyFork: [link](https://greasyfork.org/scripts/394820)
* directly from GitHub: [script.user.js](https://github.com/tophf/mpiv/raw/master/script.user.js) (Tampermonkey/Violentmonkey/Greasemonkey should be installed first)

### Usage

Action | Trigger
---|---
**Activate** | hover the target and wait...<br>or configure activation on <kbd><b>Ctrl</b></kbd> or <kbd><b>AppMenu</b></kbd> key
**Deactivate** | move cursor off target, or click, or zoom out fully
**Ignore target** | hold <kbd><b>Shift</b></kbd> ⏵ hover the target ⏵ release the key
**Freeze popup** | hold <kbd><b>Shift</b></kbd> ⏵ leave the target ⏵ release the key
**Force-activate<br>(videos or small pics)** | hold <kbd><b>Ctrl</b></kbd> ⏵ hover the target ⏵ release the key
&nbsp; |
**Start zooming** | configurable (automatic or via right-click)<br>or tap <kbd><b>Shift</b></kbd> while popup is visible
**Zoom** | mouse wheel
&nbsp; |
**Rotate** | <kbd><b>L</b></kbd> <kbd><b>r</b></kbd> for "left" or "right"
**Flip/mirror** | <kbd><b>h</b></kbd> <kbd><b>v</b></kbd> for "horizontal" or "vertical"
**Previous/next<br>(in album)** | mouse wheel, <kbd><b>j</b></kbd> <kbd><b>k</b></kbd> or <kbd><b>←</b></kbd> <kbd><b>→</b></kbd> keys
**Antialiasing** | <kbd><b>a</b></kbd>
**Caption in info** | <kbd><b>c</b></kbd>
**Download** | <kbd><b>d</b></kbd>
**Fullscreen** | <kbd><b>f</b></kbd>
**Info** | <kbd><b>i</b></kbd>
**Mute** | <kbd><b>m</b></kbd>
**Night mode** | <kbd><b>n</b></kbd>
**Open in tab** | <kbd><b>t</b></kbd>
&nbsp; |
**Configure** | userscript manager toolbar icon ⏵ User Script Commands ⏵ `MPIV: configure`

![config UI screenshot](https://i.imgur.com/A7hplWg.png)

### Technical notes

* Ancient browsers aren't supported anymore because the code is using the modern JS syntax.

* Most rules were updated/enhanced, some added, some dead hostings removed.

* ShadowDOM support added for sites built with Web Components e.g. Polymer.

* The internal status updates are not exposed by default on the `<html>` node because doing so slows down complex sites due to recalculation of the *entire* page layout. Instead, only the hovered node (as reported by the matching rule) receives status updates on its `mpiv-status` attribute (it's not the `class` nor `data-` attribute to avoid confusing sites with unknown stuff being present in these standard places). If you were using the global status feature to customize CSS of those statuses, you'll need to enable it manually in the MPIV's config dialog.

* Advanced `"e"` syntax for sites that show a small overlay when hovering thumbnails (usually transparent or semi-transparent) thus effectively hiding the thumbnails from MPIV. Now you can specify `"e": {".parent": ".image"}` where `.parent` selector should match the closest parent element that contains both the overlay and the actual image, which MPIV will find using the `.image` selector applied relatively to that parent element. To refer to that parent, use `:scope` like this: `{".parent": .":scope > img:first-child"}`. To specify multiple parent-image relations: `"e": {".parent1": ".image1", ".parent2": ".image2"}`.

* New rule property `"u"` (a single string or an array of strings) that performs a very fast plain-string check. Only when it succeeds, the slow regexp `"r"` is checked. Special symbols may be specified in `"u"` property to increase the reliability of matching: `||`, `|`, `^` - same syntax as in AdBlock filters, see the source code of the script for usage examples.

    * `||foo.bar/path`, here `||` means "domain or subdomain" so the pattern matches domains like `foo.bar` or `subdomain.foo.bar` and doesn't match unrelated domains partially like for example `foofoo.bar`
    * `|foo` matches things that start with foo (the entire URL is checked so that means `http` at least, usually)
    * `^` is a URL part separator (like `/` or `?` or `:`) but not a letter/number, neither any of `%._-`. Additionally, when used at the end like `foo^` it also matches when the source ends with `foo`

* New rule property `"anonymous": true` to make the requests for this rule anonymously (i.e. without sending cookies).
