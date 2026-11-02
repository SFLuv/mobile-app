/**
 * The iOS Notification Content Extension: the conversation above the Reply
 * field when a chat push is pulled down, the way Messages and Telegram show it.
 * See NotificationViewController.swift.
 *
 * Built into the app by @bacons/apple-targets at prebuild, like the service
 * extension beside it, and on the same 15.1 floor so every phone that gets a
 * communication notification gets this too.
 *
 * Info.plist is checked in rather than generated: the plugin's default names a
 * placeholder category, and this extension is drawn only for "chat_message",
 * the category the backend puts on chat pushes and the app registers with its
 * Reply action (src/services/notificationReplies.ts).
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
  type: "notification-content",
  name: "NotificationContent",
  bundleIdentifier: ".notification-content",
  deploymentTarget: "15.1",
  frameworks: ["UserNotifications", "UserNotificationsUI"],
});
