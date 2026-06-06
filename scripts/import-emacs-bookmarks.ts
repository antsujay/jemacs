#!/usr/bin/env bun
/** One-shot: import ~/.emacs.d/bookmarks into ~/.jemacs/bookmarks.json */
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseEmacsBookmarkFile, defaultEmacsBookmarkFile } from "../plugins/bookmark/emacs-import"
import { bookmarkSave } from "../plugins/bookmark/store"
import { defcustom } from "../src/runtime/custom"

const source = process.argv[2] ?? defaultEmacsBookmarkFile()
const dest = process.argv[3] ?? join(homedir(), ".jemacs", "bookmarks.json")

defcustom("bookmark-file", "string", dest, "File where bookmarks are persisted.")

const text = await readFile(source, "utf8")
const table = parseEmacsBookmarkFile(text)
await bookmarkSave(table)
console.log(`Imported ${Object.keys(table).length} bookmark(s) from ${source} → ${dest}`)
