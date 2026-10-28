/**
 * The iOS Notification Service Extension that turns a chat push into a
 * communication notification — the sender's picture, or the group's, with the
 * SFLuv icon in the corner. See NotificationService.swift.
 *
 * Built into the app by @bacons/apple-targets at prebuild. 15.1 rather than the
 * plugin's default of 18.0, which would leave every older phone with the plain
 * push; `UNNotificationContent.updating(from:)` is the iOS 15 API this needs.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
  type: "notification-service",
  name: "NotificationService",
  bundleIdentifier: ".notification-service",
  deploymentTarget: "15.1",
  frameworks: ["Intents", "UserNotifications"],
});
