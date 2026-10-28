import Foundation

struct MrzTextLine {
  let text: String
  let x: Double
  let y: Double
  let height: Double
}

enum MrzCandidates {
  static func find(_ observations: [MrzTextLine]) -> String? {
    let lines = observations.map { line -> MrzTextLine in
      let clean = line.text.uppercased().filter { !$0.isWhitespace }
        .replacingOccurrences(of: "«", with: "<")
        .replacingOccurrences(of: "‹", with: "<")
        .replacingOccurrences(of: "›", with: "<")
        .replacingOccurrences(of: ">", with: "<")
      return MrzTextLine(text: clean, x: line.x, y: line.y, height: line.height)
    }.filter { (28...32).contains($0.text.count) }
      .sorted { $0.y > $1.y } // Vision coordinates start at the bottom left.
    guard lines.count >= 3 else { return nil }
    for index in 0...(lines.count - 3) {
      let group = Array(lines[index...(index + 2)])
      let prefix = group[0].text
      guard prefix.hasPrefix("IDCOL") || prefix.hasPrefix("ICCOL") || prefix.hasPrefix("1DCOL") || prefix.hasPrefix("1CCOL") else { continue }
      let h = max(group.map(\.height).max() ?? 0.01, 0.01)
      guard abs(group[0].x - group[1].x) < 0.20, abs(group[0].x - group[2].x) < 0.20,
        group[0].y - group[1].y < h * 5, group[1].y - group[2].y < h * 5 else { continue }
      return group.map(\.text).joined(separator: "\n")
    }
    return nil
  }
}
