import AppKit
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    fputs("Usage: create-app-icon.swift <glyph.png> <output.png>\n", stderr)
    exit(2)
}

let glyphURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2])
guard let glyph = NSImage(contentsOf: glyphURL) else {
    fputs("Could not load the HomeScope glyph.\n", stderr)
    exit(1)
}

let canvasSize = NSSize(width: 1024, height: 1024)
let icon = NSImage(size: canvasSize)
icon.lockFocus()
guard let context = NSGraphicsContext.current else {
    fputs("Could not create the icon drawing context.\n", stderr)
    exit(1)
}
context.imageInterpolation = .high
NSColor.clear.setFill()
NSRect(origin: .zero, size: canvasSize).fill()

let tileRect = NSRect(x: 62, y: 62, width: 900, height: 900)
let tile = NSBezierPath(roundedRect: tileRect, xRadius: 212, yRadius: 212)
NSColor(calibratedRed: 0.09, green: 0.20, blue: 0.16, alpha: 1).setFill()
tile.fill()

let border = NSBezierPath(roundedRect: tileRect.insetBy(dx: 2, dy: 2), xRadius: 210, yRadius: 210)
NSColor(calibratedRed: 0.20, green: 0.48, blue: 0.37, alpha: 0.55).setStroke()
border.lineWidth = 4
border.stroke()

let glyphSize = NSSize(width: 620, height: 620)
let tintedGlyph = NSImage(size: glyphSize)
tintedGlyph.lockFocus()
NSColor(calibratedRed: 0.41, green: 0.87, blue: 0.72, alpha: 1).setFill()
NSRect(origin: .zero, size: glyphSize).fill()
glyph.draw(
    in: NSRect(origin: .zero, size: glyphSize),
    from: NSRect(origin: .zero, size: glyph.size),
    operation: .destinationIn,
    fraction: 1
)
tintedGlyph.unlockFocus()

tintedGlyph.draw(
    in: NSRect(x: 202, y: 202, width: glyphSize.width, height: glyphSize.height),
    from: NSRect(origin: .zero, size: glyphSize),
    operation: .sourceOver,
    fraction: 1
)
icon.unlockFocus()

guard
    let tiff = icon.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
else {
    fputs("Could not encode the HomeScope app icon.\n", stderr)
    exit(1)
}

try png.write(to: outputURL, options: .atomic)
