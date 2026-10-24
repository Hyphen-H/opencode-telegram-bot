import { randomBytes } from "node:crypto";
import { InlineKeyboard, type Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import type { InteractionMetadata } from "../../app/types/interaction.js";
import { opencodeClient, opencodeServerVersion, opencodeV2Client } from "../../opencode/client.js";
import { getCurrentSession } from "../../app/stores/settings-store.js";
import { clearSession } from "../../app/services/session-service.js";
import { detachAttachedSession } from "../../app/services/attach-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { formatSessionTitle } from "../../app/formatters/session-title-formatter.js";
import { ensureActiveInlineMenu } from "../menus/inline-menu.js";
import { SESSION_ACTION_PREFIX } from "../menus/session-actions-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

type ActionDeps = Pick<
  AppContainer,
  | "interactionManager"
  | "attachManager"
  | "foregroundSessionState"
  | "resetAggregator"
  | "pinnedMessageManager"
>;
type PendingAction = {
  action: "delete" | "archive";
  id: string;
  index: number;
  directory: string;
  nonce: string;
  executing?: boolean;
  text: string;
  keyboard: InlineKeyboardMarkup;
  metadata: InteractionMetadata;
};

async function readIdleSession(id: string, directory: string) {
  const { data, error } = await opencodeClient.session.get({ sessionID: id, directory });
  if (error || !data || data.directory !== directory || data.time.archived) {
    throw new Error(t("inline.inactive_callback"));
  }
  const statuses = await opencodeClient.session.status({ directory });
  if (statuses.error || !statuses.data)
    throw statuses.error || new Error("Session status unavailable");
  const status = statuses.data[id]?.type;
  if (status === "busy" || status === "retry") throw new Error(t("sessions.action.busy"));
  return data;
}

export async function handleSessionAction(ctx: Context, deps: ActionDeps): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith(SESSION_ACTION_PREFIX)) return false;
  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return true;
  }
  const state = deps.interactionManager.getSnapshot();
  const kind = state?.metadata.menuKind;
  if (
    (kind !== "session" && kind !== "recent") ||
    !(await ensureActiveInlineMenu(ctx, kind, deps))
  ) {
    if (kind !== "session" && kind !== "recent") {
      await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
    }
    return true;
  }
  const inactive = async () =>
    ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
  let pending = state!.metadata.sessionAction as PendingAction | undefined;
  try {
    const request = data.match(/^session-action:(delete|archive):(\d+)$/);
    if (request) {
      if (pending) {
        await inactive();
        return true;
      }
      const action = request[1] as PendingAction["action"];
      const ids = state!.metadata.sessionIds;
      const directories = state!.metadata.directories;
      const index = Number(request[2]);
      const id = Array.isArray(ids) ? ids[index] : undefined;
      const directory = Array.isArray(directories) ? directories[index] : undefined;
      const message = ctx.callbackQuery?.message;
      if (
        !Number.isSafeInteger(index) ||
        typeof id !== "string" ||
        typeof directory !== "string" ||
        !message ||
        !("text" in message) ||
        !message.reply_markup
      ) {
        await inactive();
        return true;
      }
      if (action === "archive" && opencodeServerVersion !== "v2") {
        await ctx.answerCallbackQuery({ text: t("sessions.action.v2_only"), show_alert: true });
        return true;
      }
      const session = await readIdleSession(id, directory);
      pending = {
        action,
        id,
        index,
        directory,
        nonce: randomBytes(12).toString("hex"),
        text: message.text,
        keyboard: message.reply_markup,
        metadata: { ...state!.metadata },
      };
      const keyboard = new InlineKeyboard()
        .text(
          t(
            action === "delete"
              ? "sessions.action.confirm_delete"
              : "sessions.action.confirm_archive",
          ),
          `${SESSION_ACTION_PREFIX}confirm:${pending.nonce}`,
        )
        .text(t("inline.button.cancel"), `${SESSION_ACTION_PREFIX}cancel:${pending.nonce}`);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        t(
          action === "delete" ? "sessions.action.delete_prompt" : "sessions.action.archive_prompt",
          { title: formatSessionTitle(session.title) },
        ),
        { reply_markup: keyboard },
      );
      deps.interactionManager.transition({
        metadata: { ...state!.metadata, sessionAction: pending },
      });
      return true;
    }

    const decision = data.match(/^session-action:(confirm|cancel):([a-f0-9]{24})$/);
    if (!decision || !pending || pending.nonce !== decision[2] || pending.executing) {
      await inactive();
      return true;
    }
    if (decision[1] === "cancel") {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(pending.text, { reply_markup: pending.keyboard });
      deps.interactionManager.transition({ metadata: pending.metadata });
      return true;
    }

    // Claim the confirmation before awaiting the API, so duplicate taps cannot execute twice.
    pending = { ...pending, executing: true };
    deps.interactionManager.transition({
      metadata: { ...state!.metadata, sessionAction: pending },
    });
    await readIdleSession(pending.id, pending.directory);
    const result =
      pending.action === "delete"
        ? await opencodeClient.session.delete({
            sessionID: pending.id,
            directory: pending.directory,
          })
        : await opencodeV2Client.session.archive({ sessionID: pending.id });
    if (result.error || !result.data) throw result.error || new Error("Session action failed");

    const metadata = { ...pending.metadata };
    const ids = metadata.sessionIds;
    if (Array.isArray(ids)) metadata.sessionIds = ids.map((id) => (id === pending!.id ? null : id));
    const keyboard = {
      inline_keyboard: pending.keyboard.inline_keyboard.filter(
        (row) =>
          !row.some(
            (button) =>
              "callback_data" in button &&
              button.callback_data === `${SESSION_ACTION_PREFIX}delete:${pending!.index}`,
          ),
      ),
    };
    // Consume the nonce even if cleanup or rendering later fails.
    deps.interactionManager.transition({ metadata });
    if (getCurrentSession()?.id === pending.id) {
      detachAttachedSession("session_managed", deps);
      clearSession();
      deps.foregroundSessionState.markIdle(pending.id);
      await deps.pinnedMessageManager
        .clear()
        .catch((error: unknown) => logger.warn("[SessionAction] Could not clear dashboard", error));
    }
    await ctx.editMessageText(pending.text, { reply_markup: keyboard }).catch((error: unknown) => {
      logger.warn("[SessionAction] Action succeeded but list refresh failed", error);
    });
    await ctx.answerCallbackQuery({
      text: t(pending.action === "delete" ? "sessions.action.deleted" : "sessions.action.archived"),
    });
  } catch (error) {
    const current = deps.interactionManager.getSnapshot();
    const active = current?.metadata.sessionAction as PendingAction | undefined;
    if (active?.nonce === pending?.nonce) {
      deps.interactionManager.transition({
        metadata: { ...current!.metadata, sessionAction: { ...active, executing: false } },
      });
    }
    logger.warn("[SessionAction] Could not manage session", error);
    const message =
      error instanceof Error &&
      [t("sessions.action.busy"), t("inline.inactive_callback")].includes(error.message)
        ? error.message
        : t("sessions.action.failed");
    await ctx.answerCallbackQuery({ text: message, show_alert: true }).catch(() => {});
  }
  return true;
}
