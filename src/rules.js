import {ai} from './app.js';
import {$, $$, $prop, $propUp} from './dom.js';
import * as Instagram from './instagram.js';
import * as Req from './request.js';
import {tryJSON} from './util.js';
import {dotDomain, hostname, RX_MEDIA_URL} from './vars.js';

export const addBuiltinRules = rules => rules.push({
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
    toggle(rule, 'q', url.includes('.html'));
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
  s: (m, _, rule) => toggle(rule, 'q', !m[1]) ? m.input : `https://i.${m[0]}`,
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
    let u = `https://imgur.com/ajaxalbums/getimages/${ai.url.split(/[/?#]/)[4]}/hit.json?all=true`;
    let info = tryJSON((await Req.gmXhr(u)).responseText) || 0;
    let images = (info.data || 0).images || [];
    if (!images[0]) {
      info = (await Req.gmXhr(ai.url)).responseText.match(/postDataJSON=(".*?")<|$/)[1];
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
      toggle(rule, 'q', m[1]) ? m.input : [m[2] + '.jpg', m[2] + '.png'],
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
});

function toggle(rule, prop, condition) {
  rule[prop] = condition ? rule[`_${prop}`] : null;
  return condition;
}
