export type WindowId = string

export type WindowLeaf = {
  kind: "leaf"
  id: WindowId
  bufferId: string
  point: number
  startLine: number
  dedicated: boolean
}

export type WindowSplit = {
  kind: "split"
  direction: "horizontal" | "vertical"
  first: WindowNode
  second: WindowNode
}

export type WindowNode = WindowLeaf | WindowSplit

export function createLeafWindow(bufferId: string, point = 0, id = crypto.randomUUID(), startLine = 0): WindowLeaf {
  return { kind: "leaf", id, bufferId, point, startLine, dedicated: false }
}

export function cloneWindowNode(node: WindowNode): WindowNode {
  if (node.kind === "leaf") return { ...node }
  return {
    kind: "split",
    direction: node.direction,
    first: cloneWindowNode(node.first),
    second: cloneWindowNode(node.second),
  }
}

export function findWindowShowingBuffer(node: WindowNode, bufferId: string, excludeId?: WindowId): WindowLeaf | null {
  for (const leaf of listWindowLeaves(node)) {
    if (leaf.bufferId === bufferId && leaf.id !== excludeId) return leaf
  }
  return null
}

export function pickReusableWindow(node: WindowNode, selectedId: WindowId): WindowLeaf | null {
  return listWindowLeaves(node).find(leaf => leaf.id !== selectedId && !leaf.dedicated) ?? null
}

export function listWindowLeaves(node: WindowNode): WindowLeaf[] {
  if (node.kind === "leaf") return [node]
  return [...listWindowLeaves(node.first), ...listWindowLeaves(node.second)]
}

export function findWindowLeaf(node: WindowNode, id: WindowId): WindowLeaf | null {
  if (node.kind === "leaf") return node.id === id ? node : null
  return findWindowLeaf(node.first, id) ?? findWindowLeaf(node.second, id)
}

export function mapWindowLeaves(node: WindowNode, fn: (leaf: WindowLeaf) => WindowLeaf): WindowNode {
  if (node.kind === "leaf") return fn(node)
  return {
    kind: "split",
    direction: node.direction,
    first: mapWindowLeaves(node.first, fn),
    second: mapWindowLeaves(node.second, fn),
  }
}

export function splitWindowLeaf(
  node: WindowNode,
  id: WindowId,
  direction: WindowSplit["direction"],
  bufferId: string,
  point: number,
): { layout: WindowNode; newWindowId: WindowId } {
  if (node.kind === "leaf") {
    if (node.id !== id) throw new Error(`No such window: ${id}`)
    const newLeaf = createLeafWindow(bufferId, point)
    return {
      layout: { kind: "split", direction, first: node, second: newLeaf },
      newWindowId: newLeaf.id,
    }
  }
  if (findWindowLeaf(node.first, id)) {
    const result = splitWindowLeaf(node.first, id, direction, bufferId, point)
    return {
      layout: { kind: "split", direction: node.direction, first: result.layout, second: node.second },
      newWindowId: result.newWindowId,
    }
  }
  const result = splitWindowLeaf(node.second, id, direction, bufferId, point)
  return {
    layout: { kind: "split", direction: node.direction, first: node.first, second: result.layout },
    newWindowId: result.newWindowId,
  }
}

export function deleteWindowLeaf(node: WindowNode, id: WindowId): WindowNode | null {
  if (node.kind === "leaf") return node.id === id ? null : node
  const first = deleteWindowLeaf(node.first, id)
  const second = deleteWindowLeaf(node.second, id)
  if (first == null) return second
  if (second == null) return first
  return { kind: "split", direction: node.direction, first, second }
}

export function deleteOtherWindowLeaves(node: WindowNode, id: WindowId): WindowNode {
  const keep = findWindowLeaf(node, id)
  if (!keep) throw new Error(`No such window: ${id}`)
  return keep
}

export function nextWindowId(node: WindowNode, currentId: WindowId, delta = 1): WindowId {
  const leaves = listWindowLeaves(node)
  if (!leaves.length) throw new Error("No windows")
  const index = leaves.findIndex(leaf => leaf.id === currentId)
  const currentIndex = index === -1 ? 0 : index
  return leaves[(currentIndex + delta + leaves.length) % leaves.length]!.id
}

export function setWindowLeafBuffer(node: WindowNode, id: WindowId, bufferId: string, point: number): WindowNode {
  return mapWindowLeaves(node, leaf => leaf.id === id ? { ...leaf, bufferId, point } : leaf)
}

export function setWindowLeafPoint(node: WindowNode, id: WindowId, point: number): WindowNode {
  return mapWindowLeaves(node, leaf => leaf.id === id ? { ...leaf, point } : leaf)
}

export function setWindowLeafStartLine(node: WindowNode, id: WindowId, startLine: number): WindowNode {
  return mapWindowLeaves(node, leaf => leaf.id === id ? { ...leaf, startLine } : leaf)
}

export function setWindowLeafDedicated(node: WindowNode, id: WindowId, dedicated: boolean): WindowNode {
  return mapWindowLeaves(node, leaf => leaf.id === id ? { ...leaf, dedicated } : leaf)
}

export function scrollWindowLeaf(node: WindowNode, id: WindowId, lineDelta: number, maxStartLine: number): WindowNode {
  return mapWindowLeaves(node, leaf => {
    if (leaf.id !== id) return leaf
    return { ...leaf, startLine: Math.max(0, Math.min(maxStartLine, leaf.startLine + lineDelta)) }
  })
}

export function removeBufferFromWindows(node: WindowNode, bufferId: string, fallbackBufferId: string): WindowNode {
  return mapWindowLeaves(node, leaf => leaf.bufferId === bufferId
    ? { ...leaf, bufferId: fallbackBufferId, point: 0 }
    : leaf)
}
