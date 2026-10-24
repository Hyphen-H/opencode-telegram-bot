import { InlineKeyboard } from "grammy";
import { t } from "../../i18n/index.js";

export const SESSION_ACTION_PREFIX = "session-action:";
export const SESSION_ACTIONS_MENU_PREFIX = "session-actions:";

export function appendSessionActions(keyboard: InlineKeyboard, index: number): InlineKeyboard {
  return keyboard.text(t("sessions.action.more"), `${SESSION_ACTIONS_MENU_PREFIX}${index}`);
}

export function buildSessionActionsSubmenu(index: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("sessions.action.delete"), `${SESSION_ACTION_PREFIX}delete:${index}`)
    .text(t("sessions.action.archive"), `${SESSION_ACTION_PREFIX}archive:${index}`)
    .row()
    .text(t("sessions.action.back"), `${SESSION_ACTIONS_MENU_PREFIX}back`);
}
