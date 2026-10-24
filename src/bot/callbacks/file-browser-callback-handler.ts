import { InlineKeyboard, type Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import {
  getProjectRoot,
  isPathWithinDirectory,
  isWithinAllowedRoot,
  isWithinProjectRoot,
  pathToDisplayPath,
} from "../../app/services/file-browser-service.js";
import {
  isForegroundBusy,
  type ForegroundBusyDeps,
} from "../../app/services/run-control-service.js";
import { t } from "../../i18n/index.js";
import {
  createProjectDirectory,
  inspectProjectDirectory,
  resolveProjectDirectoryInput,
} from "../../app/services/project-directory-service.js";
import { isContainerRuntime } from "../../runtime/container.js";
import { extractCommandName, isKnownCommand } from "../routers/command-utils.js";
import { alert, failure } from "./feedback.js";
import { getProjectByWorktree } from "../../app/services/project-service.js";
import { upsertSessionDirectory } from "../../app/services/session-cache-service.js";
import { logger } from "../../utils/logger.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import {
  ensureActiveInlineMenu,
  clearActiveInlineMenu,
  type InlineMenuDeps,
} from "../menus/inline-menu.js";
import { sendDownloadedFile } from "../messages/send-downloaded-file.js";
import {
  switchToProject,
  type ProjectSwitchDeps,
} from "../../app/services/project-switch-service.js";
import {
  createProjectSwitchPresentation,
  type ProjectSwitchPresentationDeps,
} from "../services/project-switch-presentation.js";
import { promptAttachment } from "../../app/managers/prompt-attachment-manager.js";
import { toRelativePath } from "../../app/services/prompt-attachment-service.js";
import { ATTACHMENT_CANCEL_CALLBACK } from "./prompt-attachment-callback-handler.js";
import {
  buildOpenRootsKeyboard,
  clearLsPathIndex,
  clearOpenPathIndex,
  decodeLsAttachCallback,
  decodeLsBackCallback,
  decodeLsFileCallback,
  decodeLsPaginationCallback,
  decodeLsPathFromCallback,
  decodeOpenPaginationCallback,
  decodeOpenPathFromCallback,
  LS_CALLBACK_DOWNLOAD_PREFIX,
  LS_CALLBACK_NAV_PREFIX,
  LS_CALLBACK_PREFIX,
  OPEN_CALLBACK_NAV_PREFIX,
  OPEN_CALLBACK_PREFIX,
  OPEN_CALLBACK_ROOTS,
  OPEN_CALLBACK_MKDIR_PREFIX,
  OPEN_CALLBACK_PATH_PREFIX,
  OPEN_CALLBACK_CREATE_PREFIX,
  encodeOpenPathForCallback,
  OPEN_CALLBACK_SELECT_PREFIX,
  renderLsBrowseView,
  renderLsFileDetailsView,
  renderOpenBrowseView,
} from "../menus/file-browser-menu.js";

export type LsCallbackDeps = ForegroundBusyDeps & InlineMenuDeps;

export type OpenCallbackDeps = Pick<AppContainer, "ensureEventSubscription"> &
  ForegroundBusyDeps &
  InlineMenuDeps &
  ProjectSwitchDeps &
  ProjectSwitchPresentationDeps;

const sessionDirectories = new Map<number, string>();

export function clearSessionDirectories(): void {
  sessionDirectories.clear();
}

export function resolveInitialLsDirectory(userId?: number): string | null {
  const currentProject = getProjectRoot();
  if (!currentProject) {
    return null;
  }

  if (userId) {
    const cachedDirectory = sessionDirectories.get(userId);
    if (cachedDirectory && isPathWithinDirectory(cachedDirectory, currentProject)) {
      return cachedDirectory;
    }
  }

  return currentProject;
}

export function rememberLsDirectory(userId: number | undefined, directory: string): void {
  if (userId) {
    sessionDirectories.set(userId, directory);
  }
}

