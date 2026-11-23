import Foundation

/// The reply sheet's own words, in the app's languages.
///
/// The extension runs outside the app and can't read the language picked in
/// Settings, so it follows the phone's language, falling back to English for
/// one the app doesn't offer. The wording is the app's own: each entry is the
/// value of the matching key in src/i18n/locales/<language>.json (messages.*,
/// chat.messageWasDeleted, components.messageAttachmentCard.attachment), with
/// {{count}} written {count}. Change one there, change it here.
enum Strings {
  static let language: String = {
    for preferred in Locale.preferredLanguages {
      let code = preferred.lowercased()
      if code.hasPrefix("en") { return "en" }
      if code.hasPrefix("es") { return "es" }
      if code.hasPrefix("vi") { return "vi" }
      if code.hasPrefix("ar") { return "ar" }
      // The app offers Traditional Chinese only; Simplified readers can read it.
      if code.hasPrefix("zh") { return "zh-Hant" }
    }
    return "en"
  }()

  static func text(_ key: String) -> String {
    table[language]?[key] ?? table["en"]?[key] ?? key
  }

  /// A counted label, in the plural form the language uses for `n`.
  static func count(_ key: String, _ n: Int) -> String {
    let forms = table[language] ?? [:]
    let english = table["en"] ?? [:]
    let value = forms["\(key)_\(category(n))"] ?? forms["\(key)_other"]
      ?? english["\(key)_\(n == 1 ? "one" : "other")"] ?? key
    return value.replacingOccurrences(of: "{count}", with: NumberFormatter.localizedString(from: NSNumber(value: n), number: .decimal))
  }

  /// CLDR plural categories for the app's languages.
  private static func category(_ n: Int) -> String {
    switch language {
    case "zh-Hant", "vi":
      return "other"
    case "ar":
      if n == 0 { return "zero" }
      if n == 1 { return "one" }
      if n == 2 { return "two" }
      if (3...10).contains(n % 100) { return "few" }
      if (11...99).contains(n % 100) { return "many" }
      return "other"
    default:
      return n == 1 ? "one" : "other"
    }
  }

