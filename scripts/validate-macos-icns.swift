import AppKit
guard CommandLine.arguments.count == 4 else { fatalError("usage: renderer ICNS SOURCE_DIR OUTPUT_DIR") }
let icns = CommandLine.arguments[1]
let source = CommandLine.arguments[2]
let output = CommandLine.arguments[3]
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
func render(_ path: String, _ name: String, _ logical: Int, _ scale: Int) throws {
    guard let image = NSImage(contentsOfFile: path) else { fatalError("Cannot load \(path)") }
    let px = logical * scale
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bitmapFormat: [], bytesPerRow: px * 4, bitsPerPixel: 32)!
    bitmap.size = NSSize(width: logical, height: logical)
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    // bitmap.size establishes the backing scale; applying another scale doubles it.
    precondition(context.cgContext.ctm.a == CGFloat(scale))
    context.imageInterpolation = .none
    let rect = NSRect(x: 0, y: 0, width: logical, height: logical)
    let best = image.bestRepresentation(for: rect, context: context, hints: nil)
    print("\(name) target=\(logical)pt@\(scale)x backing=\(px)px selected=\(best?.pixelsWide ?? -1)x\(best?.pixelsHigh ?? -1) logical=\(String(describing: best?.size))")
    image.draw(in: rect, from: .zero, operation: .copy, fraction: 1, respectFlipped: false, hints: nil)
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output + "/" + name + ".png"))
}
for (logical,scale) in [(16,1),(16,2),(32,1),(32,2),(128,1)] {
    let key = "\(logical)@\(scale)x"
    try render(icns, "candidate-" + key, logical, scale)
    try render(source + "/app-\(logical*scale).png", "source-" + key, logical, scale)
}
