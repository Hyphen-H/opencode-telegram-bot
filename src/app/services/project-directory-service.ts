import { promises as fs } from "node:fs";
import path from "node:path";
import { getHomeDirectory, isWithinAllowedRoot } from "./file-browser-service.js";
import { t } from "../../i18n/index.js";

export function resolveProjectDirectoryInput(
  input: string,
  base: string,
  folderOnly = false,
): string {
  const value = input.trim();
  if (
    !value ||
    /[\x00-\x1f\x7f]/.test(value) ||
    (folderOnly &&
      (value === "." || value === ".." || /[\\/]/.test(value) || path.isAbsolute(value)))
  ) {
    throw new Error(t("open.invalid_path"));
  }
  const expanded = folderOnly
    ? value
    : value === "~"
      ? getHomeDirectory()
      : /^~[/\\]/.test(value)
        ? path.join(getHomeDirectory(), value.slice(2))
        : value;
  const target = path.resolve(base, expanded);
  if (!isWithinAllowedRoot(target)) throw new Error(t("open.access_denied"));
  return target;
}

/** Check the closest existing ancestor too: missing children under escaping symlinks are unsafe. */
export async function inspectProjectDirectory(target: string): Promise<"exists" | "missing"> {
  if (!isWithinAllowedRoot(target)) throw new Error(t("open.access_denied"));
  let ancestor = target;
  while (true) {
    try {
      const canonical = await fs.realpath(ancestor);
      if (!isWithinAllowedRoot(canonical)) throw new Error(t("open.access_denied"));
      if (!(await fs.stat(canonical)).isDirectory()) throw new Error(t("open.invalid_path"));
      return ancestor === target ? "exists" : "missing";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

export async function createProjectDirectory(target: string): Promise<void> {
  await inspectProjectDirectory(target);
  await fs.mkdir(target, { recursive: true });
  await inspectProjectDirectory(target);
}
