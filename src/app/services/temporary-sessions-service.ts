import type { GlobalSession } from "@opencode-ai/sdk/v2";
import { lstat, mkdir, readlink, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { opencodeClient, opencodeServerVersion, opencodeV2Client } from "../../opencode/client.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { isContainerRuntime } from "../../runtime/container.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import type { ProjectInfo } from "../types/project.js";

export const TEMPORARY_PROJECT_ID = "temporary-sessions";

export function getTemporarySessionsDirectory(): string {
  return path.join(getRuntimePaths().appHome, "temporary-sessions");
}

export function isTemporarySessionDirectory(directory: string): boolean {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const root = path.join(configHome, "openchamber", "chats");
  const relative = path.relative(root, directory);
  return /^\d{4}-\d{2}-\d{2}[/\\]session-[a-zA-Z0-9-]+$/.test(relative);
}

export function getTemporaryProject(): ProjectInfo {
  return {
    id: TEMPORARY_PROJECT_ID,
    worktree: getTemporarySessionsDirectory(),
    name: t("projects.temporary"),
  };
}

/** Fetch through every API page, not only the bot's ten cached project directories. */
export async function loadTemporarySessions(): Promise<GlobalSession[]> {
  let sessions: GlobalSession[];
  if (opencodeServerVersion === "v2") {
    const { data, error } = await opencodeV2Client.session.listGlobalRoots();
    if (error || !data) throw error || new Error("No sessions received from OpenCode");
    sessions = data;
  } else {
    let limit = 200;
    for (;;) {
      const { data, error } = await opencodeClient.experimental.session.list({
        roots: true,
        limit,
      });
      if (error || !data) throw error || new Error("No sessions received from OpenCode");
      sessions = data;
      if (data.length < limit) break;
      limit *= 2;
    }
  }
  const excluded = new Set(
    config.bot.excludedProjectPaths.map((directory) => path.resolve(directory)),
  );
  const unique = new Map(
    sessions
      .filter(
        (session) =>
          !session.parentID &&
          isTemporarySessionDirectory(session.directory) &&
          !excluded.has(path.resolve(session.directory)),
      )
      .map((session) => [session.id, session]),
  );
  return [...unique.values()].sort((a, b) => b.time.updated - a.time.updated);
}

/** Only create missing links. Never replace user-owned files, links, or original directories. */
export async function syncTemporarySessionLinks(sessions: GlobalSession[]): Promise<void> {
  if (isContainerRuntime() || sessions.length === 0) return;
  const directory = getTemporarySessionsDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error("Temporary sessions index must not be a symlink");
  for (const session of sessions) {
    if (!/^ses_[a-zA-Z0-9]+$/.test(session.id) || !isTemporarySessionDirectory(session.directory))
      continue;
    try {
      if (!(await stat(session.directory)).isDirectory()) continue;
      const link = path.join(directory, session.id);
      try {
        await symlink(session.directory, link, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await lstat(link);
        if (
          !existing.isSymbolicLink() ||
          path.resolve(directory, await readlink(link)) !== path.resolve(session.directory)
        ) {
          logger.warn(`[TemporarySessions] Leaving existing index entry untouched: ${link}`);
        }
      }
    } catch (error) {
      logger.debug(`[TemporarySessions] Could not index ${session.id}`, error);
    }
  }
}
