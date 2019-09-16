/*
Definitions for some types used in MPIV.
Can be loaded into various IDE so you would see hints and info.
https://definitelytyped.org/directory/tools.html
 */

declare namespace mpiv {

  type Config = {
    center: boolean
    close: boolean
    css: string
    delay: number
    exposeStatus: boolean
    hosts: HostRule[]
    imgtab: boolean
    preload: boolean
    scale: number
    scales: (string | number)[]
    start: 'auto' | 'context' | 'ctrl'
    version: number
    xhr: boolean
    zoom: 'context' | 'wheel' | 'shift' | 'auto'
  };

  type HostRule = {
    // URL match using plain text and AdBlock-compatible special symbols ||, |, ^
    u?: StringOrArrayOfStrings
    /*
     URL match using RegExp
     - when "html" is true, the node's HTML is matched instead of URL
     - when "u" is present, the "r" is checked only if "u" matched
    */
    r?: RegExp
    // caption extractor: CSS selector or a function
    c?: string | CaptionFunction
    // element match: CSS selector
    e?: string
    // gallery
    g?: GalleryLoader | GalleryFunction
    /*
     remote element extractor: CSS selector
     - applied to the DOM of the document downloaded from URL (note, "s" rule can change the URL)
     - can be an array of selectors which will be checked in the specified order until matched (unlike CSS selector 'foo, bar' here you control the priority)
    */
    q?: StringOrArrayOfStrings | QuerySelectorFunction
    /*
     URL substitution
     - a string used in RegExp#replace like 'http://foo/bar$1/$2'
     - an array of such strings, used in order until one succeeds
       (failure means an HTTP error like "not found")
     - a function that returns a string or an array of such strings
    */
    s?: StringOrArrayOfStrings | SubstitutionFunction
    // whether the resultant URL should be processed again so another rule would match it
    follow?: boolean | BooleanFunction
    // POST method should be used to make HTTP request
    post?: boolean | BooleanFunction
    // CSS to be added to the page
    css?: string
    // for generic rules: the result should be more than cfg.scale bigger than the original
    distinct?: boolean
    // shows the popup only when user activates it explicitly e.g. via a key
    manual?: boolean
    // Firefox-only fix needed with some obstinate hostings when opening image in a tab via "T" key
    tabfix?: boolean
    // spoof anti-hotlinking protection
    xhr?: boolean
  }

  type AppInfo = RuleMatchInfo & PopupInfo

  type RuleMatchInfo = {
    gallery?: GalleryFunction
    match: string[]
    node: HTMLElement
    post: boolean
    rule: HostRule
    url: string
    urls?: string[]
    xhr: boolean | 'data'
  }

  type PopupInfo = {
    bar: Element
    bufferingBar: boolean
    bufferingStart: number
    caption: string
    // video controls are shown
    controlled: boolean
    // is mouse still over PopupInfo.rect
    isOverRect: boolean
    clientX: number
    clientY: number
    gIndex: number
    gItems: GalleryItemsArray
    imageUrl: StringOrArrayOfStrings
    large: boolean
    lazyUnload: boolean
    // margin+border height
    mbh: number
    // margin+border width
    mbw: number
    // naturalHeight
    nheight: number
    // naturalWidth
    nwidth: number
    // outline thickness
    outline: number
    // padding height
    ph: number
    // padding width
    pw: number
    popup: HTMLImageElement | HTMLVideoElement
    // true when 'load' event fired on the element
    popupLoaded: boolean
    // time, ms
    preloadStart: number
    // used by gallery to preload the next image
    preloadUrl: string
    rect: DOMRect
    req: { abort: VoidFunction }
    scale: number
    scales: number[]
    timeout: number
    title: string
    tooltip: { node: Node, text: string }
    view: { width: number, height: number }
    zoom: boolean
    zoomed: boolean
    zooming: boolean
    zscale: number
  };

  type GalleryItem = {
    url: StringOrArrayOfStrings
    desc?: string
  }

  type GalleryItemsArray = GalleryItem[] & {
    // e.g. arr=[GalleryItem, GalleryItem] arr.title='foo'
    title?: string
  }

  type GalleryLoader = {
    // CSS selector: entry (required to extract captions)
    entry?: string
    // CSS selector: image (relative to the entry element if "entry" is specified)
    image?: string
    // CSS selector: caption (relative to the entry element)
    caption?: StringOrArrayOfStrings
    // CSS selector: title of the gallery
    title?: string
    // function to transform URLs/captions/title
    fix?: { (s: string, isURL: boolean): string }
  }

  type BooleanFunction = { (): boolean }

  type CaptionFunction = {
    (
      text: string,
      doc: Document,
      node: Node,
      rule: HostRule,
    ): string
  }

  type GalleryFunction = {
    (
      text: string,
      url: string,
      m: string[],
      rule: HostRule,
      cb: { (items: GalleryItemsArray): void },
    ): GalleryItemsArray
  }

  type QuerySelectorFunction = {
    (
      text: string,
      doc: Document,
      node: Node,
      rule: HostRule,
    ): StringOrArrayOfStrings
  }

  type SubstitutionFunction = {
    (
      m: string[],
      node: Node,
      rule: HostRule,
    ): StringOrArrayOfStrings
  }

  type StringOrArrayOfStrings = string | string[]

  type VoidFunction = { (): void }

}
