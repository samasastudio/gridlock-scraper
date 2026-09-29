import { inflateRawSync } from "node:zlib";
import * as cheerio from "cheerio";

/**
 * Converts spreadsheet column letters (e.g. "A", "Z", "AA") to a 0-based column index.
 */
export function colLettersToIndex(col: string): number {
  let idx = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    idx = idx * 26 + (upper.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/**
 * Escapes a CSV field per RFC 4180 rules if it contains commas, quotes, or newlines.
 */
export function escapeCsvField(val: string): string {
  if (val.includes('"') || val.includes(",") || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Checks whether an input buffer or string has the ZIP archive magic signature (PK\x03\x04).
 */
export function isZipPayload(input: Buffer | string): boolean {
  if (Buffer.isBuffer(input)) {
    return (
      input.length >= 4 &&
      input[0] === 0x50 &&
      input[1] === 0x4b &&
      input[2] === 0x03 &&
      input[3] === 0x04
    );
  }
  return typeof input === "string" && input.startsWith("PK\x03\x04");
}

/**
 * Checks whether an input buffer or string has the OLE CFBF magic signature (\xD0\xCF\x11\xE0).
 */
export function isOlePayload(input: Buffer | string): boolean {
  if (Buffer.isBuffer(input)) {
    return (
      input.length >= 4 &&
      input[0] === 0xd0 &&
      input[1] === 0xcf &&
      input[2] === 0x11 &&
      input[3] === 0xe0
    );
  }
  return (
    typeof input === "string" &&
    input.length >= 4 &&
    input.charCodeAt(0) === 0xd0 &&
    input.charCodeAt(1) === 0xcf &&
    input.charCodeAt(2) === 0x11 &&
    input.charCodeAt(3) === 0xe0
  );
}

/**
 * Extracts all files from a standard ZIP archive buffer using Node's native inflateRawSync.
 */
export function extractZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();

  // 1. Locate End of Central Directory (EOCD)
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP archive: End of Central Directory record not found");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  let currentOffset = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(currentOffset) !== 0x02014b50) {
      break;
    }

    const compressionMethod = buffer.readUInt16LE(currentOffset + 10);
    const compressedSize = buffer.readUInt32LE(currentOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(currentOffset + 24);
    const fileNameLength = buffer.readUInt16LE(currentOffset + 28);
    const extraFieldLength = buffer.readUInt16LE(currentOffset + 30);
    const fileCommentLength = buffer.readUInt16LE(currentOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(currentOffset + 42);

    const fileName = buffer.toString(
      "utf8",
      currentOffset + 46,
      currentOffset + 46 + fileNameLength
    );

    if (buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;

      const compressedData = buffer.subarray(dataOffset, dataOffset + compressedSize);
      let fileData: Buffer;
      if (compressionMethod === 0) {
        fileData = compressedData.subarray(0, uncompressedSize);
      } else if (compressionMethod === 8) {
        fileData = inflateRawSync(compressedData);
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
      }

      entries.set(fileName.replace(/\\/g, "/"), fileData);
    }

    currentOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

/**
 * Pure parser that decompresses and converts an OpenXML spreadsheet (.xlsx) buffer into RFC 4180 CSV text.
 */
export function convertXlsxToCsv(input: Buffer | string): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "binary");
  const entries = extractZipEntries(buffer);

  // Parse shared strings table if present
  const sharedStrings: string[] = [];
  const sstEntry = entries.get("xl/sharedStrings.xml");
  if (sstEntry) {
    const $sst = cheerio.load(sstEntry.toString("utf8"), { xmlMode: true });
    $sst("si").each((_, si) => {
      sharedStrings.push($sst(si).text());
    });
  }

  // Find primary worksheet
  let sheetEntryName: string | undefined;
  for (const name of entries.keys()) {
    if (name.startsWith("xl/worksheets/sheet") && name.endsWith(".xml")) {
      sheetEntryName = name;
      break;
    }
  }

  if (!sheetEntryName) {
    throw new Error("No worksheet found in XLSX archive");
  }

  const sheetData = entries.get(sheetEntryName)!.toString("utf8");
  const $sheet = cheerio.load(sheetData, { xmlMode: true });
  const rows: string[] = [];

  $sheet("row").each((_, rowEl) => {
    const colMap = new Map<number, string>();
    let maxColIdx = -1;

    $sheet(rowEl)
      .find("c")
      .each((_, cellEl) => {
        const cellRef = $sheet(cellEl).attr("r") ?? "";
        const colLetters = cellRef.replace(/[0-9]/g, "");
        const colIdx = colLetters ? colLettersToIndex(colLetters) : -1;
        const cellType = $sheet(cellEl).attr("t");

        let cellVal = "";
        if (cellType === "s") {
          const sstIdx = parseInt($sheet(cellEl).find("v").text().trim(), 10);
          cellVal = Number.isFinite(sstIdx) ? (sharedStrings[sstIdx] ?? "") : "";
        } else if (cellType === "inlineStr") {
          cellVal = $sheet(cellEl).find("is t").text();
        } else {
          cellVal = $sheet(cellEl).find("v").text();
        }

        if (colIdx >= 0) {
          colMap.set(colIdx, cellVal);
          if (colIdx > maxColIdx) maxColIdx = colIdx;
        }
      });

    if (maxColIdx >= 0) {
      const fullRow: string[] = [];
      for (let i = 0; i <= maxColIdx; i++) {
        fullRow.push(colMap.get(i) ?? "");
      }
      rows.push(fullRow.map(escapeCsvField).join(","));
    }
  });

  return rows.join("\n");
}
