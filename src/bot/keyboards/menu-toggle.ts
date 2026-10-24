import type { Bot, Context } from "grammy";
import type { KeyboardManager } from "./keyboard-manager.js";
import { setMainMenuCollapsed } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export function registerMenuToggle(
  bot: Bot<Context>,
  container: { keyboardManager: Pick<KeyboardManager, "initialize" | "getKeyboard"> },
): void {
  async function toggle(ctx: Context, collapsed: boolean): Promise<void> {
    if (!ctx.chat) return;
    try {
      await setMainMenuCollapsed(collapsed);
      container.keyboardManager.initialize(ctx.api, ctx.chat.id);
      const keyboard = container.keyboardManager.getKeyboard();
      if (!keyboard) return;
      // Reply keyboards require sendMessage. Use a silent invisible carrier and
      // remove it after Telegram accepts the new keyboard, without a status reply.
      const carrier = await ctx.reply("\u2063", {
        disable_notification: true,
        reply_markup: keyboard,
      });
      await ctx.api.deleteMessage(ctx.chat.id, carrier.message_id).catch((error: unknown) => {
        logger.debug("[MenuToggle] Could not delete keyboard carrier", error);
      });
      await ctx.deleteMessage().catch((error: unknown) => {
        logger.debug("[MenuToggle] Could not delete toggle input", error);
      });
    } catch (error) {
      logger.error("[MenuToggle] Could not update keyboard", error);
    }
  }

  bot.hears(t("keyboard.menu_collapse"), (ctx) => toggle(ctx, true));
  bot.hears(t("keyboard.menu_expand"), (ctx) => toggle(ctx, false));
  bot.command("menu", (ctx) => toggle(ctx, false));
}
