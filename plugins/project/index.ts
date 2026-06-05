import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import type { Editor } from "../../src/kernel/editor"
import { spawnProcess } from "../../src/platform/runtime"
import { defcustom, getCustom } from "../../src/runtime/custom"

export async function projectRoot(dir: string): Promise<string | null> {
  let current = resolve(dir)
  for (;;) {
    if (await access(join(current, ".git")).then(() => true, () => false)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export async function projectFiles(root: string): Promise<string[]> {
  const proc = spawnProcess({ cmd: ["git", "ls-files", "-z"], cwd: root, stdout: "pipe", stderr: "pipe" })
  const out = proc.stdout ? await new Response(proc.stdout).text() : ""
  await proc.exited
  return out.split("\0").filter(Boolean)
}

function projectListFile(): string {
  return getCustom<string>("project-list-file") ?? join(homedir(), ".jemacs", "projects.json")
}

export async function readProjectList(): Promise<string[]> {
  const text = await readFile(projectListFile(), "utf8").catch(() => null)
  if (!text) return []
  try {
    const data = JSON.parse(text) as unknown
    return Array.isArray(data) ? data.map(String) : []
  } catch {
    return []
  }
}

export async function writeProjectList(roots: string[]): Promise<void> {
  const file = projectListFile()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(roots, null, 2), "utf8")
}

export async function rememberProject(root: string): Promise<void> {
  const list = await readProjectList()
  const i = list.indexOf(root)
  if (i === 0) return
  if (i > 0) list.splice(i, 1)
  list.unshift(root)
  await writeProjectList(list)
}

async function projectCurrent(editor: Editor, override?: string): Promise<string | null> {
  const start = override ?? editor.currentBuffer.directory() ?? process.cwd()
  const root = await projectRoot(start)
  if (!root) editor.message(`No project found for ${start}`)
  return root
}

export function install(editor: Editor): void {
  defcustom("project-list-file", "string", join(homedir(), ".jemacs", "projects.json"),
    "File where the list of known project roots is persisted.")
  defcustom("compile-command", "string", "make -k ",
    "Default shell command for project-compile.")

  editor.command("project-root", async ({ editor, args }) => {
    const root = await projectCurrent(editor, args[0])
    if (root) editor.message(root)
    return root
  }, "Echo the root directory of the current project.")

  editor.command("project-find-file", async ({ editor, args }) => {
    const root = await projectCurrent(editor, args[0])
    if (!root) return
    await rememberProject(root)
    const files = await projectFiles(root)
    if (!files.length) {
      editor.message(`No tracked files in ${root}`)
      return
    }
    const choice = await editor.completingRead("Find file in project: ", {
      collection: files,
      history: "project-file",
    })
    if (!choice) return
    await editor.openFile(join(root, choice))
  }, "Visit a file in the current project, with completion over git ls-files.")

  editor.command("project-switch-project", async ({ editor }) => {
    const roots = await readProjectList()
    if (!roots.length) {
      editor.message("No known projects")
      return
    }
    const root = await editor.completingRead("Switch to project: ", {
      collection: roots,
      history: "project",
    })
    if (!root) return
    await editor.run("project-find-file", [root])
  }, "Switch to a known project root and find a file in it.")

  editor.command("project-compile", async ({ editor, args }) => {
    const root = await projectCurrent(editor)
    if (!root) return
    const cmd = args[0] ?? await editor.prompt(
      "Compile command: ",
      getCustom<string>("compile-command") ?? "make -k ",
      "compile",
    )
    if (!cmd) return
    const proc = spawnProcess({ cmd: ["sh", "-c", cmd], cwd: root, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    ])
    const exit = await proc.exited
    const status = exit === 0 ? "finished" : `exited abnormally with code ${exit}`
    const body = [
      `-*- mode: compilation; default-directory: "${root}" -*-`,
      `Compilation started`,
      "",
      cmd,
      stdout + stderr,
      `Compilation ${status}`,
      "",
    ].join("\n")
    editor.scratch("*compilation*", body, "text").kind = "grep"
    editor.message(`Compilation ${status}`)
  }, "Run a shell command in the project root and show its output in *compilation*.")

  editor.key("C-x p f", "project-find-file")
  editor.key("C-x C-z", "project-find-file")
  editor.key("C-x p p", "project-switch-project")
  editor.key("C-x p c", "project-compile")
}