export async function handleOpenCallback(
  ctx: Context,
  deps: OpenCallbackDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(OPEN_CALLBACK_PREFIX)) {
    return false;
  }

  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return true;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "open", deps);
  if (!isActiveMenu) {
    return true;
  }

  try {
    if (isContainerRuntime()) {
      await alert(ctx, "runtime.container.command_unavailable");
      return true;
    }
    if (data === OPEN_CALLBACK_ROOTS) {
      deps.interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          ...deps.interactionManager.getSnapshot()?.metadata,
          stage: "browse",
        },
      });
      await showOpenRoots(ctx);
      return true;
    }

    for (const [prefix, stage] of [
      [OPEN_CALLBACK_MKDIR_PREFIX, "folder"],
      [OPEN_CALLBACK_PATH_PREFIX, "path"],
    ] as const) {
      const base = decodeOpenPathFromCallback(prefix, data);
      if (base === null) continue;
      if ((await inspectProjectDirectory(base)) !== "exists")
        throw new Error(t("open.invalid_path"));
      const keyboard = new InlineKeyboard()
        .text(t("open.back"), encodeOpenPathForCallback(OPEN_CALLBACK_NAV_PREFIX, base))
        .row();
      keyboard.text(t("inline.button.cancel"), "inline:cancel:open");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        t(stage === "folder" ? "open.folder_prompt" : "open.path_prompt", {
          path: pathToDisplayPath(base),
        }),
        { reply_markup: keyboard },
      );
      deps.interactionManager.transition({
        expectedInput: "mixed",
        metadata: {
          ...deps.interactionManager.getSnapshot()?.metadata,
          stage,
          basePath: base,
        },
      });
      return true;
    }

    const createPath = decodeOpenPathFromCallback(OPEN_CALLBACK_CREATE_PREFIX, data);
    if (createPath !== null) {
      await createProjectDirectory(createPath);
      await navigateOpenTo(ctx, createPath, deps);
      return true;
    }

    const navPath = decodeOpenPathFromCallback(OPEN_CALLBACK_NAV_PREFIX, data);
    if (navPath !== null) {
      if (!isWithinAllowedRoot(navPath)) {
        await alert(ctx, "open.access_denied");
        return true;
      }
      await inspectProjectDirectory(navPath);
      await navigateOpenTo(ctx, navPath, deps);
      return true;
    }

    const pageInfo = decodeOpenPaginationCallback(data);
    if (pageInfo !== null) {
      if (!isWithinAllowedRoot(pageInfo.path)) {
        await alert(ctx, "open.access_denied");
        return true;
      }
      await inspectProjectDirectory(pageInfo.path);
      await navigateOpenTo(ctx, pageInfo.path, deps, pageInfo.page);
      return true;
    }

    const selectPath = decodeOpenPathFromCallback(OPEN_CALLBACK_SELECT_PREFIX, data);
    if (selectPath !== null) {
      if (!isWithinAllowedRoot(selectPath)) {
        await alert(ctx, "open.access_denied");
        return true;
      }
      if ((await inspectProjectDirectory(selectPath)) !== "exists")
        throw new Error(t("open.invalid_path"));
      await selectDirectory(ctx, selectPath, deps);
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[Bot] Error handling open callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }
}

async function showOpenRoots(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t("open.select_root"), { reply_markup: buildOpenRootsKeyboard() });
}

async function navigateOpenTo(
  ctx: Context,
  dirPath: string,
  deps: OpenCallbackDeps,
  page: number = 0,
): Promise<void> {
  const view = await renderOpenBrowseView(dirPath, page);

  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
  deps.interactionManager.transition({
    expectedInput: "callback",
    metadata: {
      ...deps.interactionManager.getSnapshot()?.metadata,
      stage: "browse",
    },
  });
}

/** Consume path input before command routing: absolute filesystem paths start with '/'. */
export async function handleOpenPathInput(ctx: Context, deps: OpenCallbackDeps): Promise<boolean> {
  const state = deps.interactionManager.getSnapshot();
  const text = ctx.message?.text;
  if (
    state?.kind !== "inline" ||
    state.metadata.menuKind !== "open" ||
    !["folder", "path"].includes(String(state.metadata.stage)) ||
    text === undefined
  )
    return false;
  // Keep actual bot commands available without treating them as paths.
  const command = extractCommandName(text);
  if (command && isKnownCommand(command)) return false;
  if (isForegroundBusy(deps) || isContainerRuntime()) return true;
  const base = state.metadata.basePath;
  const messageId = state.metadata.messageId;
  if (typeof base !== "string" || typeof messageId !== "number" || !ctx.chat) return true;
  try {
    const target = resolveProjectDirectoryInput(text, base, state.metadata.stage === "folder");
    const status = await inspectProjectDirectory(target);
    if (status === "exists") {
      const view = await renderOpenBrowseView(target);
      if ("error" in view) throw new Error(view.error);
      await ctx.api.editMessageText(ctx.chat.id, messageId, view.text, {
        reply_markup: view.keyboard,
      });
    } else {
      const keyboard = new InlineKeyboard()
        .text(
          t("open.create_confirm"),
          encodeOpenPathForCallback(OPEN_CALLBACK_CREATE_PREFIX, target),
        )
        .row()
        .text(t("open.back"), encodeOpenPathForCallback(OPEN_CALLBACK_NAV_PREFIX, base))
        .row()
        .text(t("inline.button.cancel"), "inline:cancel:open");
      await ctx.api.editMessageText(
        ctx.chat.id,
        messageId,
        t("open.create_prompt", { path: pathToDisplayPath(target) }),
        { reply_markup: keyboard },
      );
    }
    deps.interactionManager.transition({
      expectedInput: "callback",
      metadata: { ...state.metadata, stage: "browse" },
    });
  } catch (error) {
    logger.debug("[Open] Invalid project directory input", error);
    await ctx.reply(
      t("open.path_error", { error: error instanceof Error ? error.message : String(error) }),
    );
  }
  return true;
}

