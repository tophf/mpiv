import {state} from './state.js';
import {Util} from './util.js';
import {GM} from './gm.js';
import {$, pick, $propUp, $prop, $$, tryJSON, $many, isFunction, ensureArray} from './helpers.js';
import {
  RX_EVAL_BLOCKED, FN_ARGS, RX_HAS_CODE, isFF, dotDomain, doc, hostname, RX_MEDIA_URL, isArray,
  arrayFrom, SYM_U,
} from './constants.js';
import {App} from './app.js';
import * as Instagram from './instagram.js';
import {Req} from './request.js';
import {RuleMatcher} from './rule-matcher.js';
import {UrlMatcher} from './url-matcher.js';

const Ruler = {
/*
 'u' works only with URLs so it's ignored if 'html' is true
   ||some.domain = matches some.domain, anything.some.domain, etc.
   |foo = url or text must start with foo
   ^ = separator like / or ? or : but not a letter/number, not %._-
       when used at the end like "foo^" it additionally matches when the source ends with "foo"
 'r' is checked only if 'u' matches first
*/
  init() {
    const errors = new Map();
    const src = state.cfg.hosts || [];
    const uniq = src.filter((r, i, arr) => !i || !Util.deepEqual(r, arr[i - 1]));
    if (uniq.length < src.length)
      GM.setValue('cfg', state.cfg);
    /** @type mpiv.HostRule[] */
    const rules = Ruler.rules = uniq.map(Ruler.parse, errors).filter(Boolean);
    const hasGMAE = typeof GM_addElement === 'function';
    const canEval = state.nonce || (state.nonce = ($('script[nonce]') || {}).nonce || '') || hasGMAE;
    const evalId = canEval && `${GM_info.script.name}${Math.random()}`;
    const evalRules = [];
    const evalCode = [`window[${JSON.stringify(evalId)}]=[`];
    for (const [rule, err] of errors.entries()) {
      if (!RX_EVAL_BLOCKED.test(err)) {
        App.handleError('Invalid custom host rule:', rule);
        continue;
      }
      if (canEval) {
        evalCode.push(evalRules.length ? ',' : '',
          '[', rules.indexOf(rule), ',{',
          ...Object.keys(FN_ARGS)
            .map(k => RX_HAS_CODE.test(rule[k]) && `${k}(${FN_ARGS[k]}){${rule[k]}},`)
            .filter(Boolean),
          '}]');
      }
      evalRules.push(rule);
    }
    if (evalRules.length) {
      let result, wnd;
      if (canEval) {
        const GMAE = hasGMAE
          ? GM_addElement
          : (tag, {textContent: txt}) => document.head.appendChild(
            Object.assign(document.createElement(tag), {
              textContent: state.trustedScript ? state.trustedScript(txt) : txt,
              nonce: state.nonce,
            }));
        evalCode.push(']; document.currentScript.remove();');
        GMAE('script', {textContent: evalCode.join('')});
        result = (wnd = unsafeWindow)[evalId] ||
          isFF && (wnd = wnd.wrappedJSObject)[evalId];
      }
      if (result) {
        for (const [index, fns] of result)
          Object.assign(rules[index], fns);
        delete wnd[evalId];
      } else {
        console.warn('Site forbids compiling JS code in these custom rules', evalRules);
      }
    }

    // optimization: a rule is created only when on domain
    switch (dotDomain.match(/[^.]+(?=\.com?(?:\.[^.]+)?$)|[^.]+\.[^.]+$|$/)[0]) {

      case '4chan.org': rules.push({
        e: '.is_catalog .thread a[href*="/thread/"], .catalog-thread a[href*="/thread/"]',
        q: '.op .fileText a',
        css: '#post-preview{display:none}',
      }); break;

      case 'amazon': rules.push({
        r: /.+?images\/I\/.+?\./,
        s: m => {
          const uh = doc.getElementById('universal-hover');
          return uh ? '' : m[0] + 'jpg';
        },
        css: '#zoomWindow{display:none!important;}',
      }); break;

      case 'bing': rules.push({
        e: 'a[m*="murl"]',
        r: /murl&quot;:&quot;(.+?)&quot;/,
        s: '$1',
        html: true,
      }); break;

      case 'deviantart': rules.push({
        e: 'a[href*="/art/"] img[src*="/v1/"]',
        r: /^(.+)\/v1\/\w+\/[^/]+\/(.+)-\d+.(\.\w+)(\?.+)/,
        s: ([, base, name, ext, tok], node) => {
          let v = Util.getReactChildren(node.closest('a'), 'props.deviation.media.types');
          return v && (v = v.find(t => t.t === 'fullview')) && `${base}${
            v.c ? v.c.replace('<prettyName>', name)
              : `/v1/fill/w_${v.w},h_${v.h}/${name}-fullview${ext}`}${tok}`;
        },
      }, {
        e: '.dev-view-deviation img',
        s: () => [
          $('.dev-page-download').href,
          $('.dev-content-full').src,
        ].filter(Boolean),
      }, {
        e: 'a[data-hook=deviation_link]',
        q: 'link[as=image]',
      }); break;

      case 'discord': rules.push({
        u: '||discordapp.net/external/',
        r: /\/https?\/(.+)/,
        s: '//$1',
        follow: true,
      }); break;

      case 'dropbox': rules.push({
        r: /(.+?&size_mode)=\d+(.*)/,
        s: '$1=5$2',
      }); break;

      case 'facebook': rules.push({
        e: 'a[href^="/photo/?"], a[href^="https://www.facebook.com/photo"]',
        s: (m, el) => (m = Util.getReactChildren(el.parentNode)) &&
          pick(m, (m[0] ? '0.props.linkProps' : 'props') + '.passthroughProps.origSrc'),
      }); break;

      case 'flickr': if (pick(unsafeWindow, 'YUI_config.flickr.api.site_key')) rules.push({
        r: /flickr\.com\/photos\/[^/]+\/(\d+)/,
        s: m => `https://www.flickr.com/services/rest/?${
          new URLSearchParams({
            photo_id: m[1],
            api_key: unsafeWindow.YUI_config.flickr.api.site_key,
            method: 'flickr.photos.getSizes',
            format: 'json',
            nojsoncallback: 1,
          }).toString()}`,
        q: text => JSON.parse(text).sizes.size.pop().source,
        anonymous: true,
      }); break;

      case 'github': rules.push({
        r: new RegExp([
          /(avatars.+?&s=)\d+/,
          /(raw\.github)(\.com\/.+?\/img\/.+)$/,
          /\/(github)(\.com\/.+?\/)blob\/([^/]+\/.+?\.(?:avif|webp|png|jpe?g|bmp|gif|cur|ico|svg))$/,
        ].map(rx => rx.source).join('|')),
        s: m => `https://${
          m[1] ? `${m[1]}460` :
            m[2] ? `${m[2]}usercontent${m[3]}` :
              $('.AppHeader-context-item > .octicon-lock')
                ? `${m[4]}${m[5]}raw/${m[6]}`
                : `raw.${m[4]}usercontent${m[5]}${m[6]}`
        }`,
      }); break;

      case 'google': if (location.pathname === '/search') rules.push({
        e: /[&?](sclient=img|udm=2)(&|$)/.test(location.search)
          ? '[data-docid] img'
          : '[jsdata][id] img',
        s: (m, el, rule) => {
          el = el.closest(rule.e.split(' ')[0]);
          const id = el.dataset.docid || el.id;
          if (isFF) el = el.wrappedJSObject || el;
          if ((el = el.__jscontroller) && (el = el.pending) && (el = el.value))
            for (let a in el)
              if (({}).toString.call(a = el[a]) === '[object Object]')
                for (const b in a)
                  if (Array.isArray(m = a[b]) && m.includes(id)
                  && (m[1] === id || (m = m[1]) && Array.isArray(m = m[b]) && m[1] === id)
                  && Array.isArray(m = m[3]))
                    return m[0];
        },
      }); break;

      case 'instagram': rules.push({
        e: 'img, video, main div, article div, [role="dialog"] div, ' + Instagram.links,
        s: Instagram.preview,
        c: (html, doc, node, rule) => (rule._img || {}).alt || '',
      }); break;

      case 'reddit': rules.push({
        u: '||i.reddituploads.com/',
      }, {
        e: '[data-url*="i.redd.it"] img[src*="thumb"]',
        s: (m, node) => $propUp(node, 'data-url'),
      }, {
        r: /preview(\.redd\.it\/\w+\.(jpe?g|png|gif))/,
        s: 'https://i$1',
      }); break;

      case 'stackoverflow': rules.push({
        e: '.post-tag, .post-tag img',
        s: '',
      }); break;

      case 'startpage': rules.push({
        r: /[&?]piurl=([^&]+)/,
        s: '$1',
        follow: true,
      }); break;

      case 'tumblr': rules.push({
        e: 'div.photo_stage_img, div.photo_stage > canvas',
        s: (m, node) => /http[^"]+/.exec(node.style.cssText + node.getAttribute('data-img-src'))[0],
        follow: true,
      }); break;

      case 'twitter': rules.push({
        e: '.grid-tweet > .media-overlay',
        s: (m, node) => node.previousElementSibling.src,
        follow: true,
      }); break;
    }

    rules.push(
      {
        e: 'iframe',
        s: (m, node) => Instagram.embedUrl(node.src) || false,
        q: Instagram.embedSource,
        c: (text, doc) => $prop('.EmbeddedMediaImage', 'alt', doc),
      },
      {
        r: /[/?=](https?%3A%2F%2F[^&]+)/i,
        s: '$1',
        follow: true,
        onerror: 'skip',
      },
      {
        u: [
          '||500px.com/photo/',
          '||cl.ly/',
          '||cweb-pix.com/',
          '//ibb.co/',
          '||imgcredit.xyz/image/',
        ],
        r: /\.\w+\/.+/,
        q: 'meta[property="og:image"]',
      },
      {
        u: 'attachment.php',
        r: /attachment\.php.+attachmentid/,
      },
      {
        u: '||abload.de/image',
        q: '#image',
      },
      {
        u: '||deviantart.com/art/',
        s: (m, node) =>
          /\b(film|lit)/.test(node.className) || /in Flash/.test(node.title) ?
            '' :
            m.input,
        q: [
          '#download-button[href*=".jpg"]',
          '#download-button[href*=".jpeg"]',
          '#download-button[href*=".gif"]',
          '#download-button[href*=".png"]',
          '#gmi-ResViewSizer_fullimg',
          'img.dev-content-full',
        ],
      },
      {
        u: '||dropbox.com/s',
        r: /com\/sh?\/.+\.(jpe?g|gif|png)/i,
        q: (text, doc) =>
          $prop('img.absolute-center', 'src', doc).replace(/(size_mode)=\d+/, '$1=5') || false,
      },
      {
        r: /[./]ebay\.[^/]+\/itm\//,
        q: text =>
          text.match(/https?:\/\/i\.ebayimg\.com\/[^.]+\.JPG/i)[0]
            .replace(/~~60_\d+/, '~~60_57'),
      },
      {
        u: '||i.ebayimg.com/',
        s: (m, node) =>
          $('.zoom_trigger_mask', node.parentNode) ? '' :
            m.input.replace(/~~60_\d+/, '~~60_57'),
      },
      {
        u: '||fastpic.',
        s: (m, node, rule) => {
          const a = node.closest('a');
          const url = decodeURIComponent(Req.findImageUrl(a || node))
            .replace(/\/i(\d+)\.(\w+\.\w+\/)\w+/, '/$2$1')
            .replace(/^\w+:\/\/fastpic[^/]+((?:\/\d+){3})\/\w+(\/\w+\.\w+).*/,
              'https://fastpic.org/view$1$2.html');
          Ruler.toggle(rule, 'q', url.includes('.html'));
          return a || url.includes('.png') ? url : [url, url.replace(/\.jpe?g/, '.png')];
        },
        _q: (text, doc, n) => (n = $('input[value*="/big/"]', doc)) && n.value ||
          $prop('a[href*="/big/"]', 'href', doc),
      },
      {
        u: '||flickr.com/photos/',
        r: /photos\/([0-9]+@N[0-9]+|[a-z0-9_-]+)\/([0-9]+)/,
        s: m =>
          m.input.indexOf('/sizes/') < 0 ?
            `https://www.flickr.com/photos/${m[1]}/${m[2]}/sizes/sq/` :
            false,
        q: (text, doc) => {
          const links = $$('.sizes-list a', doc);
          return 'https://www.flickr.com' + links[links.length - 1].getAttribute('href');
        },
        follow: true,
      },
      {
        u: '||flickr.com/photos/',
        r: /\/sizes\//,
        q: '#allsizes-photo > img',
      },
      {
        u: '||gfycat.com/',
        r: /(gfycat\.com\/)(gifs\/detail\/|iframe\/)?([a-z]+)/i,
        s: 'https://$1$3',
        q: 'meta[content$=".webm"], #webmsource, source[src$=".webm"], .actual-gif-image',
      },
      {
        u: [
          '||googleusercontent.com/proxy',
          '||googleusercontent.com/gadgets/proxy',
        ],
        r: /\.com\/(proxy|gadgets\/proxy.+?(http.+?)&)/,
        s: m => m[2] ? decodeURIComponent(m[2]) : m.input.replace(/w\d+-h\d+($|-p)/, 'w0-h0'),
      },
      {
        u: [
          '||googleusercontent.com/',
          '||ggpht.com/',
        ],
        s: m => m.input.includes('webcache.') ? '' :
          m.input.replace(/\/s\d{2,}-[^/]+|\/w\d+-h\d+/, '/s0')
            .replace(/([&?]sz)?=[-\w]+([&#].*)?/, ''),
      },
      {
        u: '||gravatar.com/',
        r: /([a-z0-9]{32})/,
        s: 'https://gravatar.com/avatar/$1?s=200',
      },
      {
        u: '//gyazo.com/',
        r: /\bgyazo\.com\/\w{32,}(\.\w+)?/,
        s: (m, _, rule) => Ruler.toggle(rule, 'q', !m[1]) ? m.input : `https://i.${m[0]}`,
        _q: 'link[rel="image_src"]',
      },
      {
        u: '||hostingkartinok.com/show-image.php',
        q: '.image img',
      },
      {
        u: [
          '||imagecurl.com/images/',
          '||imagecurl.com/viewer.php',
        ],
        r: /(?:images\/(\d+)_thumb|file=(\d+))(\.\w+)/,
        s: 'https://imagecurl.com/images/$1$2$3',
      },
      {
        u: '||imagebam.com/',
        r: /^(https:\/\/)thumbs\d+(\.imagebam\.com\/).*?([^/]+)_t\./,
        s: '$1www$2view/$3',
        q: 'img.main-image',
      },
      {
        u: '||www.imagebam.com/view/',
        q: 'img.main-image',
      },
      {
        u: '||imageban.ru/thumbs',
        r: /(.+?\/)thumbs(\/\d+)\.(\d+)\.(\d+\/.*)/,
        s: '$1out$2/$3/$4',
      },
      {
        u: [
          '||imageban.ru/show',
          '||imageban.net/show',
          '||ibn.im/',
        ],
        q: '#img_main',
      },
      {
        u: '||imageshack.us/img',
        r: /img(\d+)\.(imageshack\.us)\/img\\1\/\d+\/(.+?)\.th(.+)$/,
        s: 'https://$2/download/$1/$3$4',
      },
      {
        u: '||imageshack.us/i/',
        q: '#share-dl',
      },
      {
        u: '||imageteam.org/img',
        q: 'img[alt="image"]',
      },
      {
        u: [
          '||imagetwist.com/',
          '||imageshimage.com/',
        ],
        r: /(\/\/|^)[^/]+\/[a-z0-9]{8,}/,
        q: 'img.pic',
        xhr: true,
      },
      {
        u: '||imageupper.com/i/',
        q: '#img',
        xhr: true,
      },
      {
        u: '||imagevenue.com/',
        q: 'a[data-toggle="full"] img',
      },
      {
        u: '||imagezilla.net/show/',
        q: '#photo',
        xhr: true,
      },
      {
        u: [
          '||images-na.ssl-images-amazon.com/images/',
          '||media-imdb.com/images/',
        ],
        r: /images\/.+?\.jpg/,
        s: '/V1\\.?_.+?\\.//g',
      },
      {
        u: '||imgbox.com/',
        r: /\.com\/([a-z0-9]+)$/i,
        q: '#img',
        xhr: hostname !== 'imgbox.com',
      },
      {
        u: '||imgclick.net/',
        r: /\.net\/(\w+)/,
        q: 'img.pic',
        xhr: true,
        post: m => `op=view&id=${m[1]}&pre=1&submit=Continue%20to%20image...`,
      },
      {
        u: '.imgcredit.xyz/',
        r: /^https?(:.*\.xyz\/\d[\w/]+)\.md(.+)/,
        s: ['https$1$2', 'https$1.png'],
      },
      {
        u: [
          '||imgflip.com/i/',
          '||imgflip.com/gif/',
        ],
        r: /\/(i|gif)\/([^/?#]+)/,
        s: m => `https://i.imgflip.com/${m[2]}${m[1] === 'i' ? '.jpg' : '.mp4'}`,
      },
      {
        u: [
          '||imgur.com/a/',
          '||imgur.com/gallery/',
        ],
        s: 'gallery', // suppressing an unused network request for remote `document`
        async g() {
          let u = `https://imgur.com/ajaxalbums/getimages/${state.ai.url.split(/[/?#]/)[4]}/hit.json?all=true`;
          let info = tryJSON((await Req.gmXhr(u)).responseText) || 0;
          let images = (info.data || 0).images || [];
          if (!images[0]) {
            info = (await Req.gmXhr(state.ai.url)).responseText.match(/postDataJSON=(".*?")<|$/)[1];
            info = tryJSON(tryJSON(info)) || 0;
            images = info.media;
          }
          const items = [];
          for (const img of images) {
            const meta = img.metadata || img;
            items.push({
              url: img.url ||
                (u = `https://i.imgur.com/${img.hash}`) && (
                  img.ext === '.gif' && img.animated !== false ?
                    [`${u}.webm`, `${u}.mp4`, u] :
                    u + img.ext
                ),
              desc: [meta.title, meta.description].filter(Boolean).join(' - '),
            });
          }
          if (items[0] && info.title && !`${items[0].desc || ''}`.includes(info.title))
            items.title = info.title;
          return items;
        },
      },
      {
        u: '||imgur.com/',
        r: /((?:[a-z]{2,}\.)?imgur\.com\/)((?:\w+,)+\w*)/,
        s: 'gallery',
        g: (text, doc, url, m) =>
          m[2].split(',').map(id => ({
            url: `https://i.${m[1]}${id}.jpg`,
          })),
      },
      {
        u: '||imgur.com/',
        r: /([a-z]{2,}\.)?imgur\.com\/(r\/[a-z]+\/|[a-z0-9]+#)?([a-z0-9]{5,})($|\?|\.(mp4|[a-z]+))/i,
        s: (m, node) => {
          if (/memegen|random|register|search|signin/.test(m.input))
            return '';
          const a = node.closest('a');
          if (a && a !== node && /(i\.([a-z]+\.)?)?imgur\.com\/(a\/|gallery\/)?/.test(a.href))
            return false;
          // postfixes: huge, large, medium, thumbnail, big square, small square
          const id = m[3].replace(/(.{7})[hlmtbs]$/, '$1');
          const ext = m[5] ? m[5].replace(/gifv?/, 'webm') : 'jpg';
          const u = `https://i.${(m[1] || '').replace('www.', '')}imgur.com/${id}.`;
          return ext === 'webm' ?
            [`${u}webm`, `${u}mp4`, `${u}gif`] :
            u + ext;
        },
      },
      {
        u: ['||instagr.am/', '||instagram.com/'],
        r: /^https?:\/\/[^/]+\/(?:[^/?#]+\/)?((?:p|tv|reels?)\/((?!audio(?:[/?#]|$))[\w-]+))(?=[/?#]|$)/,
        s: m => `https://www.instagram.com/p/${m[2]}/embed/captioned/`,
        g: Instagram.gallery,
      },
      {
        u: [
          '||livememe.com/',
          '||lvme.me/',
        ],
        r: /\.\w+\/([^.]+)$/,
        s: 'http://i.lvme.me/$1.jpg',
      },
      {
        u: '||lostpic.net/image',
        q: '.image-viewer-image img',
      },
      {
        u: '||makeameme.org/meme/',
        r: /\/meme\/([^/?#]+)/,
        s: 'https://media.makeameme.org/created/$1.jpg',
      },
      {
        u: '||photobucket.com/',
        r: /(\d+\.photobucket\.com\/.+\/)(\?[a-z=&]+=)?(.+\.(jpe?g|png|gif))/,
        s: 'https://i$1$3',
        xhr: !dotDomain.endsWith('.photobucket.com'),
      },
      {
        u: '||piccy.info/view3/',
        r: /(.+?\/view3)\/(.*)\//,
        s: '$1/$2/orig/',
        q: '#mainim',
      },
      {
        u: '||pimpandhost.com/image/',
        r: /(.+?\/image\/[0-9]+)/,
        s: '$1?size=original',
        q: 'img.original',
      },
      {
        u: [
          '||pixroute.com/',
          '||imgspice.com/',
        ],
        r: /\.html$/,
        q: 'img[id]',
        xhr: true,
      },
      {
        u: '||postima',
        r: /postima?ge?\.org\/image\/\w+/,
        q: [
          'a[href*="dl="]',
          '#main-image',
        ],
      },
      {
        u: [
          '||prntscr.com/',
          '||prnt.sc/',
        ],
        r: /\.\w+\/.+/,
        q: 'meta[property="og:image"]',
        xhr: true,
      },
      {
        u: '||radikal.ru/',
        r: /\.ru\/(fp|.+?\.html)|^(.+?)t\.jpg/,
        s: (m, node, rule) =>
          m[2] && /radikal\.ru[\w%/]+?(\.\w+)/.test($propUp(node, 'href')) ? m[2] + RegExp.$1 :
            Ruler.toggle(rule, 'q', m[1]) ? m.input : [m[2] + '.jpg', m[2] + '.png'],
        _q: text => text.match(/https?:\/\/\w+\.radikal\.ru[\w/]+\.(jpg|gif|png)/i)[0],
      },
      {
        u: '||tumblr.com',
        r: /_500\.jpg/,
        s: ['/_500/_1280/', ''],
      },
      {
        u: '||twimg.com/media/',
        r: /.+?format=(jpe?g|png|gif)/i,
        s: '$0&name=orig',
      },
      {
        u: '||twimg.com/media/',
        r: /.+?\.(jpe?g|png|gif)/i,
        s: '$0:orig',
      },
      {
        u: '||twimg.com/1/proxy',
        r: /t=([^&_]+)/i,
        s: m => atob(m[1]).match(/http.+/),
      },
      {
        u: '||twimg.com/',
        r: /\/profile_images/i,
        s: '/_(reasonably_small|normal|bigger|\\d+x\\d+)\\././g',
      },
      {
        u: '||pic.twitter.com/',
        r: /\.com\/[a-z0-9]+/i,
        q: text => text.match(/https?:\/\/twitter\.com\/[^/]+\/status\/\d+\/photo\/\d+/i)[0],
        follow: true,
      },
      {
        u: '||twitpic.com/',
        r: /\.com(\/show\/[a-z]+)?\/([a-z0-9]+)($|#)/i,
        s: 'https://twitpic.com/show/large/$2',
      },
      {
        u: '||wiki',
        r: /\/(?:thumb|images)\/.+\.(?:jpe?g|gif|png|svg)/i,
        s: m => m.input.replace(/\/(thumb(?=\/)|\d+px[^/]+(?=$|\?))/g, '')
          .replace('//thumb.wikimedia.org/', '//upload.wikimedia.org/')
          .replace(/\/(scale-to-width(-[a-z]+)?\/\d+|(zoom-crop|smart)(\/(width|height)\/\d+)+)/g, '/'),
        xhr: !hostname.includes('wiki'),
      },
      {
        u: '||ytimg.com/vi/',
        r: /(.+?\/vi\/[^/]+)/,
        s: '$1/0.jpg',
        rect: '.video-list-item',
      },
      {
        u: '/viewer.php?file=',
        r: /(.+?)\/viewer\.php\?file=(.+)/,
        s: '$1/images/$2',
        xhr: true,
      },
      {
        u: '/thumb_',
        r: /\/albums.+\/thumb_[^/]/,
        s: '/thumb_//',
      },
      {
        u: [
          '.th.jp',
          '.th.gif',
          '.th.png',
        ],
        r: /(.+?\.)th\.(jpe?g?|gif|png|svg|webm)$/i,
        s: '$1$2',
        follow: true,
      },
      {
        r: RX_MEDIA_URL,
      }
    );
  },

  format(rule, {expand} = {}) {
    const s = Util.stringify(rule, null, ' ');
    return expand ?
      /* {"a": ...,
          "b": ...,
          "c": ...
         } */
      s.replace(/^{\s+/g, '{') :
      /* {"a": ..., "b": ..., "c": ...} */
      s.replace(/\n\s*/g, ' ').replace(/^({)\s|\s+(})$/g, '$1$2');
  },

  fromElement(el) {
    const text = el.textContent.trim();
    if (text.startsWith('{') &&
        text.endsWith('}') &&
        /[{,]\s*"[degqrsu]"\s*:\s*"/.test(text)) {
      const rule = tryJSON(text);
      return rule && Object.keys(rule).some(k => /^[degqrsu]$/.test(k)) && rule;
    }
  },

  isValidE2: ([k, v]) => k.trim() && typeof v === 'string' && v.trim(),

  /** @returns mpiv.HostRule | Error | false | undefined */
  parse(rule) {
    const isBatchOp = this instanceof Map;
    try {
      if (typeof rule === 'string')
        rule = JSON.parse(rule);
      if ('d' in rule && typeof rule.d !== 'string')
        rule.d = undefined;
      else if (isBatchOp && rule.d && !hostname.includes(rule.d))
        return false;
      let {e} = rule;
      if (e != null) {
        e = typeof e === 'string' ? e.trim()
          : isArray(e) ? e.join(',').trim()
            : Object.entries(e).every(Ruler.isValidE2) && e;
        if (!e)
          throw new Error('Invalid syntax for "e". Examples: ' +
            '"e": ".image" or ' +
            '"e": [".image1", ".image2"] or ' +
            '"e": {".parent": ".image"} or ' +
            '"e": {".parent1": ".image1", ".parent2": ".image2"}');
        if (isBatchOp) rule.e = e || undefined;
      }
      let compileTo = isBatchOp ? rule : {};
      if (rule.r)
        compileTo.r = new RegExp(rule.r, 'i');
      if (App.NOP)
        compileTo = {};
      for (const key of Object.keys(FN_ARGS)) {
        if (RX_HAS_CODE.test(rule[key])) {
          const fn = Util.newFunction(...FN_ARGS[key], rule[key]);
          if (fn !== App.NOP || !isBatchOp) {
            compileTo[key] = fn;
          } else if (isBatchOp) {
            this.set(rule, 'unsafe-eval');
          }
        }
      }
      return rule;
    } catch (err) {
      if (isBatchOp) {
        this.set(rule, err);
        return rule;
      } else {
        return err;
      }
    }
  },

  runC(text, doc = document) {
    const fn = Ruler.runCHandler[typeof state.ai.rule.c] || Ruler.runCHandler.default;
    state.ai.caption = fn(text, doc);
  },

  runCHandler: {
    function: (text, doc) =>
      state.ai.rule.c(text || doc.documentElement.outerHTML, doc, state.ai.node, state.ai.rule),
    string: (text, doc) => {
      const el = $many(state.ai.rule.c, doc);
      return !el ? '' :
        el.getAttribute('content') ||
        el.getAttribute('title') ||
        el.textContent;
    },
    default: (text, doc, el = state.ai.node) =>
      (state.ai.tooltip || 0).text ||
      el.alt ||
      $propUp(el, 'title') ||
      Req.getFileName(
        el.tagName === (state.ai.popup || 0).tagName
          ? state.ai.url
          : el.src || $propUp(el, 'href')),
  },

  runQ(text, doc, docUrl) {
    let url;
    if (isFunction(state.ai.rule.q)) {
      url = state.ai.rule.q(text, doc, state.ai.node, state.ai.rule);
      if (isArray(url)) {
        state.ai.urls = url.slice(1);
        url = url[0];
      }
    } else {
      const el = $many(state.ai.rule.q, doc);
      url = Req.findImageUrl(el, docUrl);
    }
    return url;
  },

  /** @returns {?boolean|mpiv.RuleMatchInfo} */
  runE(rule, e, node) {
    let p, img, res, info;
    for (const selParent in e) {
      if ((p = node.closest(selParent)) && (img = $(e[selParent], p))) {
        if (img === node)
          res = true;
        else if ((info = RuleMatcher.adaptiveFind(img, {rules: [rule]})))
          return info;
      }
    }
    return res;
  },

  /** @returns {?Array} if falsy then the rule should be skipped */
  runS(node, rule, m) {
    let urls = [], u;
    for (const s of ensureArray(rule.s))
      urls.push(
        typeof s === 'string' ? Util.decodeUrl(Ruler.substituteSingle(s, m)) :
          isFunction(s) ? s(m, node, rule) :
            s);
    if (rule.q && urls.length > 1) {
      console.warn('Rule discarded: "s" array is not allowed with "q"\n%o', rule);
      return;
    }
    if (isArray(u = urls[0]))
      u = [urls = u][0];
    return u === '' /* "stop all rules" */ ? urls
      : u && arrayFrom(new Set(urls), Util.decodeUrl);
  },

  /** @returns {boolean} */
  runU(rule, url) {
    const u = rule[SYM_U] || (rule[SYM_U] = UrlMatcher(rule.u));
    return u.fn.call(u.data, url);
  },

  substituteSingle(s, m) {
    if (!m || m.input == null) return s;
    if (s.startsWith('/') && !s.startsWith('//')) {
      const mid = s.search(/[^\\]\//) + 1;
      const end = s.lastIndexOf('/');
      const re = new RegExp(s.slice(1, mid), s.slice(end + 1));
      return m.input.replace(re, s.slice(mid + 1, end));
    }
    if (m.length && s.includes('$')) {
      const maxLength = Math.floor(Math.log10(m.length)) + 1;
      s = s.replace(/\$(\d{1,3})/g, (text, num) => {
        for (let i = maxLength; i >= 0; i--) {
          const part = num.slice(0, i) | 0;
          if (part < m.length)
            return (m[part] || '') + num.slice(i);
        }
        return text;
      });
    }
    return s;
  },

  toggle(rule, prop, condition) {
    rule[prop] = condition ? rule[`_${prop}`] : null;
    return condition;
  },
};

export {
  Ruler,
};
