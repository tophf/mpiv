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

### Development

Install Node.js 22 or newer, then run:

```sh
npm ci
npm run hooks:install
```

Edit the ES modules in `src/`. `src/main.js` starts the application, and
`src/metadata.js` contains the userscript header and version. Run `npm run build`
to bundle them with esbuild into `script.user.js`. Commit that generated file so
the existing installation links keep working. It is a standalone userscript;
users do not need Node.js or a module loader.

The main source boundaries are:

| Modules | Responsibility |
| --- | --- |
| `main.js`, `gm.js`, `constants.js`, `state.js` | Startup, userscript APIs, constants, and shared mutable state |
| `app.js`, `events.js`, `calc.js` | Preview lifecycle, input events, and positioning |
| `popup.js`, `popup-video.js`, `gallery.js`, `bar.js`, `status.js` | Media rendering and feedback |
| `rules.js`, `rule-matcher.js`, `url-matcher.js`, `instagram.js` | Site rules, matching, and Instagram support |
| `request.js`, `csp.js` | Requests and content security policy handling |
| `config.js`, `menu.js`, `setup.js`, `setup-view.js`, `styles.js` | Preferences, configuration UI, and styling |
| `helpers.js`, `util.js` | DOM helpers and application utilities |

Modules export individual functions and variables. Shared values such as `ai`
(the active preview) and `cfg` (configuration) are live `let` exports from
`state.js`. Read these imports directly and use setters such as `setAi()` and
`setCfg()` when replacing them. The setters return the assigned value and preserve
expression behavior. Configuration objects are created with `Config.create()` or
loaded with `Config.load()`; `Config.getCss(config)` formats their CSS.
Some application modules depend on one another; access those imports inside
functions and keep application startup in `main.js`.

Run `npm run dev` (or `npm run watch`) while editing to rebuild automatically when
source modules or userscript metadata change. Build errors leave the previous
successful bundle intact; saving a fix resumes rebuilding. Stop watching with
Ctrl+C. Reload your userscript manager's local development copy to try the result.

The optional local pre-commit hook rebuilds and stages `script.user.js`. Stage all
build inputs before committing; the hook refuses unstaged or untracked changes
in `src/`, `scripts/`, the package files, `jsconfig.json`, or the generated file.
This prevents a partially staged source change from leaking into the bundle.
The installer preserves existing hooks: if one is already configured, add
`node scripts/pre-commit.mjs` to it. Hook installation is local to each clone.

```sh
npm run build        # regenerate the installable userscript
npm run dev          # rebuild on source and metadata changes
npm run lint         # lint the source modules
npm test             # regression, startup, and hook checks
npm run build:check  # verify the committed bundle matches the source
```

CI runs lint, tests, and the bundle freshness check. Tests exercise the source
modules and the generated userscript, including modern and legacy userscript APIs.

### Technical notes

* Instagram: hover photos, profile/grid thumbnails, and loaded post or Reel media to preview the largest source provided by the page. Transparent hover overlays are supported. Reel covers and streaming players resolve their playable video from embedded post data. When Instagram identifies a video but withholds its playable URL, MPIV reports an error instead of showing its poster. Loaded carousel slides can be previewed individually. Links to posts, Reels, and legacy TV posts use embedded post data (including carousel galleries) or Open Graph metadata when Instagram supplies it. Login-required or unavailable posts may not expose this metadata; the script does not bypass Instagram's access restrictions.

* Instagram embeds: direct Instagram iframes and s9e embeds (such as those used by phpBB forums) relay media hover events to the containing page, so the preview can extend beyond the iframe. Video URLs are extracted from Instagram's embedded JSON even when the HTML shows only a thumbnail; photos use the largest available image. Keep the userscript enabled in all frames, including `s9e.github.io` and `instagram.com`, and reload the forum after updating it.

* After installing development dependencies, run the regression checks with `npm test`.

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
