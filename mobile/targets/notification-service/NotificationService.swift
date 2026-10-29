import ImageIO
import Intents
import UIKit
import UserNotifications
import os

/// Chat pushes, drawn the way Messages and Telegram draw theirs.
///
/// iOS shows a push with the app's icon. A *communication* notification shows
/// the person instead — their picture large, the app's icon small in the
/// corner — and that is only possible from here: an extension that receives
/// the push before it is displayed, builds an `INSendMessageIntent` describing
/// who sent it, donates it, and hands back content updated from that intent.
///
/// The backend marks chat pushes `mutableContent` so iOS runs this, and puts
/// what it needs in the push's data: who sent it, whether it is a group, and
/// short-lived signed URLs for the pictures (this process has no access to the
/// app's session, so it cannot use the authenticated picture routes).
///
/// Everything degrades rather than fails. No picture, or one that will not
/// download, becomes the person's initials on the app's own colours — never
/// the app logo, which is what "even with the default picture" asks for. Any
/// other problem delivers the push exactly as it arrived.
class NotificationService: UNNotificationServiceExtension {
  /// Every fallback says why, so a push that arrives with the app's icon can be
  /// told apart from one that arrived with initials. On a Mac, Console.app with
  /// the phone selected, filtered to the subsystem "SFLuv.NotificationService".
  private static let log = Logger(subsystem: "SFLuv.NotificationService", category: "push")

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?
  /// The work finishes on Swift's cooperative pool and the deadline arrives on
  /// another thread; both deliver, and only one may.
  private let deliveryLock = NSLock()

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    bestAttempt = content

    guard
      let data = Self.payload(from: content.userInfo),
      (data["type"] as? String) == "bulletin_message",
      let senderId = data["sender_id"] as? String,
      !senderId.isEmpty
    else {
      // Not a chat message — a payout, a W-9 notice, being added to a group.
      // Shown as it is.
      Self.log.info("not a chat message, shown as sent")
      deliver(content)
      return
    }

    let rawName = (data["sender_name"] as? String) ?? ""
    let senderName = rawName.isEmpty ? content.title : rawName
    let isGroup = (data["is_group"] as? String) == "1"
    let conversationId = (data["conversation_id"] as? String) ?? ""
    let groupName: String? = isGroup ? content.title : nil
    let senderAvatarURL = data["sender_avatar_url"] as? String
    let groupAvatarURL = data["group_avatar_url"] as? String

    if senderAvatarURL == nil {
      Self.log.notice("no sender picture URL in the push; the server has no public URL, or nobody to picture")
    }

