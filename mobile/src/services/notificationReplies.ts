import * as Notifications from "expo-notifications";

import type { ChatMessage } from "../types/bulletin";
import { mergeIntoCachedThread, noteThreadNewest } from "./chatCache";
import { dismissConversationFromTray } from "./notificationInbox";

/**
 * Answering a chat push without opening the app: pull the banner down, type or
 * dictate, Send — the way Messages and Telegram do it.
 *
 * ── What is here, and what waits for 2.5 ────────────────────────────────────
 *
 * The Reply action is a notification category, which the app registers at
 * launch and the server names on every chat push. iOS draws the text field
 * itself, with the keyboard's own dictation, so this much needs nothing native
 * and ships over the air.
 *
 * What does not: the conversation above the reply field. That is a
 * Notification Content Extension, a native target, and lives on the 2.5
 * branch. Until then the expanded push shows the message it is about.
 *
 * ── Where the reply goes ────────────────────────────────────────────────────
 *
 * iOS hands the reply to the app, waking it in the background if it has to.
 * expo-notifications then tells iOS the reply is handled straight away, before
 * this code has run, so the app may be suspended within seconds. There is no
 * time for a sign-in to refresh a token.
 *
 * So the reply goes first through the push's own signed thread URL
 * (push_thread.go in the backend): one request, no session, sent the moment
 * the bundle runs. A signed-in client is the fallback, for a push from a
 * server too old to sign one.
 *
 * A reply that cannot be sent is not dropped silently: a local notification
 * says so, with the words typed, and opens the chat. From 2.5 the content
 * extension sends the reply itself, which does not depend on the app being
 * woken at all.
 */

export const CHAT_CATEGORY = "chat_message";
export const REPLY_ACTION = "reply";

/** Registers the Reply action. Every launch: iOS keeps categories per process. */
export async function registerChatNotificationActions(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(CHAT_CATEGORY, [
      {
        identifier: REPLY_ACTION,
        buttonTitle: "Reply",
        textInput: { submitButtonTitle: "Send", placeholder: "Message" },
        options: { opensAppToForeground: false },
      },
    ]);
  } catch {
    // The push still arrives and still opens the chat when tapped.
  }
}

/** Whether a response is a reply typed into a chat push. */
export function isNotificationReply(response: Notifications.NotificationResponse): boolean {
  return response.actionIdentifier === REPLY_ACTION;
}

type Fallback = (conversationId: number, body: string) => Promise<ChatMessage>;

/**
 * Sends a reply typed into a push. `fallback` is the signed-in client's send,
 * when there is one.
 */
export async function sendNotificationReply(
  response: Notifications.NotificationResponse,
  fallback: Fallback | null,
): Promise<void> {
  const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const conversationId = Number(data.conversation_id);
  const body = (response.userText ?? "").trim();
  if (!body || !Number.isFinite(conversationId) || conversationId <= 0) {
    return;
  }

  let sent: ChatMessage | null = null;
  const threadUrl = typeof data.thread_url === "string" ? data.thread_url : "";
  if (threadUrl) {
    try {
      const result = await fetch(threadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ body }),
      });
      if (result.status === 201) {
        sent = (await result.json()) as ChatMessage;
      }
    } catch {
      sent = null;
    }
  }
  if (!sent && fallback) {
    try {
      sent = await fallback(conversationId, body);
    } catch {
      sent = null;
    }
  }

  if (sent) {
    // Answered, so the thread's pushes are done with. And the reply is the
    // inbox row's last line and in the thread's copy, for whenever the app
    // is next opened in this run.
    void dismissConversationFromTray(conversationId);
    noteThreadNewest(conversationId, sent);
    mergeIntoCachedThread(conversationId, sent);
    return;
  }

  const who = response.notification.request.content.title?.trim();
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: who ? `Your reply to ${who} wasn't sent` : "Your reply wasn't sent",
        body,
        // Routed like the chat's own pushes, so tapping it opens the chat.
        data: { type: "bulletin_message", conversation_id: String(conversationId), reply_failed: "1" },
      },
      trigger: null,
    });
  } catch {
    // Nothing further can be done from here.
  }
}
