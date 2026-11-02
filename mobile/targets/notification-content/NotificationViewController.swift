import UIKit
import UserNotifications
import UserNotificationsUI
import os

/// A chat push, pulled down: the conversation, and a Reply field under it.
///
/// iOS draws the Reply field and its keyboard, dictation included, from the
/// "chat_message" category the app registers. This extension draws what is
/// above it, the newest messages in the thread, and sends the reply itself.
///
/// It has no session, as the service extension has none. The push carries a
/// signed thread URL (push_thread.go in the backend) that names this
/// conversation and the person the push was for. GET on it is the newest page
/// of messages, and POST sends a reply as them. Until the page arrives, the
/// message the push is about is shown on its own.
///
/// A reply this cannot send is forwarded to the app, which tries again
/// through the signed-in client and, failing that, says so with a notification
/// (src/services/notificationReplies.ts).
class NotificationViewController: UIViewController, UNNotificationContentExtension {
  /// In Console.app, filtered to the subsystem "SFLuv.NotificationContent".
  private static let log = Logger(subsystem: "SFLuv.NotificationContent", category: "thread")

  /// The most this shows. The expanded notification is a glance at the thread,
  /// not the thread.
  private static let maxBubbles = 20
  private static let maxHeight: CGFloat = 440

  private struct Bubble {
    let id: Int64
    let mine: Bool
    let sender: String?
    let text: String
    let system: Bool
    var pending: Bool
  }

  private let scrollView = UIScrollView()
  private let stack = UIStackView()
  private var threadURL: URL?
  private var isGroup = false
  private var bubbles: [Bubble] = []
  /// Ids for replies not yet confirmed, below zero so they never meet a real one.
  private var nextPendingId: Int64 = -1

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear

