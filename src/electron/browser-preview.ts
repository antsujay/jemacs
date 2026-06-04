import sample from "./fixtures/sample-display.json"
import { presentDomFrame } from "../display/dom-frame"
import type { SerializedDisplayModel } from "../display/serialize"

const titleEl = document.getElementById("jemacs-title")!
const windowsEl = document.getElementById("jemacs-windows")!
const minibufferEl = document.getElementById("jemacs-minibuffer")!
const echoEl = document.getElementById("jemacs-echo")!

presentDomFrame(
  { title: titleEl, windows: windowsEl, minibuffer: minibufferEl, echo: echoEl },
  sample as SerializedDisplayModel,
  (windowId, row, col) => {
    console.log("mouse", windowId, row, col)
  },
)
