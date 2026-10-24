import type { InlineKeyboard } from "grammy";
import { t } from "../../i18n/index.js";

export const SESSION_ACTION_PREFIX = "session-action:";

export function appendSessionActions(keyboard: InlineKeyboard, index: number): InlineKeyboard {
  return keyboard
    .text(t("sessions.action.delete"), `${SESSION_ACTION_PREFIX}delete:${index}`)
    .text(t("sessions.action.archive"), `${SESSION_ACTION_PREFIX}archive:${index}`);
}
