import { createHash } from "node:crypto";

const rawMarker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
const nsisMarker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// Tauri CLI 2.11.4 patches this marker for NSIS, then restores the raw EXE.
// https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle.rs
// Derive the exact expected unsigned packaged bytes; never mutate the build
// binary or tolerate unrelated changes in the extracted NSIS payload.
export function deriveNsisBinaryIdentity(rawBytes) {
  if (!Buffer.isBuffer(rawBytes) || rawBytes.length < 64 || rawBytes.readUInt16LE(0) !== 0x5a4d) throw new Error("Expected a raw Windows PE binary");
  const pe = rawBytes.readUInt32LE(0x3c);
  if (pe < 64 || pe + 24 > rawBytes.length || rawBytes.readUInt32LE(pe) !== 0x00004550) throw new Error("Invalid Windows PE header");
  const optional = pe + 24;
  const optionalSize = rawBytes.readUInt16LE(pe + 20);
  if (optionalSize < 152 || optional + optionalSize > rawBytes.length || rawBytes.readUInt16LE(pe + 4) !== 0x8664 || rawBytes.readUInt16LE(optional) !== 0x20b || rawBytes.readUInt16LE(optional + 68) !== 2) throw new Error("Expected Windows x64 GUI PE32+ binary");
  if (rawBytes.readUInt32LE(optional + 108) < 5) throw new Error("Missing PE certificate directory");
  if (rawBytes.readUInt32LE(optional + 144) !== 0 || rawBytes.readUInt32LE(optional + 148) !== 0) throw new Error("Authenticode-signed build requires a separate provenance method");
  const bundleMarkerOffset = rawBytes.indexOf(rawMarker);
  if (bundleMarkerOffset < 0 || rawBytes.indexOf(rawMarker, bundleMarkerOffset + 1) !== -1) throw new Error("Expected one unpatched Tauri bundle marker");
  const expected = Buffer.from(rawBytes);
  nsisMarker.copy(expected, bundleMarkerOffset);
  return {
    buildBinarySha256: sha256(rawBytes),
    binarySha256: sha256(expected),
    bundleType: "nsis",
    bundleMarkerOffset,
  };
}