    scrollView.translatesAutoresizingMaskIntoConstraints = false
    scrollView.alwaysBounceVertical = true
    scrollView.showsVerticalScrollIndicator = false
    stack.axis = .vertical
    stack.spacing = 4
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scrollView)
    scrollView.addSubview(stack)
    NSLayoutConstraint.activate([
      scrollView.topAnchor.constraint(equalTo: view.topAnchor),
      scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 12),
      stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -12),
      stack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 12),
      stack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -12),
    ])

    // Interaction is on so the history scrolls, which turns off the system's
    // own tap-to-open. A tap still opens the chat, as it does on any push.
    view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(openChat)))
  }

  @objc private func openChat() {
    extensionContext?.performNotificationDefaultAction()
  }

  // MARK: - Content

  /// Called for the push that was pulled down, and again for each one in the
  /// same category that arrives while it is open.
  func didReceive(_ notification: UNNotification) {
    let content = notification.request.content
    let data = Self.payload(from: content.userInfo) ?? [:]
    if let raw = data["thread_url"] as? String, let url = URL(string: raw) {
      threadURL = url
    }
    isGroup = (data["is_group"] as? String) == "1"

    // The message the push is about, at once. A group's line starts with who
    // spoke ("Maria: hello"); the bubble's own label says that instead.
    let senderName = ((data["sender_name"] as? String) ?? "").isEmpty ? content.title : (data["sender_name"] as? String ?? "")
    let messageId = Int64((data["message_id"] as? String) ?? "") ?? 0
    var line = content.body
    if isGroup, line.hasPrefix(senderName + ": ") {
      line = String(line.dropFirst(senderName.count + 2))
    }
    if messageId == 0 || !bubbles.contains(where: { $0.id == messageId }) {
      bubbles.append(Bubble(id: messageId, mine: false, sender: isGroup ? senderName : nil, text: line, system: false, pending: false))
      render()
    }
    loadHistory()
  }

  private func loadHistory() {
    guard let url = threadURL else {
      Self.log.notice("no thread URL in the push; showing its own message only")
      return
    }
    var request = URLRequest(url: url)
    request.timeoutInterval = 8
    URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard status == 200, let data = data, let page = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let messages = page["messages"] as? [[String: Any]]
      else {
        Self.log.notice("thread history refused: status \(status, privacy: .public)")
        return
      }
      let loaded = messages.compactMap(Self.bubble(from:)).suffix(Self.maxBubbles)
      DispatchQueue.main.async {
        guard let self = self else { return }
        // Replies still on their way are kept under what the server returned.
        let pending = self.bubbles.filter { $0.pending }
        self.bubbles = Array(loaded) + pending
        self.render()
      }
    }.resume()
  }

  // MARK: - Reply

  func didReceive(
    _ response: UNNotificationResponse,
    completionHandler completion: @escaping (UNNotificationContentExtensionResponseOption) -> Void
  ) {
    guard response.actionIdentifier == "reply", let textResponse = response as? UNTextInputNotificationResponse else {
      completion(.dismissAndForwardAction)
      return
    }
    let text = textResponse.userText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
      completion(.doNotDismiss)
      return
    }
    guard let url = threadURL else {
      // A push from a server too old to sign one: the app sends it instead.
      completion(.dismissAndForwardAction)
      return
    }

    let pendingId = nextPendingId
    nextPendingId -= 1
    bubbles.append(Bubble(id: pendingId, mine: true, sender: nil, text: text, system: false, pending: true))
    render()

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 10
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["body": text])
    URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      let sentId = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })?["id"] as? NSNumber
      DispatchQueue.main.async {
        guard let self = self else {
          completion(status == 201 ? .doNotDismiss : .dismissAndForwardAction)
          return
        }
        if status == 201 {
          // Stays open on the sent reply, as Messages does, for another.
          if let index = self.bubbles.firstIndex(where: { $0.id == pendingId }) {
            let sent = self.bubbles[index]
            self.bubbles[index] = Bubble(
              id: sentId?.int64Value ?? pendingId, mine: true, sender: nil, text: sent.text, system: false, pending: false)
          }
          self.render()
          completion(.doNotDismiss)
        } else {
          Self.log.error("reply refused: status \(status, privacy: .public); forwarding to the app")
          self.bubbles.removeAll { $0.id == pendingId }
          self.render()
          completion(.dismissAndForwardAction)
        }
      }
    }.resume()
  }

  // MARK: - Drawing

  private func render() {
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    var previousSender: String?
    for bubble in bubbles {
      if bubble.system {
        stack.addArrangedSubview(Self.systemLine(bubble.text))
        previousSender = nil
        continue
      }
      // In a group, who spoke, over the first of their run.
      if isGroup, !bubble.mine, let sender = bubble.sender, sender != previousSender {
        stack.addArrangedSubview(Self.senderLabel(sender))
      }
      previousSender = bubble.mine ? nil : bubble.sender
      stack.addArrangedSubview(Self.bubbleRow(bubble))
    }
    view.layoutIfNeeded()
    let height = min(Self.maxHeight, max(120, stack.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize).height + 24))
    preferredContentSize = CGSize(width: view.bounds.width, height: height)
    // The newest at the bottom, in view, as in the chat.
    DispatchQueue.main.async {
      let bottom = max(0, self.scrollView.contentSize.height - self.scrollView.bounds.height)
      self.scrollView.setContentOffset(CGPoint(x: 0, y: bottom), animated: false)
    }
  }

  // The app's palette (src/theme.ts), light and dark.
  private static let mineColor = UIColor(red: 235 / 255, green: 108 / 255, blue: 108 / 255, alpha: 1)
  private static let theirsColor = UIColor { $0.userInterfaceStyle == .dark
    ? UIColor(red: 19 / 255, green: 42 / 255, blue: 51 / 255, alpha: 1) : .white }
  private static let theirsBorder = UIColor { $0.userInterfaceStyle == .dark
    ? UIColor(red: 42 / 255, green: 75 / 255, blue: 87 / 255, alpha: 1)
    : UIColor(red: 230 / 255, green: 220 / 255, blue: 215 / 255, alpha: 1) }
  private static let textColor = UIColor { $0.userInterfaceStyle == .dark
    ? UIColor(red: 234 / 255, green: 243 / 255, blue: 245 / 255, alpha: 1)
    : UIColor(red: 16 / 255, green: 24 / 255, blue: 32 / 255, alpha: 1) }
  private static let mutedColor = UIColor { $0.userInterfaceStyle == .dark
    ? UIColor(red: 157 / 255, green: 180 / 255, blue: 189 / 255, alpha: 1)
    : UIColor(red: 74 / 255, green: 96 / 255, blue: 105 / 255, alpha: 1) }

  private static func bubbleRow(_ bubble: Bubble) -> UIView {
    let label = UILabel()
    label.numberOfLines = 0
    label.font = .systemFont(ofSize: 15)
    label.text = bubble.text
    label.textColor = bubble.mine ? .white : textColor
    label.translatesAutoresizingMaskIntoConstraints = false

    let shape = UIView()
    shape.backgroundColor = bubble.mine ? mineColor : theirsColor
    shape.layer.cornerRadius = 16
    shape.layer.cornerCurve = .continuous
    if !bubble.mine {
      shape.layer.borderWidth = 1
      shape.layer.borderColor = theirsBorder.cgColor
    }
    // A reply still on its way, faded until the server has it.
    shape.alpha = bubble.pending ? 0.55 : 1
    shape.translatesAutoresizingMaskIntoConstraints = false
    shape.addSubview(label)

    let row = UIView()
    row.addSubview(shape)
    NSLayoutConstraint.activate([
      label.topAnchor.constraint(equalTo: shape.topAnchor, constant: 8),
      label.bottomAnchor.constraint(equalTo: shape.bottomAnchor, constant: -8),
      label.leadingAnchor.constraint(equalTo: shape.leadingAnchor, constant: 12),
      label.trailingAnchor.constraint(equalTo: shape.trailingAnchor, constant: -12),
      shape.topAnchor.constraint(equalTo: row.topAnchor),
      shape.bottomAnchor.constraint(equalTo: row.bottomAnchor),
      shape.widthAnchor.constraint(lessThanOrEqualTo: row.widthAnchor, multiplier: 0.78),
      bubble.mine
        ? shape.trailingAnchor.constraint(equalTo: row.trailingAnchor)
        : shape.leadingAnchor.constraint(equalTo: row.leadingAnchor),
    ])
    return row
  }

  private static func senderLabel(_ name: String) -> UIView {
    let label = UILabel()
    label.font = .systemFont(ofSize: 12, weight: .semibold)
    label.textColor = mutedColor
    label.text = name
    let row = UIView()
    label.translatesAutoresizingMaskIntoConstraints = false
    row.addSubview(label)
    NSLayoutConstraint.activate([
      label.topAnchor.constraint(equalTo: row.topAnchor, constant: 4),
      label.bottomAnchor.constraint(equalTo: row.bottomAnchor),
      label.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 12),
      label.trailingAnchor.constraint(lessThanOrEqualTo: row.trailingAnchor),
    ])
    return row
  }

  private static func systemLine(_ text: String) -> UIView {
    let label = UILabel()
    label.font = .systemFont(ofSize: 12)
    label.textColor = mutedColor
    label.textAlignment = .center
    label.numberOfLines = 0
    label.text = text
    return label
  }

  // MARK: - Parsing

  /// The push's data. Expo delivers it under "body", as a dictionary or as a
  /// JSON string — the same reading as the service extension's.
  private static func payload(from userInfo: [AnyHashable: Any]) -> [String: Any]? {
    if let body = userInfo["body"] as? [String: Any] {
      return body
    }
    if let raw = userInfo["body"] as? String, let bytes = raw.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any]
    {
      return object
    }
    return nil
  }

  /// One message from the thread page, worded as the inbox and the push word
  /// it (MessagesScreen's attachmentPreviewLabel, chat_announce.go).
  private static func bubble(from message: [String: Any]) -> Bubble? {
    guard let id = (message["id"] as? NSNumber)?.int64Value else {
      return nil
    }
    let mine = (message["is_mine"] as? Bool) ?? false
    let sender = message["sender_name"] as? String
    let kind = (message["kind"] as? String) ?? "text"
    let body = ((message["body"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

    if (message["deleted"] as? Bool) == true {
      return Bubble(id: id, mine: mine, sender: sender, text: "Message deleted", system: false, pending: false)
    }
    if kind == "system" {
      return Bubble(id: id, mine: false, sender: nil, text: body, system: true, pending: false)
    }
    if kind == "payment" {
      let amount = formatAmount(message["amount_sfluv_base"] as? String)
      let sent = mine ? "You sent \(amount) SFLUV" : "Sent you \(amount) SFLUV"
      return Bubble(id: id, mine: mine, sender: sender, text: body.isEmpty ? sent : "\(sent) · \(body)", system: false, pending: false)
    }
    let attachments = (message["attachments"] as? [[String: Any]]) ?? []
    if !attachments.isEmpty {
      let label = attachmentLabel(attachments)
      return Bubble(id: id, mine: mine, sender: sender, text: body.isEmpty ? label : "\(label) · \(body)", system: false, pending: false)
    }
    return Bubble(id: id, mine: mine, sender: sender, text: body, system: false, pending: false)
  }

  private static func attachmentLabel(_ attachments: [[String: Any]]) -> String {
    let kinds = attachments.map { ($0["kind"] as? String) ?? "" }
    let isVideo: ([String: Any]) -> Bool = {
      ($0["kind"] as? String) == "file" && ((($0["content_type"] as? String) ?? "").lowercased().hasPrefix("video/"))
    }
    if kinds.allSatisfy({ $0 == "image" || $0 == "file" }) {
      let images = kinds.filter { $0 == "image" }.count
      let videos = attachments.filter(isVideo).count
      let files = kinds.count - images - videos
      if files == 0 && videos == 0 { return images > 1 ? "📷 \(images) photos" : "📷 Photo" }
      if files == 0 && images == 0 { return videos > 1 ? "🎥 \(videos) videos" : "🎥 Video" }
      if files == 0 { return "📷 \(images + videos) photos and videos" }
      if images + videos == 0 { return files > 1 ? "📎 \(files) files" : "📎 File" }
      return "📎 \(kinds.count) attachments"
    }
    let first = attachments[0]
    switch kinds[0] {
    case "link": return "🔗 " + ((first["link_title"] as? String) ?? (first["link_site_name"] as? String) ?? "Link")
    case "transaction": return "🧾 Shared a transaction"
    case "merchant": return "📍 Shared " + ((first["location_name"] as? String) ?? "a merchant")
    case "event": return "📅 Shared " + ((first["event_title"] as? String) ?? "an event")
    default: return "Attachment"
    }
  }

  /// Base units to whole SFLUV: six decimals, shown to at most two.
  private static func formatAmount(_ base: String?) -> String {
    guard let base = base, let value = Double(base) else {
      return ""
    }
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = 2
    return formatter.string(from: NSNumber(value: value / 1_000_000)) ?? ""
  }
}
