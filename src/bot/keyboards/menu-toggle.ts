import type { Bot, Context } from "grammy";
import type { KeyboardManager } from "./keyboard-manager.js";
import { getCurrentSession, setMainMenuCollapsed } from "../../app/stores/settings-store.js";
import { formatSessionTitle } from "../../app/formatters/session-title-formatter.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export function registerMenuToggle(
  bot: Bot<Context>,
  container: { keyboardManager: Pick<KeyboardManager, "initialize" | "getKeyboard"> },
): void {
  const carriers = new Map<number, number>();
  async function toggle(ctx: Context, collapsed: boolean, keepInput = false): Promise<void> {
    if (!ctx.chat) return;
    try {
      await setMainMenuCollapsed(collapsed);
      container.keyboardManager.initialize(ctx.api, ctx.chat.id);
      const keyboard = container.keyboardManager.getKeyboard();
      if (!keyboard) return;
      // Deleting the current carrier retracts the keyboard in some Telegram clients.
      // Give the retained carrier useful context instead of an empty bubble.
      const session = getCurrentSession();
      const text = session ? `💬 ${formatSessionTitle(session.title)}` : t("sessions.select");
      const carrier = await ctx.reply(text, {
        disable_notification: true,
        reply_markup: keyboard,
      });
      const previous = carriers.get(ctx.chat.id);
      carriers.set(ctx.chat.id, carrier.message_id);
      if (previous !== undefined && previous !== carrier.message_id) {
        await ctx.api.deleteMessage(ctx.chat.id, previous).catch((error: unknown) => {
          logger.debug("[MenuToggle] Could not delete old keyboard carrier", error);
        });
      }
      if (!keepInput)
        await ctx.deleteMessage().catch((error: unknown) => {
          logger.debug("[MenuToggle] Could not delete toggle input", error);
        });
    } catch (error) {
      logger.error("[MenuToggle] Could not update keyboard", error);
    }
  }

  bot.hears(t("keyboard.menu_collapse"), (ctx) => toggle(ctx, true));
  bot.hears(t("keyboard.menu_expand"), (ctx) => toggle(ctx, false));
  bot.command("menu", (ctx) => toggle(ctx, false, true));
}
