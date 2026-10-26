import {ai} from './state.js';
import {hostname, PREFIX, arrayFrom, isArray} from './constants.js';
import {$$, clamp, $many, $prop, $, isVideo, tryJSON, pick} from './helpers.js';
import * as Events from './events.js';
import * as App from './app.js';
import * as Util from './util.js';

let inEmbed = false;
let embedHovered = false;

export const links = 'a[href*="/p/"], a[href*="/tv/"], a[href*="/reel/"], a[href*="/reels/"]';

export function embedUrl(src) {
  let url, code;
  try { url = new URL(src); } catch (e) { return ''; }
  if (!/^https?:$/.test(url.protocol)) return '';
  if (url.hostname === 's9e.github.io' &&
      /^\/iframe\/(?:\d+\/)?instagram(?:\.min)?\.html$/.test(url.pathname)) {
    code = url.hash.slice(1).split('#')[0];
  } else if (/(^|\.)instagram\.com$/.test(url.hostname)) {
    code = (url.pathname.match(/^\/(?:p|tv|reels?)\/([\w-]+)\/embed(?:\/|$)/) || [])[1];
  }
  return code && /^[\w-]+$/.test(code)
    ? `https://www.instagram.com/p/${code}/embed/captioned/` : '';
}

export function initEmbed() {
  if (window === top || !embedUrl(location.href)) return;
  if (hostname === 's9e.github.io') return; // Only relay messages from its Instagram child.
  inEmbed = true;
  for (const type of ['mousemove', 'mouseout', 'mousedown'])
    addEventListener(type, relayEmbedEvent, {capture: true, passive: true});
}

export function relayEmbedEvent(e) {
  if (!inEmbed) return false;
  const media = e.target.closest && e.target.closest('.EmbeddedMedia, .EmbedFrame');
  if (e.type === 'mouseout' && media && media.contains(e.relatedTarget)) return true;
  const hovered = !!media && e.type !== 'mouseout';
  if (hovered || embedHovered) {
    parent.postMessage({
      type: `${PREFIX}instagram-embed`,
      action: hovered ? e.type : 'mouseout',
      clientX: e.clientX, clientY: e.clientY,
      width: innerWidth, height: innerHeight,
      shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, button: e.button,
    }, '*');
  }
  embedHovered = hovered;
  return true; // The forum displays the popup outside the nested iframe.
}

export function onEmbedMessage(e) {
  const data = e.data;
  if (!data || data.type !== `${PREFIX}instagram-embed`) return false;
  if (!e.source || !['mouseover', 'mousemove', 'mouseout', 'mousedown'].includes(data.action) ||
      ![data.clientX, data.clientY, data.width, data.height].every(Number.isFinite) ||
      data.width <= 0 || data.height <= 0) return true;
  // Trust only an actual, supported child frame; never take a media URL from a message.
  const frame = arrayFrom($$('iframe')).find(el => el.contentWindow === e.source);
  if (!frame || !embedUrl(frame.src) || new URL(frame.src).origin !== e.origin)
    return true;
  const r = frame.getBoundingClientRect();
  const clientX = r.left + clamp(data.clientX / data.width, 0, 1) * r.width;
  const clientY = r.top + clamp(data.clientY / data.height, 0, 1) * r.height;
  if (window !== top && hostname === 's9e.github.io' &&
      embedUrl(location.href) === embedUrl(frame.src)) {
    parent.postMessage(Object.assign({}, data, {
      clientX, clientY, width: innerWidth, height: innerHeight,
    }), '*');
    return true;
  }
  const event = {
    target: frame, clientX, clientY, button: data.button,
    shiftKey: !!data.shiftKey, ctrlKey: !!data.ctrlKey,
  };
  if (data.action === 'mouseover') {
    Events.setCtrl(event.ctrlKey);
    Events.onMouseOver(event);
  } else if (data.action === 'mousemove') {
    if (ai.node === frame) Events.onMouseMove(event);
  } else {
    if (Events.hoverData && Events.hoverData.node === frame)
      Events.onMouseOutThrottled.call(frame);
    if (ai.node === frame && !event.shiftKey &&
        (data.action === 'mousedown' || !ai.zoomed && App.canClose()))
      App.deactivate();
  }
  return true;
}