  private static let table: [String: [String: String]] = [
    "en": [
      "messageDeleted": "Message was deleted",
      "youSent": "You sent {amount}",
      "sentYou": "Sent you {amount}",
      "photo": "📷 Photo",
      "video": "🎥 Video",
      "file": "File",
      "link": "Link",
      "attachment": "Attachment",
      "sharedTransaction": "🧾 Shared a transaction",
      "sharedPlace": "📍 Shared {name}",
      "sharedEvent": "📅 Shared {name}",
      "aMerchant": "a merchant",
      "anEvent": "an event",
      "photosCount_one": "📷 {count} photo",
      "photosCount_other": "📷 {count} photos",
      "videosCount_one": "🎥 {count} video",
      "videosCount_other": "🎥 {count} videos",
      "photosAndVideos_one": "📷 {count} photo or video",
      "photosAndVideos_other": "📷 {count} photos and videos",
      "filesCount_one": "📎 {count} file",
      "filesCount_other": "📎 {count} files",
      "attachmentsCount_one": "📎 {count} attachment",
      "attachmentsCount_other": "📎 {count} attachments",
    ],
    "es": [
      "messageDeleted": "Se eliminó el mensaje",
      "youSent": "Usted envió {amount}",
      "sentYou": "Le envió {amount}",
      "photo": "📷 Foto",
      "video": "🎥 Video",
      "file": "Archivo",
      "link": "Enlace",
      "attachment": "Adjunto",
      "sharedTransaction": "🧾 Compartió una transacción",
      "sharedPlace": "📍 Compartió {name}",
      "sharedEvent": "📅 Compartió {name}",
      "aMerchant": "un comercio",
      "anEvent": "un evento",
      "photosCount_one": "📷 {count} foto",
      "photosCount_other": "📷 {count} fotos",
      "videosCount_one": "🎥 {count} video",
      "videosCount_other": "🎥 {count} videos",
      "photosAndVideos_one": "📷 {count} foto o video",
      "photosAndVideos_other": "📷 {count} fotos y videos",
      "filesCount_one": "📎 {count} archivo",
      "filesCount_other": "📎 {count} archivos",
      "attachmentsCount_one": "📎 {count} adjunto",
      "attachmentsCount_other": "📎 {count} adjuntos",
    ],
    "zh-Hant": [
      "messageDeleted": "訊息已被刪除",
      "youSent": "您已傳送 {amount}",
      "sentYou": "向您傳送了 {amount}",
      "photo": "📷 相片",
      "video": "🎥 影片",
      "file": "檔案",
      "link": "連結",
      "attachment": "附件",
      "sharedTransaction": "🧾 分享了一項交易",
      "sharedPlace": "📍 分享了{name}",
      "sharedEvent": "📅 分享了{name}",
      "aMerchant": "一間商戶",
      "anEvent": "一個活動",
      "photosCount_other": "📷 {count} 張相片",
      "videosCount_other": "🎥 {count} 段影片",
      "photosAndVideos_other": "📷 {count} 張相片及影片",
      "filesCount_other": "📎 {count} 個檔案",
      "attachmentsCount_other": "📎 {count} 個附件",
    ],
    "vi": [
      "messageDeleted": "Tin nhắn đã bị xóa",
      "youSent": "Bạn đã gửi {amount}",
      "sentYou": "Đã gửi cho bạn {amount}",
      "photo": "📷 Ảnh",
      "video": "🎥 Video",
      "file": "Tệp",
      "link": "Liên kết",
      "attachment": "Tệp đính kèm",
      "sharedTransaction": "🧾 Đã chia sẻ một giao dịch",
      "sharedPlace": "📍 Đã chia sẻ {name}",
      "sharedEvent": "📅 Đã chia sẻ {name}",
      "aMerchant": "một cửa hàng",
      "anEvent": "một sự kiện",
      "photosCount_other": "📷 {count} ảnh",
      "videosCount_other": "🎥 {count} video",
      "photosAndVideos_other": "📷 {count} ảnh và video",
      "filesCount_other": "📎 {count} tệp",
      "attachmentsCount_other": "📎 {count} tệp đính kèm",
    ],
    "ar": [
      "messageDeleted": "حُذفت الرسالة",
      "youSent": "أرسلت {amount}",
      "sentYou": "أرسل إليك {amount}",
      "photo": "📷 صورة",
      "video": "🎥 فيديو",
      "file": "ملف",
      "link": "رابط",
      "attachment": "مرفق",
      "sharedTransaction": "🧾 شارك معاملة",
      "sharedPlace": "📍 شارك {name}",
      "sharedEvent": "📅 شارك {name}",
      "aMerchant": "تاجر",
      "anEvent": "فعالية",
      "photosCount_two": "📷 صورتان",
      "photosCount_few": "📷 {count} صور",
      "photosCount_other": "📷 {count} صورة",
      "videosCount_two": "🎥 فيديوهان",
      "videosCount_few": "🎥 {count} فيديوهات",
      "videosCount_other": "🎥 {count} فيديو",
      "photosAndVideos_one": "📷 صورة أو فيديو واحد",
      "photosAndVideos_two": "📷 صورتان أو فيديوهان",
      "photosAndVideos_few": "📷 {count} صور وفيديوهات",
      "photosAndVideos_other": "📷 {count} صورة وفيديو",
      "filesCount_one": "📎 ملف واحد",
      "filesCount_two": "📎 ملفان",
      "filesCount_few": "📎 {count} ملفات",
      "filesCount_other": "📎 {count} ملف",
      "attachmentsCount_one": "📎 مرفق واحد",
      "attachmentsCount_two": "📎 مرفقان",
      "attachmentsCount_few": "📎 {count} مرفقات",
      "attachmentsCount_other": "📎 {count} مرفق",
    ],
  ]
}