async function selectDirectory(
  ctx: Context,
  directory: string,
  deps: OpenCallbackDeps,
): Promise<void> {
  const displayPath = pathToDisplayPath(directory);

  try {
    logger.info(`[Bot] Adding project directory: ${directory}`);
    await upsertSessionDirectory(directory, Date.now());

    const projectInfo = await getProjectByWorktree(directory);
    const selectedProjectInfo = { ...projectInfo, name: displayPath };
    const replyKeyboard = await switchToProject(ctx, selectedProjectInfo, "open_project_selected", {
      ...deps,
      presentation: createProjectSwitchPresentation(deps),
    });

    await ctx.answerCallbackQuery();
    await ctx.reply(t("open.selected", { project: displayPath }), { reply_markup: replyKeyboard });
    await ctx.deleteMessage();
    clearOpenPathIndex();

    logger.info(`[Bot] Project added and selected: ${displayPath}`);
  } catch (error) {
    logger.error("[Bot] Error selecting directory:", error);
    await failure(ctx, "open.select_error");
  }
}

export async function handleLsCallback(ctx: Context, deps: LsCallbackDeps): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(LS_CALLBACK_PREFIX)) {
    return false;
  }

  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return true;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "ls", deps);
  if (!isActiveMenu) {
    return true;
  }

  try {
    const navPath = decodeLsPathFromCallback(LS_CALLBACK_NAV_PREFIX, data);
    if (navPath !== null) {
      if (!isWithinProjectRoot(navPath)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await navigateLsTo(ctx, navPath);
      return true;
    }

    const pageInfo = decodeLsPaginationCallback(data);
    if (pageInfo !== null) {
      if (!isWithinProjectRoot(pageInfo.path)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await navigateLsTo(ctx, pageInfo.path, pageInfo.page);
      return true;
    }

    const fileInfo = decodeLsFileCallback(data);
    if (fileInfo !== null) {
      if (!isWithinProjectRoot(fileInfo.path)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await showLsFileDetails(ctx, fileInfo.path, fileInfo.page);
      return true;
    }

    const attachPath = decodeLsAttachCallback(data);
    if (attachPath !== null) {
      if (!isWithinProjectRoot(attachPath)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await attachFileAndClose(ctx, deps, attachPath);
      return true;
    }

    const downloadPath = decodeLsPathFromCallback(LS_CALLBACK_DOWNLOAD_PREFIX, data);
    if (downloadPath !== null) {
      if (!isWithinProjectRoot(downloadPath)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await downloadFileAndClose(ctx, deps, downloadPath);
      return true;
    }

    const backInfo = decodeLsBackCallback(data);
    if (backInfo !== null) {
      if (!isWithinProjectRoot(backInfo.path)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await navigateLsTo(ctx, backInfo.path, backInfo.page);
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[Ls] Error handling callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }
}

async function navigateLsTo(ctx: Context, dirPath: string, page: number = 0): Promise<void> {
  const view = await renderLsBrowseView(dirPath, page);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  rememberLsDirectory(ctx.from?.id, dirPath);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function showLsFileDetails(ctx: Context, filePath: string, page: number): Promise<void> {
  const view = await renderLsFileDetailsView(filePath, page);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function attachFileAndClose(
  ctx: Context,
  deps: LsCallbackDeps,
  filePath: string,
): Promise<void> {
  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    await ctx.answerCallbackQuery({ text: t("bot.project_not_selected") });
    return;
  }

  promptAttachment.set(filePath, projectRoot);

  await ctx.answerCallbackQuery();
  clearActiveInlineMenu("ls_attached", deps);
  clearLsPathIndex();
  await ctx.deleteMessage().catch(() => {});

  const relativePath = toRelativePath(filePath, projectRoot);
  const confirmation = await ctx.reply(t("attachment.added", { path: relativePath }), {
    reply_markup: new InlineKeyboard().text(t("attachment.cancel"), ATTACHMENT_CANCEL_CALLBACK),
  });
  promptAttachment.setConfirmationMessageId(confirmation.message_id);

  // Wait for the prompt the file belongs to: "mixed" lets the text and the cancel button
  // through while blocking commands, menus, and non-text messages.
  deps.interactionManager.start({
    kind: "custom",
    expectedInput: "mixed",
    metadata: { flow: "attachment" },
  });

  logger.info(`[PromptAttachment] Attached from /ls: ${filePath}`);
}

async function downloadFileAndClose(
  ctx: Context,
  deps: LsCallbackDeps,
  filePath: string,
): Promise<void> {
  await ctx.answerCallbackQuery({ text: t("commands.download.downloading") });
  const downloaded = await sendDownloadedFile(ctx, filePath, { announce: false });
  if (!downloaded) {
    return;
  }

  clearActiveInlineMenu("ls_downloaded", deps);
  clearLsPathIndex();
  await ctx.deleteMessage().catch(() => {});
}