export function embedSource(text, doc, node, rule) {
  const url = rule && rule._postUrl || node && node.src || '';
  const code = (embedUrl(url).match(/\/p\/([\w-]+)/) || [])[1];
  const data = mediaData(text, doc, code);
  const video = videoSource(data);
  if (video) return video;
  const player = $many(['.EmbeddedMedia video', '.EmbedFrame video'], doc);
  const src = player && source(player) ||
    $prop('meta[property="og:video:secure_url"]', 'content', doc) ||
    $prop('meta[property="og:video"]', 'content', doc);
  if (/^https?:\/\//i.test(src || '')) return src;
  if (player || isVideoData(data))
    throw 'Instagram did not provide a playable video for this post.';
  const img = $('.EmbeddedMediaImage', doc);
  return img && source(img) || data && data.display_url || undefined;
}

export function preview(m, node, rule) {
  rule.follow = false;
  rule.q = null;
  rule._postUrl = null;
  rule._img = null;
  let media = node.matches('img, video') && node;
  const link = node.closest(links);
  if (!media && link)
    media = $many(['video', 'img'], link);
  // Instagram puts transparent siblings over media. Stay within the media's
  // bounds so hovering captions, comments, or neighboring posts does not activate it.
  if (!media && node.tagName === 'DIV') {
    const rect = node.getBoundingClientRect();
    const x = (rect.left + rect.right) / 2;
    const y = (rect.top + rect.bottom) / 2;
    for (let parent = node, i = 0; parent && i < 4; parent = parent.parentElement, i++) {
      media = [...$$('video', parent), ...$$('img', parent)].find(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 &&
          x >= r.left && x < r.right && y >= r.top && y < r.bottom;
      });
      if (media || parent.matches('article, main, [role="dialog"]')) break;
    }
  }
  rule._img = media;
  const src = media && source(media);
  // Reel covers and MediaSource players need the embed's actual video URL.
  if (isVideo(media) && !src || link && /\/reels?\//.test(link.pathname || link.href)) {
    const article = node.closest('article');
    const post = link || article && $(links, article);
    const path = (post ? post.href : location.href).match(/\/(?:p|tv|reels?)\/([\w-]+)/);
    if (path) {
      rule.q = embedSource;
      return (rule._postUrl = `https://www.instagram.com/p/${path[1]}/embed/captioned/`);
    }
  }
  if (src) return src;
  if (link) {
    rule.follow = true;
    return link.href;
  }
  return false;
}

export function source(media) {
  const valid = url => /^https?:\/\//i.test(url || '');
  if (isVideo(media)) {
    // MediaSource blob URLs cannot be played in a second video element.
    return [media.currentSrc, media.src, ...arrayFrom($$('source', media), el => el.src)]
      .find(url => valid(url) && Util.isVideoUrlExt(url));
  }
  const sources = (media.srcset || '').split(',').map(candidate => {
    const [url, size] = candidate.trim().split(/\s+/);
    return {url, size: parseFloat(size) || 1};
  }).filter(item => valid(item.url));
  sources.sort((a, b) => b.size - a.size);
  return sources.length ? sources[0].url :
    [media.currentSrc, media.src].find(valid);
}

export function best(versions) {
  return (isArray(versions) ? versions : [])
    .filter(item => item && /^https?:\/\//i.test(item.url))
    .reduce((best, item) => !best || item.width * item.height > best.width * best.height
      ? item : best, null);
}

const isVideoData = data => data && (data.is_video || data.media_type === 2 ||
  data.__typename === 'GraphVideo' || data.__typename === 'XDTGraphVideo');

const videoSource = data => data && (
  /^https?:\/\//i.test(data.video_url || '') && data.video_url ||
  (best(data.video_versions) || {}).url);

export function mediaData(text, doc, code) {
  if (!code) return;
  const roots = [tryJSON(text), ...arrayFrom($$('script[type="application/json"]', doc),
    el => tryJSON(el.textContent))];
  // Embed bootstrapping stores JSON inside a JSON string in executable scripts.
  // Decode only that value, without evaluating any page code.
  const rx = /"contextJSON"\s*:\s*("(?:\\.|[^"\\])*")/g;
  for (let match; (match = rx.exec(text || ''));)
    roots.push(tryJSON(tryJSON(match[1])));
  // JSON response envelopes change; identify the requested post rather than
  // accidentally picking a recommended post included in the same document.
  const queue = roots.filter(Boolean);
  for (let i = 0; i < queue.length && i < 10000; i++) {
    const value = queue[i];
    if (!value || typeof value !== 'object') continue;
    if ((value.shortcode === code || value.code === code) &&
        (value.display_url || value.video_url || value.video_versions || value.image_versions2 ||
         value.carousel_media || value.edge_sidecar_to_children)) {
      return value;
    }
    for (const child of Object.values(value))
      if (child && typeof child === 'object') queue.push(child);
  }
}

export function gallery(text, doc, url, m) {
  const media = mediaData(text, doc, m[2]);
  const children = media && (media.carousel_media ||
    pick(media, 'edge_sidecar_to_children.edges', edges => edges.map(e => e.node)) || [media]);
  const items = (children || []).filter(Boolean).map(item => ({
    url: videoSource(item) || !isVideoData(item) && (
      item.display_url || (best(pick(item, 'image_versions2.candidates')) || {}).url),
    desc: pick(item, 'caption.text') ||
      pick(item, 'edge_media_to_caption.edges.0.node.text') || '',
  })).filter(item => /^https?:\/\//i.test(item.url || ''));
  items.title = pick(media, 'caption.text') ||
    pick(media, 'edge_media_to_caption.edges.0.node.text') ||
    $prop('meta[property="og:description"]', 'content', doc) || '';
  if (!items.length) {
    if (isVideoData(media))
      throw 'Instagram did not provide a playable video for this post.';
    const el = $many([
      'meta[property="og:video:secure_url"]',
      'meta[property="og:video"]',
      'meta[property="og:image"]',
    ], doc);
    const src = el && el.content;
    if (/^https?:\/\//i.test(src || '')) items.push({url: src});
  }
  return items;
}
