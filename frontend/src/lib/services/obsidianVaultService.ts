import Dexie from "dexie"
import type { Table } from "dexie"
import YAML from "yaml"
import { setNoteObsidianExportMeta } from "../db/repository"
import { computeNoteHash, splitNoteFrontmatter, updateFrontmatterTitle } from "../notes/markdown"
import type {
  Note,
  ObsidianNoteExportResult,
  ObsidianVaultStatus
} from "../types"

type StoredVaultRecord = {
  id: "default"
  vault_id: string
  vault_name: string
  handle: FileSystemDirectoryHandle
  created_at: number
  updated_at: number
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite"
  }) => Promise<FileSystemDirectoryHandle>
}

class ObsidianVaultDB extends Dexie {
  vaults!: Table<StoredVaultRecord, "default">

  constructor() {
    super("ObsidianVaultDB")
    this.version(1).stores({
      vaults: "id, vault_id, updated_at, created_at"
    })
  }
}

const vaultDb = new ObsidianVaultDB()

function unsupportedError(): Error {
  return new Error("OBSIDIAN_VAULT_UNSUPPORTED")
}

async function buildVaultId(vaultName: string): Promise<string> {
  return `vault_${(await computeNoteHash(`directory:${vaultName}`)).slice(0, 16)}`
}

function sanitizeFileSegment(input: string): string {
  const normalized = input
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim()

  return normalized || "Untitled"
}

function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => Boolean(segment) && segment !== ".")
    .join("/")
}

function ensureMarkdownFilename(fileName: string): string {
  return fileName.toLowerCase().endsWith(".md") ? fileName : `${fileName}.md`
}

function buildExportMarkdown(note: Note): string {
  const normalizedTitle = note.title.trim()
  if (!normalizedTitle) {
    return note.content
  }

  if (splitNoteFrontmatter(note.content).hasFrontmatter) {
    return updateFrontmatterTitle(note.content, normalizedTitle)
  }

  const serialized = YAML.stringify(
    { title: normalizedTitle },
    {
      lineWidth: 0,
      minContentWidth: 0
    }
  ).trimEnd()

  const body = note.content ? `\n${note.content}` : "\n"
  return `---\n${serialized}\n---${body}`
}

async function queryVaultPermission(
  handle: FileSystemDirectoryHandle
): Promise<PermissionState | null> {
  try {
    return await handle.queryPermission({ mode: "readwrite" })
  } catch {
    return null
  }
}

async function requestVaultPermission(
  handle: FileSystemDirectoryHandle
): Promise<PermissionState | null> {
  try {
    return await handle.requestPermission({ mode: "readwrite" })
  } catch {
    return null
  }
}

async function getStoredVaultRecord(): Promise<StoredVaultRecord | undefined> {
  return vaultDb.vaults.get("default")
}

async function getDirectoryHandlePicker(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) {
    throw unsupportedError()
  }

  return picker({ mode: "readwrite" })
}

async function ensureConnectedVaultRecord(): Promise<StoredVaultRecord> {
  const record = await getStoredVaultRecord()
  if (!record) {
    throw new Error("OBSIDIAN_VAULT_NOT_CONNECTED")
  }

  const permission = await queryVaultPermission(record.handle)
  if (permission !== "granted") {
    throw new Error("OBSIDIAN_VAULT_RECONNECT_REQUIRED")
  }

  return record
}

async function pathExists(
  root: FileSystemDirectoryHandle,
  relativePath: string
): Promise<boolean> {
  const normalized = normalizeRelativePath(relativePath)
  const segments = normalized.split("/").filter(Boolean)
  if (segments.length === 0) {
    return false
  }

  let directory = root
  for (const segment of segments.slice(0, -1)) {
    try {
      directory = await directory.getDirectoryHandle(segment)
    } catch {
      return false
    }
  }

  try {
    await directory.getFileHandle(segments[segments.length - 1]!)
    return true
  } catch {
    return false
  }
}

async function ensureDirectoryPath(
  root: FileSystemDirectoryHandle,
  segments: string[]
): Promise<FileSystemDirectoryHandle> {
  let current = root
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true })
  }
  return current
}

async function writeRelativeFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  content: string
): Promise<void> {
  const normalized = normalizeRelativePath(relativePath)
  const segments = normalized.split("/").filter(Boolean)
  if (segments.length === 0) {
    throw new Error("OBSIDIAN_EXPORT_PATH_INVALID")
  }

  const directory = await ensureDirectoryPath(root, segments.slice(0, -1))
  const fileHandle = await directory.getFileHandle(segments[segments.length - 1]!, {
    create: true
  })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(content)
  } finally {
    await writable.close()
  }
}

function resolveImportedRelativePath(
  note: Note,
  vault: StoredVaultRecord
): string | null {
  if (note.source_type !== "obsidian") {
    return null
  }

  const sourceRelativePath =
    note.import_meta?.relative_path ?? note.source_path ?? null
  if (!sourceRelativePath) {
    return null
  }

  const sameVaultId = note.import_meta?.vault_id === vault.vault_id
  const sameVaultName = note.import_meta?.vault_name === vault.vault_name
  if (!sameVaultId && !sameVaultName) {
    return null
  }

  return normalizeRelativePath(sourceRelativePath)
}

