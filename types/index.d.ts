export type Commit = {
  hash: string
  parents: string[]
  refs: string[]
  short: string
  author: string
  date: string
  subject: string
  files: FileChange[]
}

export type GraphData = { raw: string; commits: Commit[]; error?: string }

export type FileChange = { path: string; status: string }

export type Detail = {
  hash: string
  files: FileChange[]
  path?: string
}

export type DiffTab = { hash: string; path: string; diff?: string }

declare module 'claude-code' {
  interface PluginState {
    'git-graph': { data: Shaped<GraphData>; detail: Shaped<Detail | null>; tabs: Shaped<Record<string, DiffTab>> }
  }
}
