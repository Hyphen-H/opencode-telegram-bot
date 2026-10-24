import { InlineKeyboard } from "grammy";
import { formatSessionTitle } from "../../app/formatters/session-title-formatter.js";
import { t } from "../../i18n/index.js";

export const SESSION_ACTION_PREFIX = "session-action:";
export const SESSION_ACTIONS_MENU_PREFIX = "session-actions:";
/** Telegram rejects button labels longer than this many characters. */
const MAX_BUTTON_LABEL_LENGTH = 64;

export interface SessionActionListItem {
  title: string;
  /** Position in the session list, so callbacks survive rows being dropped. */
  index: number;
}

export function appendSessionActionsEntry(keyboard: InlineKeyboard): InlineKeyboard {
  return keyboard.text(t("sessions.action.manage"), `${SESSION_ACTIONS_MENU_PREFIX}menu`);
}

export function buildSessionActionsList(items: SessionActionListItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const { title, index } of items) {
    const label = formatSessionTitle(title) || t("pinned.default_session_title");
    const trimmed =
      [...label].length > MAX_BUTTON_LABEL_LENGTH
        ? `${[...label].slice(0, MAX_BUTTON_LABEL_LENGTH - 1).join("")}…`
        : label;
    keyboard.text(trimmed, `${SESSION_ACTIONS_MENU_PREFIX}select:${index}`).row();
  }
  return keyboard.text(t("sessions.action.back"), `${SESSION_ACTIONS_MENU_PREFIX}back`);
}

export function buildSessionActionsSubmenu(index: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("sessions.action.delete"), `${SESSION_ACTION_PREFIX}delete:${index}`)
    .text(t("sessions.action.archive"), `${SESSION_ACTION_PREFIX}archive:${index}`)
    .row()
    .text(t("sessions.action.back"), `${SESSION_ACTIONS_MENU_PREFIX}submenu-back`);
}