    Task {
      let senderData = await Self.download(senderAvatarURL)
      var groupData: Data? = nil
      if isGroup {
        groupData = await Self.download(groupAvatarURL)
      }

      let sender = INPerson(
        personHandle: INPersonHandle(value: senderId, type: .unknown),
        nameComponents: nil,
        displayName: senderName,
        image: INImage(imageData: senderData ?? Self.initialsImage(for: senderName)),
        contactIdentifier: nil,
        customIdentifier: senderId
      )

      // iOS draws a group only when there is more than one recipient. The
      // push does not list the members, and does not need to: the reader and a
      // stand-in for everybody else is what makes it read as a group.
      var recipients: [INPerson]? = nil
      if isGroup {
        let me = INPerson(
          personHandle: INPersonHandle(value: "me", type: .unknown),
          nameComponents: nil,
          displayName: nil,
          image: nil,
          contactIdentifier: nil,
          customIdentifier: nil,
          isMe: true
        )
        let others = INPerson(
          personHandle: INPersonHandle(value: "group-\(conversationId)", type: .unknown),
          nameComponents: nil,
          displayName: groupName,
          image: nil,
          contactIdentifier: nil,
          customIdentifier: nil
        )
        recipients = [me, others]
      }

      let intent = INSendMessageIntent(
        recipients: recipients,
        outgoingMessageType: .outgoingMessageText,
        content: content.body,
        speakableGroupName: groupName.map { INSpeakableString(spokenPhrase: $0) },
        conversationIdentifier: conversationId,
        serviceName: nil,
        sender: sender,
        attachments: nil
      )
      if isGroup {
        let groupImage = INImage(imageData: groupData ?? Self.initialsImage(for: groupName ?? senderName))
        intent.setImage(groupImage, forParameterNamed: \.speakableGroupName)
      }

      let interaction = INInteraction(intent: intent, response: nil)
      interaction.direction = .incoming
      do {
        try await interaction.donate()
      } catch {
        // Donation is what lets Siri and the share sheet suggest this person;
        // the notification itself does not depend on it.
      }

      do {
        let updated = try content.updating(from: intent)
        Self.log.info("communication notification, sender picture: \(senderData != nil ? "downloaded" : "initials", privacy: .public)")
        self.deliver(updated)
      } catch {
        // The plain push, with the app's icon. iOS refuses this when the app
        // lacks the Communication Notifications entitlement or does not list
        // INSendMessageIntent in NSUserActivityTypes.
        Self.log.error("updating(from:) refused: \(String(describing: error), privacy: .public)")
        self.deliver(content)
      }
    }
  }

  /// Out of time — iOS gives an extension about thirty seconds. Whatever is in
  /// hand goes out rather than nothing.
  override func serviceExtensionTimeWillExpire() {
    if let bestAttempt = bestAttempt {
      deliver(bestAttempt)
    }
  }

  /// Hands content back exactly once, whichever path gets there first.
  private func deliver(_ content: UNNotificationContent) {
    deliveryLock.lock()
    let handler = contentHandler
    contentHandler = nil
    deliveryLock.unlock()
    handler?(content)
  }

  /// The push's data. Expo delivers it under "body"; a dictionary normally,
  /// a JSON string in some service versions, so both are accepted.
  private static func payload(from userInfo: [AnyHashable: Any]) -> [String: Any]? {
    if let body = userInfo["body"] as? [String: Any] {
      return body
    }
    if let raw = userInfo["body"] as? String,
      let bytes = raw.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any]
    {
      return object
    }
    return nil
  }

  /// The largest picture worth downloading. The server accepts 4 MB.
  private static let maxImageBytes = 5 * 1024 * 1024

  /// A picture, small, or nil — never throws, and only returns something that
  /// actually decoded.
  ///
  /// Downsampled before anything else touches it. An extension has about
  /// 24 MB, and a 3000-pixel group photo is around 36 MB decoded: handed over
  /// whole, iOS kills the extension and shows the plain push, so the picture
  /// silently never appears. ImageIO reads only as much as the thumbnail needs.
  private static func download(_ urlString: String?) async -> Data? {
    guard let urlString = urlString, let url = URL(string: urlString) else {
      return nil
    }
    var request = URLRequest(url: url)
    request.timeoutInterval = 8
    guard let result = try? await URLSession.shared.data(for: request) else {
      log.error("picture download failed: no response from \(url.host ?? "?", privacy: .public)")
      return nil
    }
    let (data, response) = result
    guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= maxImageBytes else {
      // 404 is also "no picture": the route answers every refusal the same.
      log.notice("picture download refused: status \((response as? HTTPURLResponse)?.statusCode ?? 0, privacy: .public), \(data.count, privacy: .public) bytes")
      return nil
    }
    guard let small = thumbnail(of: data) else {
      log.error("picture did not decode: \(data.count, privacy: .public) bytes")
      return nil
    }
    return small
  }

  /// At most `maxPixels` on its longest side, as PNG, or nil if it does not
  /// decode.
  private static func thumbnail(of data: Data, maxPixels: Int = 256) -> Data? {
    let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
      return nil
    }
    let thumbnailOptions = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions) else {
      return nil
    }
    return UIImage(cgImage: image).pngData()
  }

  /// Initials on the app's avatar colours, matching the circle the app itself
  /// draws for somebody with no picture.
  private static func initialsImage(for name: String) -> Data {
    let size = CGSize(width: 120, height: 120)
    let renderer = UIGraphicsImageRenderer(size: size)
    let image = renderer.image { _ in
      // palette.primaryMuted and palette.primaryStrong from src/theme.ts.
      UIColor(red: 253 / 255, green: 234 / 255, blue: 229 / 255, alpha: 1).setFill()
      UIBezierPath(ovalIn: CGRect(origin: .zero, size: size)).fill()
      let text = initials(of: name) as NSString
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(ofSize: 46, weight: .bold),
        .foregroundColor: UIColor(red: 235 / 255, green: 108 / 255, blue: 108 / 255, alpha: 1),
      ]
      let textSize = text.size(withAttributes: attributes)
      text.draw(
        at: CGPoint(x: (size.width - textSize.width) / 2, y: (size.height - textSize.height) / 2),
        withAttributes: attributes
      )
    }
    return image.pngData() ?? Data()
  }

  /// Up to two initials, the same rule as the app's ChatAvatar.
  private static func initials(of name: String) -> String {
    let words = name.split(whereSeparator: { $0.isWhitespace })
    guard let first = words.first else {
      return "?"
    }
    if words.count == 1 {
      return String(first.prefix(2)).uppercased()
    }
    let last = words[words.count - 1]
    return (String(first.prefix(1)) + String(last.prefix(1))).uppercased()
  }
}
