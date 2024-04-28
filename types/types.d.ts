/*
Definitions for some types used in MPIV.
Can be loaded into various IDE so you would see hints and info.
https://definitelytyped.org/directory/tools.html
 */

declare namespace mpiv {

  type Config = {
    center: boolean
    css: string
    delay: number
    fit:   'all' | 'large' | 'no' | ''
    globalStatus: boolean
    hosts: HostRule[]
    imgtab: boolean
    keepOnBlur: boolean
    keepVids: boolean
    mute: boolean
    night: boolean
    preload: boolean
    scale: number
    scales: (string | number)[]
    start: Start
    startAlt: Start
    startAltShown: boolean
    uiBackgroundColor: string
    uiBackgroundOpacity: number,
    uiBorderColor: string,
    uiBorderOpacity: number,
    uiBorder: number,
    uiFadein: boolean
    uiFadeinGallery: boolean
    uiInfo: boolean
    uiShadowColor: string,
    uiShadowOpacity: number,
    uiShadow: number,
    uiPadding: number,
    uiMargin: number,
    version: number
    videoCtrl: boolean // require Ctrl to preview a <video>
    waitLoad: boolean
    xhr: boolean
    zoom: 'context' | 'wheel' | 'shift' | 'auto'
    zoomOut: 'close' | 'stay' | 'auto'
    zoomStep: number
  };

  type HostRule = {
    /** URL match using plain text and AdBlock-compatible special symbols ||, |, ^ */
    u?: StringOrArrayOfStrings
    /**
     URL match using RegExp
     - when "html" is true, the node's HTML is matched instead of URL
     - when "u" is present, the "r" is checked only if "u" matched
    */
    r?: RegExp
    /** caption extractor: CSS selector or a function */
    c?: string | CaptionFunction
    /** CSS selector for the hovered element */
    e?: string | string[] | Object<string,string>
    /** gallery */
    g?: GalleryLoader | GalleryFunction
    /**
     remote element extractor: CSS selector
     - applied to the DOM of the document downloaded from URL (note, "s" rule can change the URL)
     - can be an array of selectors which will be checked in the specified order until matched (unlike CSS selector 'foo, bar' here you control the priority)
    */
    q?: StringOrArrayOfStrings | QuerySelectorFunction
    /**
     URL substitution
     - a string used in RegExp#replace like 'http://foo/bar$1/$2'
     - an array of such strings, used in order until one succeeds
       (failure means an HTTP error like "not found")
     - a function that returns a string or an array of such strings
    */
    s?: StringOrArrayOfStrings | SubstitutionFunction
    /** do GMxhr without setting/getting cookies */
    anonymous?: boolean
    /** whether the resultant URL should be processed again so another rule would match it */
    follow?: boolean | BooleanFunction
    /** POST method should be used to make HTTP request */
    post?: boolean | BooleanFunction
    /** CSS selector for an element used to calculate the bounds of the hoverable area */
    rect?: string
    /** CSS to be added to the page */
    css?: string
    /** match in outerHTML string */
    html?: boolean
    /** shows the popup only when user activates it explicitly e.g. via a key */
    manual?: boolean
    /** Firefox-only fix needed with some obstinate hostings when opening image in a tab via "T" key */
    tabfix?: boolean
    /** spoof anti-hotlinking protection */
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
    blobUrl: string
    /** buffering bar shown */
    bufBar: boolean
    /** buffering start time, ms */
    bufStart: number
    caption: string
    /** video controls are shown */
    controlled: boolean
    /** clientX of the last mouse event */
    cx: number
    /** clientY of the last mouse event */
    cy: number
    extras: {
      /** padding + border for left and right edges */
      inw: number,
      /** padding + border for top and bottom edges */
      inh: number,
      /** margin + outline for left and right edges */
      outw: number,
      /** margin + outline for top and bottom edges */
      outh: number,
      /** padding + margin + border + outlines for left and right edges */
      w: number,
      /** padding + margin + border + outlines for top and bottom edges */
      h: number,
      /** outline offset + thickness */
      o: number,
    }
    flipX: boolean
    flipY: boolean
    force: boolean
    gIndex: number
    gItems: GalleryItemsArray
    gNum: number
    imageUrl: StringOrArrayOfStrings
    large: boolean
    /** naturalHeight */
    nheight: number
    night: boolean
    /** naturalWidth */
    nwidth: number
    popup: HTMLImageElement | HTMLVideoElement
    popover?: HTMLElement
    /** true when 'load' event fired on the element */
    popupLoaded: boolean
    /** time, ms */
    preloadStart: number
    /** used by gallery to preload the next image */
    preloadUrl: string
    rect: DOMRect
    /** is mouse still over PopupInfo.rect */
    rectHovered: boolean
    req: { abort: VoidFunction }
    rotate: number
    scale: number
    scales: number[]
    /** scale fit-to-window factor */
    scaleFit: number
    /** scale factor to use when zoom is enabled */
    scaleZoom: number
    shiftKeyTime: number
    timer: number
    timerBar: number
    timerProgress: number
    timerStatus: number
    tooltip: { node: Node, text: string }
    view: { w: number, h: number }
    zoomed: boolean
    zooming: boolean
  };

  type GalleryItem = {
    url: StringOrArrayOfStrings
    desc?: string
  }

  type GalleryItemsArray = GalleryItem[] & {
    /** e.g. let g=[GalleryItem, GalleryItem]; g.title='foo' */
    title?: string
    index?: IndexFunction | string | number
  }

  type GalleryLoader = {
    /** CSS selector: entry (required to extract captions) */
    entry?: string
    /** CSS selector: image (relative to the entry element if "entry" is specified) */
    image?: string
    /** CSS selector: caption (relative to the entry element) */
    caption?: StringOrArrayOfStrings
    /** CSS selector: title of the gallery */
    title?: string
    /** function to transform URLs/captions/title */
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
      doc: Document,
      url: string,
      m: string[],
      rule: HostRule,
      node: Node,
      cb: { (items: GalleryItemsArray): void },
    ): GalleryItemsArray
  }

  type IndexFunction = {
    (
      items: GalleryItemsArray,
      node: Node,
    ): string
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

  enum StartEnum {
    auto,
    /** historical name for Context menu + Ctrl */
    context,
    /** context menu invoked via Mouse or Keyboard */
    contextMK
    /** context menu invoked via Mouse */,
    contextM,
    /** context menu invoked via Keyboard */
    contextK,
    ctrl,
  }
  type Start = keyof typeof StartEnum
}