async function resolveLocalRelativePath(
  note: Note,
  vault: StoredVaultRecord
): Promise<string> {
  const baseName = sanitizeFileSegment(note.title)
  const normalizedBaseName = ensureMarkdownFilename(baseName)
  const preferredPath = normalizeRelativePath(`Vesti/${normalizedBaseName}`)

  if (!(await pathExists(vault.handle, preferredPath))) {
    return preferredPath
  }

  const stem = normalizedBaseName.replace(/\.md$/i, "")
  let suffix = 2
  while (suffix < 10_000) {
    const candidate = normalizeRelativePath(`Vesti/${stem} ${suffix}.md`)
    if (!(await pathExists(vault.handle, candidate))) {
      return candidate
    }
    suffix += 1
  }

  throw new Error("OBSIDIAN_EXPORT_PATH_RESOLUTION_FAILED")
}

async function resolveExportRelativePath(
  note: Note,
  vault: StoredVaultRecord
): Promise<string> {
  const mappedPath =
    note.obsidian_export?.vault_id === vault.vault_id
      ? normalizeRelativePath(note.obsidian_export.relative_path)
      : ""
  if (mappedPath) {
    return mappedPath
  }

  const importedPath = resolveImportedRelativePath(note, vault)
  if (importedPath) {
    return importedPath
  }

  return resolveLocalRelativePath(note, vault)
}

export async function getObsidianVaultStatus(): Promise<ObsidianVaultStatus> {
  const record = await getStoredVaultRecord()
  if (!record) {
    return {
      state: "not_connected",
      vault_id: null,
      vault_name: null
    }
  }

  const permission = await queryVaultPermission(record.handle)
  return {
    state: permission === "granted" ? "connected" : "needs_reconnect",
    vault_id: record.vault_id,
    vault_name: record.vault_name
  }
}

export async function connectObsidianVault(): Promise<ObsidianVaultStatus> {
  const handle = await getDirectoryHandlePicker()
  const permission = await requestVaultPermission(handle)
  if (permission !== "granted") {
    throw new Error("OBSIDIAN_VAULT_PERMISSION_DENIED")
  }

  const now = Date.now()
  const record: StoredVaultRecord = {
    id: "default",
    vault_id: await buildVaultId(handle.name),
    vault_name: handle.name,
    handle,
    created_at: now,
    updated_at: now
  }

  await vaultDb.vaults.put(record)

  return {
    state: "connected",
    vault_id: record.vault_id,
    vault_name: record.vault_name
  }
}

async function resolveTitleRelativePath(
  title: string,
  vault: StoredVaultRecord
): Promise<string> {
  const baseName = ensureMarkdownFilename(sanitizeFileSegment(title || "VESTI export"))
  const preferred = normalizeRelativePath(`Vesti/${baseName}`)
  if (!(await pathExists(vault.handle, preferred))) return preferred

  const stem = baseName.replace(/\.md$/i, "")
  let suffix = 2
  while (suffix < 10_000) {
    const candidate = normalizeRelativePath(`Vesti/${stem} ${suffix}.md`)
    if (!(await pathExists(vault.handle, candidate))) return candidate
    suffix += 1
  }
  throw new Error("OBSIDIAN_EXPORT_PATH_RESOLUTION_FAILED")
}

/**
 * Write arbitrary Markdown (a conversation or its summary) to the vault under
 * Vesti/, with optional YAML frontmatter. Runs in-page (File System Access needs
 * a user gesture + visible document).
 */
export async function writeMarkdownToVault(input: {
  title: string
  frontmatter?: Record<string, string | number | string[]>
  body: string
}): Promise<{ relative_path: string; vault_name: string; exported_at: number }> {
  const vault = await ensureConnectedVaultRecord()
  const relativePath = await resolveTitleRelativePath(input.title, vault)
  const fm =
    input.frontmatter && Object.keys(input.frontmatter).length > 0
      ? `---\n${YAML.stringify(input.frontmatter)}---\n\n`
      : ""
  await writeRelativeFile(vault.handle, relativePath, fm + input.body)
  return {
    relative_path: relativePath,
    vault_name: vault.vault_name,
    exported_at: Date.now()
  }
}

export async function exportNoteToObsidian(
  note: Note
): Promise<ObsidianNoteExportResult> {
  const vault = await ensureConnectedVaultRecord()
  const relativePath = await resolveExportRelativePath(note, vault)
  const content = buildExportMarkdown(note)

  await writeRelativeFile(vault.handle, relativePath, content)

  const exportedAt = Date.now()
  const updatedNote = await setNoteObsidianExportMeta(note.id, {
    vault_id: vault.vault_id,
    relative_path: relativePath,
    last_exported_at: exportedAt
  })

  return {
    note: updatedNote,
    vault_id: vault.vault_id,
    vault_name: vault.vault_name,
    relative_path: relativePath,
    exported_at: exportedAt
  }
}
