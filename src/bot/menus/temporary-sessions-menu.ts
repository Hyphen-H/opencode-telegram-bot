import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import {
  TEMPORARY_PROJECT_ID,
  loadTemporarySessions,
  syncTemporarySessionLinks,
} from "../../app/services/temporary-sessions-service.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "./inline-menu.js";
import { buildSessionSelectionMenuView } from "./session-selection-menu.js";

type TemporarySessionsDeps = Pick<
  AppContainer,
  "interactionManager" | "attachManager" | "foregroundSessionState"
>;
export const TEMPORARY_PAGE_PREFIX = "temporary:page:";

export async function showTemporarySessions(
  ctx: Context,
  deps: TemporarySessionsDeps,
  page = 0,
  edit = false,
): Promise<void> {
  const sessions = await loadTemporarySessions();
  await syncTemporarySessionLinks(sessions).catch((error: unknown) => {
    logger.warn("[TemporarySessions] Could not synchronize directory links", error);
  });
  const pageSize = config.bot.sessionsListLimit;
  const safePage = Math.min(
    Math.max(0, page),
    Math.max(0, Math.ceil(sessions.length / pageSize) - 1),
  );
  const current = sessions.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const { keyboard } = buildSessionSelectionMenuView(
    {
      sessions: current,
      page: safePage,
      hasNext: (safePage + 1) * pageSize < sessions.length,
    },
    pageSize,
  );
  for (const row of keyboard.inline_keyboard) {
    for (const button of row) {
      if (!("callback_data" in button)) continue;
      if (button.callback_data.startsWith("session:page:")) {
        button.callback_data = button.callback_data.replace("session:page:", TEMPORARY_PAGE_PREFIX);
      } else if (button.callback_data.startsWith("session:")) {
        const index = current.findIndex(
          (session) => button.callback_data === `session:${session.id}`,
        );
        button.callback_data = `recent:${index}`;
      }
    }
  }
  const text = sessions.length ? t("projects.temporary") : t("sessions.empty");
  const metadata = {
    temporarySessions: true,
    sessionIds: current.map((session) => session.id),
    directories: current.map((session) => session.directory),
  };
  if (edit) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, {
      reply_markup: appendInlineMenuCancelButton(keyboard, "recent"),
    });
    deps.interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        ...metadata,
        menuKind: "recent",
        messageId: ctx.callbackQuery?.message?.message_id,
      },
    });
  } else {
    await replyWithInlineMenu(ctx, { menuKind: "recent", text, keyboard, metadata }, deps);
  }
}

export async function handleTemporarySessionsCallback(
  ctx: Context,
  deps: TemporarySessionsDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  const isProject = data === `project:${TEMPORARY_PROJECT_ID}`;
  const pageText = data?.startsWith(TEMPORARY_PAGE_PREFIX)
    ? data.slice(TEMPORARY_PAGE_PREFIX.length)
    : null;
  if (!isProject && pageText === null) return false;
  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return true;
  }
  if (!(await ensureActiveInlineMenu(ctx, isProject ? "project" : "recent", deps))) return true;
  const metadata = deps.interactionManager.getSnapshot()?.metadata;
  if (!isProject && (!metadata?.temporarySessions || !/^\d+$/.test(pageText!))) {
    await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
    return true;
  }
  await showTemporarySessions(ctx, deps, isProject ? 0 : Number(pageText), true);
  return true;
}
