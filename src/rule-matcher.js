import {Util} from './util.js';
import {Ruler} from './rules.js';
import {state} from './state.js';
import {RX_MEDIA_URL} from './constants.js';
import {Gallery} from './gallery.js';
import {isFunction} from './helpers.js';

const RuleMatcher = {

  /** @returns {Object} */
  adaptiveFind(node, opts) {
    const tn = node.tagName;
    const src = node.currentSrc || node.src || '';
    const isPic = tn === 'IMG' || tn === 'VIDEO' && Util.isVideoUrlExt(src);
    let a, info, url;
    // note that data URLs aren't passed to rules as those may have fatally ineffective regexps
    if (tn !== 'A') {
      url = isPic && !src.startsWith('data:') && Util.rel2abs(src);
      info = RuleMatcher.find(url, node, opts);
    }
    if (!info && (a = node.closest('A'))) {
      const ds = a.dataset;
      url = ds.expandedUrl || ds.fullUrl || ds.url || a.href || '';
      url = url.includes('//t.co/') ? 'https://' + a.textContent : url;
      url = !url.startsWith('data:') && url;
      info = RuleMatcher.find(url, a, opts);
    }
    if (!info && isPic)
      info = {node, rule: {}, url: src};
    return info;
  },

  /** @returns ?mpiv.RuleMatchInfo */
  find(url, node, {noHtml, rules, skipRules} = {}) {
    let tn, isPic, html, h;
    for (const rule of rules || Ruler.rules) {
      let e, m;
      if (skipRules && skipRules.includes(rule) ||
          rule.u && (!url || !Ruler.runU(rule, url)) ||
          !rules && (e = rule.e) &&
            !(m = typeof e === 'string' ? node.matches(e) : Ruler.runE(rule, e, node)))
        continue;
      if (m && m.url)
        return m;
      const {r, s} = rule;
      let hasS = s != null;
      h = !(noHtml && rule === state.ai.rule) && (r || hasS) && rule.html &&
        (html || (html = node.outerHTML));
      if (r) {
        m = h ? r.exec(h) : url && r.exec(url);
      } else {
        m = [''];
        m[0] = m.input = h || url || rule.g && location.href || '';
        m.index = 0;
      }
      if (!m)
        continue;
      if (s === '')
        return {};
      // a rule with follow:true for the currently hovered IMG produced a URL,
      // but we'll only allow it to match rules without 's' in the nested find call
      if (!hasS && !skipRules && (tn ? isPic : isPic = (tn = node.tagName) === 'IMG' || tn === 'VIDEO'))
        continue;
      hasS &= s !== 'gallery';
      const urls = hasS ? Ruler.runS(node, rule, m) : [m.input];
      if (urls)
        return RuleMatcher.makeInfo(hasS, rule, m, node, skipRules, urls);
    }
  },

  /** @returns ?mpiv.RuleMatchInfo */
  makeInfo(hasS, rule, match, node, skipRules, urls) {
    let info;
    let url = `${urls[0]}`;
    const follow = url && hasS && !rule.q && RuleMatcher.isFollowableUrl(url, rule);
    if (url)
      url = Util.rel2abs(url);
    else
      info = {};
    if (follow)
      info = RuleMatcher.find(url, node, {skipRules: [...skipRules || [], rule]});
    if (!info && (!follow || RX_MEDIA_URL.test(url))) {
      const xhr = state.cfg.xhr && rule.xhr;
      info = {
        match,
        node,
        rule,
        url,
        urls: urls.length > 1 ? urls.slice(1) : null,
        gallery: rule.g && Gallery.makeParser(rule.g),
        post: isFunction(rule.post) ? rule.post(match) : rule.post,
        xhr: xhr != null ? xhr : isSecureContext && !url.startsWith(location.protocol),
      };
    }
    return info;
  },

  isFollowableUrl(url, rule) {
    const f = rule.follow;
    return isFunction(f) ? f(url) : f;
  },
};

export {
  RuleMatcher,
};
