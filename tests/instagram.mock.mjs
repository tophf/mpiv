import {ai} from '../src/app.js';

export * as App from '../src/app.js';
export * as Instagram from '../src/instagram.js';
export * as Ruler from '../src/ruler.js';
export * as RuleMatcher from '../src/rule-matcher.js';

export {setCfg} from '../src/app.js';
export {setNonce} from '../src/csp.js';

export function setAi(val) {
  for (const k of Object.keys(val)) if (!ai.hasOwnProperty(k)) delete ai[k];
  return Object.assign(ai, val);
}
