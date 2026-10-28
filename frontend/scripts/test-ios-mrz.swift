// Run by concatenating MrzCandidates.swift and this file into one Swift script.
let mrz = ["ICCOL1234567897<<<<<<<<<<<<<<<", "9001011F3012316COL1234567890<1", "PEREZ<GOMEZ<<LILI<ANA<<<<<<<<<"]
func line(_ text: String, _ y: Double, _ x: Double = 0.1, _ height: Double = 0.04) -> MrzTextLine {
  MrzTextLine(text: text, x: x, y: y, height: height)
}
let normal = [line(mrz[0], 0.6), line(mrz[1], 0.52), line(mrz[2], 0.44)]
assert(MrzCandidates.find(normal) == mrz.joined(separator: "\n"))
assert(MrzCandidates.find(normal.reversed()) == mrz.joined(separator: "\n"))
assert(MrzCandidates.find([]) == nil)
assert(MrzCandidates.find(Array(normal.prefix(2))) == nil)
assert(MrzCandidates.find([line("THIS IS NOT A DOCUMENT", 0.8)] + normal) == mrz.joined(separator: "\n"))
assert(MrzCandidates.find([line(mrz[0], 0.9), line(mrz[1], 0.4), line(mrz[2], 0.3)]) == nil)
assert(MrzCandidates.find([normal[0], line(mrz[1], 0.52, 0.7), normal[2]]) == nil)
let spaces = normal.map { line($0.text.map(String.init).joined(separator: " "), $0.y) }
assert(MrzCandidates.find(spaces) == mrz.joined(separator: "\n"))
let lower = normal.map { line($0.text.lowercased(), $0.y) }
assert(MrzCandidates.find(lower) == mrz.joined(separator: "\n"))
let chevrons = normal.map { line($0.text.replacingOccurrences(of: "<", with: "«"), $0.y) }
assert(MrzCandidates.find(chevrons) == mrz.joined(separator: "\n"))
// Candidate extraction must not invent a missing digit; strict JS validation rejects it.
let incomplete = [line(String(mrz[0].dropLast()), 0.6), normal[1], normal[2]]
assert(MrzCandidates.find(incomplete)?.split(separator: "\n").first?.count == 29)
print("11 native iOS MRZ candidate checks passed")
