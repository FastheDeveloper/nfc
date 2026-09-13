import CoreNFC
import ExpoModulesCore

/**
 * Turning a `NFCTag` into things that can cross the bridge.
 *
 * Extracted when the write session arrived and needed the same four
 * conversions the read session already had. Shared rather than duplicated
 * because a read and a write that disagree about what a tag's UID *is* would
 * be a genuinely horrible bug to chase.
 *
 * Everything here is deliberately boring. `Data` cannot cross into JavaScript,
 * so bytes become `[Int]` — the exact shape `lib/ndef.ts` already decodes.
 */
@available(iOS 13.0, *)
internal enum NfcTagInfo {
  /// Every tag family CoreNFC can hand us also conforms to `NFCNDEFTag`.
  static func ndefTag(from tag: NFCTag) -> NFCNDEFTag? {
    switch tag {
    case let .miFare(tag): return tag
    case let .iso7816(tag): return tag
    case let .iso15693(tag): return tag
    case let .feliCa(tag): return tag
    @unknown default: return nil
    }
  }

  /// Uppercase hex, no separators — matching what the app already displays.
  static func identifier(of tag: NFCTag) -> String {
    let data: Data
    switch tag {
    case let .miFare(tag): data = tag.identifier
    case let .iso7816(tag): data = tag.identifier
    case let .iso15693(tag): data = tag.identifier
    case let .feliCa(tag): data = tag.currentIDm
    @unknown default: data = Data()
    }
    return data.map { String(format: "%02X", $0) }.joined()
  }

  static func tech(of tag: NFCTag) -> String {
    switch tag {
    case .miFare: return "mifare"
    case .iso7816: return "iso7816"
    case .iso15693: return "iso15693"
    case .feliCa: return "felica"
    @unknown default: return "unknown"
    }
  }

  static func records(from message: NFCNDEFMessage?) -> [[String: Any]] {
    guard let message else { return [] }

    return message.records.map { record in
      [
        "tnf": Int(record.typeNameFormat.rawValue),
        "type": [UInt8](record.type).map(Int.init),
        "id": [UInt8](record.identifier).map(Int.init),
        "payload": [UInt8](record.payload).map(Int.init),
      ]
    }
  }

  /// Raw NDEF message bytes, for comparing a read-back against what we sent.
  static func rawBytes(of message: NFCNDEFMessage?) -> [Int] {
    guard let message else { return [] }
    return [UInt8](message.records.isEmpty ? Data() : encode(message)).map(Int.init)
  }

  /**
   * `NFCNDEFMessage` exposes no serialiser, so the bytes are rebuilt by hand.
   *
   * Only used for read-back verification, and only the short-record form is
   * emitted, because anything that fits on the tags this project writes to is
   * far under the 255-byte threshold. A longer message simply compares by
   * record content instead — see `NfcWriteSession`.
   */
  private static func encode(_ message: NFCNDEFMessage) -> Data {
    var out = Data()

    for (index, record) in message.records.enumerated() {
      var header = record.typeNameFormat.rawValue & 0x07
      if index == 0 { header |= 0x80 }
      if index == message.records.count - 1 { header |= 0x40 }

      let short = record.payload.count < 0xFF
      if short { header |= 0x10 }

      out.append(header)
      out.append(UInt8(record.type.count))

      if short {
        out.append(UInt8(record.payload.count))
      } else {
        let length = UInt32(record.payload.count)
        out.append(contentsOf: [
          UInt8((length >> 24) & 0xFF),
          UInt8((length >> 16) & 0xFF),
          UInt8((length >> 8) & 0xFF),
          UInt8(length & 0xFF),
        ])
      }

      out.append(record.type)
      out.append(record.payload)
    }

    return out
  }
}
