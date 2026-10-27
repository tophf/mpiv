export const hostname = location.hostname;
export const dotDomain = '.' + hostname;
export const isFF = CSS.supports('-moz-appearance', 'none');

/** used to detect JS code in host rules */
export const RX_HAS_CODE = /(^|[^-\w])return[\W\s]/;
export const RX_EVAL_BLOCKED = /'Trusted(Script| Type)'|unsafe-eval/;
export const RX_MEDIA_URL = /^(?!data:)[^?#]+?\.(avif|bmp|jpe?g?|gif|mp4|png|svgz?|web[mp])($|[?#])/i;
export const TT = window.trustedTypes;
