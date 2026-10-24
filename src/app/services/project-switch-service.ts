import type { Context } from "grammy";
import type {
  ForceReply,
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from "grammy/types";
import type { ProjectInfo } from "../types/project.js";
import type { ModelInfo } from "../types/model.js";
import { setCurrentProject } from "../stores/settings-store.js";
import { clearSession, getCurrentSession } from "./session-service.js";
import { detachAttachedSession, type DetachSessionDeps } from "./attach-service.js";
import { stopEventListening } from "../../opencode/events.js";
import { clearPromptResponseMode } from "../../bot/handlers/prompt.js";
import { handOverPromptQueue } from "../../bot/handlers/prompt-handover.js";
import { getStoredAgent, resolveProjectAgent } from "./agent-selection-service.js";
import { getStoredModel } from "./model-selection-service.js";
import { formatVariantForButton } from "./variant-selection-service.js";
import type { AppContainer } from "../bootstrap/app-container.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config.js";

interface ProjectSwitchContextInfo {
  tokensUsed: number;
  tokensLimit: number;
}

type ProjectSwitchReplyMarkup =
  | InlineKeyboardMarkup
  | ReplyKeyboardMarkup
  | ReplyKeyboardRemove
  | ForceReply;

export interface ProjectSwitchPresentation {
  clearPinnedMessage(): Promise<void>;
  initializeKeyboard(ctx: Context): void;
  refreshContextLimit(): Promise<number>;
  updateKeyboardContext(contextInfo: ProjectSwitchContextInfo): void;
  updateKeyboardAgent(agent: string): void;
  createMainKeyboard(
    agent: string,
    model: ModelInfo,
    contextInfo: ProjectSwitchContextInfo,
    variantName: string,
  ): ProjectSwitchReplyMarkup;
}

export type ProjectSwitchDeps = DetachSessionDeps &
  Pick<
    AppContainer,
    | "assistantRunState"
    | "backgroundSessionTracker"
    | "foregroundSessionState"
    | "resetInteractions"
  >;

interface SwitchToProjectOptions extends ProjectSwitchDeps {
  ensureEventSubscription?: ((directory: string) => Promise<void>) | undefined;
  presentation: ProjectSwitchPresentation;
}

/**
 * A project switch ends the bot's part in a running turn: the queue stays with the
 * session like /detach, and the new project is not held busy by a run it cannot follow.
 * The turn itself keeps running on the OpenCode server.
 */
async function releaseRunningTurn(options: ProjectSwitchDeps): Promise<boolean> {
  const busySessions = options.foregroundSessionState.getBusySessions();
  if (busySessions.length === 0 && !options.attachManager.isBusy()) {
    return false;
  }

  const currentSession = getCurrentSession();
  if (currentSession) {
    await handOverPromptQueue(currentSession);
    clearPromptResponseMode(currentSession.id);
  }

  for (const session of busySessions) {
    options.foregroundSessionState.markIdle(session.sessionId);
    options.assistantRunState.clearRun(session.sessionId, "project_switched");
  }

  logger.info(`[ProjectSwitch] Released a running turn: busySessions=${busySessions.length}`);
  return true;
}

export async function switchToProject(
  ctx: Context,
  project: ProjectInfo,
  reason: string,
  options: SwitchToProjectOptions,
) {
  const releasedRun = await releaseRunningTurn(options);
  detachAttachedSession(reason, options);
  stopEventListening();
  options.backgroundSessionTracker.clear();
  setCurrentProject(project);
  clearSession();
  options.resetAggregator();
  options.resetInteractions(reason);

  try {
    await options.presentation.clearPinnedMessage();
  } catch (err) {
    logger.error("[Bot] Error clearing pinned message:", err);
  }

  options.presentation.initializeKeyboard(ctx);

  const contextLimit = await options.presentation.refreshContextLimit();
  options.presentation.updateKeyboardContext({ tokensUsed: 0, tokensLimit: contextLimit });

  const currentAgent = await resolveProjectAgent(getStoredAgent());
  const currentModel = getStoredModel();
  const contextInfo = { tokensUsed: 0, tokensLimit: contextLimit };
  const variantName = formatVariantForButton(currentModel.variant || "default");
  options.presentation.updateKeyboardAgent(currentAgent);

  if (config.bot.trackBackgroundSessions && options.ensureEventSubscription) {
    await options.ensureEventSubscription(project.worktree);
  }

  return {
    keyboard: options.presentation.createMainKeyboard(
      currentAgent,
      currentModel,
      contextInfo,
      variantName,
    ),
    releasedRun,
  };
}
