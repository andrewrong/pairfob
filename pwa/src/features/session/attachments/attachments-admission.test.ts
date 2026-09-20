/**
 * Pure tests for the two admission budgets in attachments-admission.ts:
 *  - LOCAL intake (picker/retained source): JPEG 40 MiB, other 20 MiB,
 *    batch 80 MiB, 5 files; existing rows reserve ORIGINAL bytes;
 *  - FINAL network admission: 20 MiB per prepared file, 40 MiB cumulative
 *    ACTUAL bytes (current prepared + other committed + retained checkpoints),
 *    never unprepared queued-source estimates.
 *
 * These exercise only the frozen helper surface; identity dedup (File
 * references) belongs to the controller and is deliberately asserted here as
 * NOT happening at the metadata layer.
 */
import { describe, expect, test } from "bun:test";
import {
  LOCAL_INTAKE_BATCH_BYTES,
  LOCAL_INTAKE_DEFAULT_FILE_BYTES,
  LOCAL_INTAKE_JPEG_FILE_BYTES,
  LOCAL_INTAKE_MAX_FILES,
  FINAL_MAX_BATCH_BYTES,
  FINAL_MAX_FILE_BYTES,
  exceedsFinalFileLimit,
  finalAdmissionAllowed,
  finalAdmissionBytes,
  isJpegCandidate,
  resumeAdmissionBytes,
  reviewLocalIncoming,
  sum,
} from "./attachments-admission.ts";
import type { AttachmentItem, IncomingMeta } from "./attach-model.ts";

const MiB = 1024 * 1024;

function meta(name: string, size: number, mime = "application/octet-stream"): IncomingMeta {
  return { name, size, mime };
}

function jpeg(name: string, size: number): IncomingMeta {
  return meta(name, size, "image/jpeg");
}

let itemSeq = 0;

/** Existing rows only need the byte fields the reviewer reads. */
function existingRow(
  bytes: { size: number; originalBytes?: number },
  extra?: Partial<AttachmentItem>,
): AttachmentItem {
  itemSeq += 1;
  return {
    localId: `att_existing_${itemSeq}`,
    kind: "file",
    name: `existing-${itemSeq}.bin`,
    size: bytes.size,
    mime: "application/octet-stream",
    status: "queued",
    acknowledged: 0,
    errorText: "",
    recoverable: false,
    path: "",
    inserted: false,
    editNote: "",
    cancelIntent: false,
    ...(bytes.originalBytes !== undefined ? { originalBytes: bytes.originalBytes } : {}),
    ...extra,
  };
}

function names(result: { accepted: readonly IncomingMeta[] }): string[] {
  return result.accepted.map((m) => m.name);
}

describe("isJpegCandidate", () => {
  test("recognizes image/jpeg MIME and .jpg/.jpeg extensions, nothing else", () => {
    expect(isJpegCandidate(jpeg("a", 1))).toBe(true);
    expect(isJpegCandidate(meta("photo.JPG", 1, ""))).toBe(true);
    expect(isJpegCandidate(meta("photo.jpeg", 1, "application/octet-stream"))).toBe(true);
    expect(isJpegCandidate(meta("a.png", 1, "image/png"))).toBe(false);
    expect(isJpegCandidate(meta("a.bin", 1))).toBe(false);
    expect(isJpegCandidate(meta("a.jpgx", 1))).toBe(false);
  });
});

describe("local intake — per-file caps", () => {
  test("JPEG candidates of 21 MiB and exactly 40 MiB are accepted", () => {
    const result = reviewLocalIncoming(
      [jpeg("big-21.jpg", 21 * MiB), jpeg("big-40.jpg", LOCAL_INTAKE_JPEG_FILE_BYTES)],
      [],
    );
    expect(result.rejected).toEqual([]);
    expect(names(result)).toEqual(["big-21.jpg", "big-40.jpg"]); // 61 MiB <= 80 batch
  });

  test("a JPEG over 40 MiB is rejected fileTooLarge even as the only file", () => {
    const result = reviewLocalIncoming([jpeg("too-big.jpg", LOCAL_INTAKE_JPEG_FILE_BYTES + 1)], []);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ name: "too-big.jpg", code: "fileTooLarge" }]);
  });

  test("a non-JPEG at exactly 20 MiB is accepted, over 20 MiB rejected", () => {
    const atCap = reviewLocalIncoming([meta("ok.bin", LOCAL_INTAKE_DEFAULT_FILE_BYTES)], []);
    expect(names(atCap)).toEqual(["ok.bin"]);

    const over = reviewLocalIncoming([meta("big.bin", LOCAL_INTAKE_DEFAULT_FILE_BYTES + 1)], []);
    expect(over.rejected).toEqual([{ name: "big.bin", code: "fileTooLarge" }]);

    // PNG is an "other" file for intake regardless of being an image.
    const png = reviewLocalIncoming([meta("big.png", 21 * MiB, "image/png")], []);
    expect(png.rejected).toEqual([{ name: "big.png", code: "fileTooLarge" }]);
  });
});

describe("local intake — 80 MiB batch boundary and count of 5", () => {
  test("the batch is inclusive at exactly 80 MiB and rejects byte 80 MiB + 1", () => {
    const sixty = [existingRow({ size: 20 * MiB }), existingRow({ size: 20 * MiB }), existingRow({ size: 20 * MiB })];
    const fits = reviewLocalIncoming([meta("fourth.bin", 20 * MiB)], sixty);
    expect(names(fits)).toEqual(["fourth.bin"]); // 60 + 20 === 80

    const eighty = [
      existingRow({ size: 20 * MiB }),
      existingRow({ size: 20 * MiB }),
      existingRow({ size: 20 * MiB }),
      existingRow({ size: 20 * MiB }),
    ];
    const over = reviewLocalIncoming([meta("fifth-byte.bin", 1)], eighty);
    expect(over.rejected).toEqual([{ name: "fifth-byte.bin", code: "batchTooLarge" }]);
  });

  test("at most 5 files: a 6th is rejected even when bytes are trivial", () => {
    const five = Array.from({ length: 5 }, () => existingRow({ size: 1 }));
    const sixth = reviewLocalIncoming([meta("sixth.bin", 1)], five);
    expect(sixth.rejected).toEqual([{ name: "sixth.bin", code: "tooManyFiles" }]);

    // Four existing + two new: the 5th slot is used, the 6th rejected.
    const four = Array.from({ length: 4 }, () => existingRow({ size: 1 }));
    const pair = reviewLocalIncoming([meta("fifth.bin", 1), meta("sixth.bin", 1)], four);
    expect(names(pair)).toEqual(["fifth.bin"]);
    expect(pair.rejected).toEqual([{ name: "sixth.bin", code: "tooManyFiles" }]);
    expect(LOCAL_INTAKE_MAX_FILES).toBe(5);
    expect(LOCAL_INTAKE_BATCH_BYTES).toBe(80 * MiB);
  });
});

describe("local intake — existing rows reserve ORIGINAL bytes", () => {
  test("compressed image rows reserve originalBytes, not their shrunken size", () => {
    // Four 21 MiB sources compressed to 1 MiB: 84 MiB of retained source.
    const compressed = Array.from({ length: 4 }, () =>
      existingRow({ size: MiB, originalBytes: 21 * MiB }, { kind: "image" }));
    const anyFile = reviewLocalIncoming([meta("one-byte.bin", 1)], compressed);
    // Counted from size it would be 4 MiB + 1; reserved source rejects it.
    expect(anyFile.rejected).toEqual([{ name: "one-byte.bin", code: "batchTooLarge" }]);

    // The same rows WITHOUT originalBytes reserve their actual (1 MiB) size,
    // so a 20 MiB file fits (4 MiB + 20 MiB, 5 files total).
    const shrunkedNoOriginal = Array.from({ length: 4 }, () => existingRow({ size: MiB }));
    const fits = reviewLocalIncoming([meta("twenty.bin", 20 * MiB)], shrunkedNoOriginal);
    expect(names(fits)).toEqual(["twenty.bin"]);
  });

  test("reservation is max(originalBytes, size): a larger current size still counts", () => {
    // Eight rows whose size (9 MiB) exceeds their stale originalBytes (3 MiB)
    // reserve 72 MiB; a 9 MiB pick trips the batch (81 > 80). Counting
    // originalBytes (24 MiB) would wrongly accept it (and hit the count check
    // instead, which runs after the batch check).
    const rows = Array.from({ length: 8 }, () => existingRow({ size: 9 * MiB, originalBytes: 3 * MiB }));
    const result = reviewLocalIncoming([meta("nine.bin", 9 * MiB)], rows);
    expect(result.rejected).toEqual([{ name: "nine.bin", code: "batchTooLarge" }]);
  });
});

describe("local intake — metadata never establishes identity", () => {
  test("repeated identical name/size entries are both accepted; dedup is the controller's job", () => {
    const result = reviewLocalIncoming(
      [meta("same.bin", 5 * MiB), meta("same.bin", 5 * MiB), jpeg("same.jpg", 5 * MiB)],
      [],
    );
    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toEqual([]);
  });
});

describe("final admission — per-file ACTUAL limit", () => {
  test("prepared bytes at exactly 20 MiB are allowed; byte 20 MiB + 1 rejected", () => {
    expect(exceedsFinalFileLimit(FINAL_MAX_FILE_BYTES)).toBe(false);
    expect(exceedsFinalFileLimit(FINAL_MAX_FILE_BYTES + 1)).toBe(true);
    expect(exceedsFinalFileLimit(MiB)).toBe(false);
    expect(FINAL_MAX_FILE_BYTES).toBe(20 * MiB);
  });

  test("a 21 MiB JPEG source prepared down to 20 MiB actual passes the file cap", () => {
    // The cap applies to prepared upload bytes, not the retained source.
    expect(exceedsFinalFileLimit(20 * MiB)).toBe(false);
  });
});

describe("final admission — cumulative ACTUAL batch of 40 MiB inclusive", () => {
  test("current + committed + retained checkpoints each contribute exactly once", () => {
    const args = {
      currentBytes: 7 * MiB,
      committedActual: [11 * MiB, 13 * MiB],
      checkpointActual: [9 * MiB],
    };
    expect(finalAdmissionBytes(args)).toBe(40 * MiB);
    expect(finalAdmissionAllowed(args)).toBe(true);

    const over = { ...args, currentBytes: 7 * MiB + 1 };
    expect(finalAdmissionAllowed(over)).toBe(false);
    expect(FINAL_MAX_BATCH_BYTES).toBe(40 * MiB);
    expect(sum([])).toBe(0);
  });

  test("a 40 MiB committed row plus any retained checkpoint byte blocks a new start", () => {
    const args = { currentBytes: 1, committedActual: [40 * MiB], checkpointActual: [] };
    expect(finalAdmissionAllowed(args)).toBe(false);
    expect(finalAdmissionBytes(args)).toBe(40 * MiB + 1);
  });

  test("zero current bytes before preparation never reserves queued source bytes", () => {
    // Queued 21 MiB JPEG sources are invisible to final admission until they
    // resolve to a prepared actual size.
    const idle = { currentBytes: 0, committedActual: [], checkpointActual: [] };
    expect(finalAdmissionBytes(idle)).toBe(0);
    expect(finalAdmissionAllowed(idle)).toBe(true);
  });
});

describe("final admission — resume excludes its own checkpoint (caller side)", () => {
  test("resumeAdmissionBytes sums current bytes plus only OTHER rows", () => {
    // The resuming row's own retained checkpoint is 30 MiB; the caller omits
    // it from checkpointActual and passes the row's current (remaining
    // actual) bytes explicitly. Other committed 5 MiB + other checkpoint 0.
    const bytes = resumeAdmissionBytes(30 * MiB, [5 * MiB], []);
    expect(bytes).toBe(35 * MiB);
    expect(bytes <= FINAL_MAX_BATCH_BYTES).toBe(true);

    // Another retained checkpoint on a DIFFERENT row still counts.
    expect(resumeAdmissionBytes(30 * MiB, [5 * MiB], [6 * MiB])).toBe(41 * MiB);
  });
});

describe("final admission — three 21 MiB JPEGs that prepare to 1 MiB each", () => {
  test("every sequential network start fits: actual totals 1, 2, 3 MiB, never queued estimates", () => {
    // Local intake accepts all three sources up front (63 MiB <= 80, each
    // within the 40 MiB JPEG cap).
    const intake = reviewLocalIncoming(
      [jpeg("a.jpg", 21 * MiB), jpeg("b.jpg", 21 * MiB), jpeg("c.jpg", 21 * MiB)],
      [],
    );
    expect(intake.accepted).toHaveLength(3);

    // Network starts happen only AFTER each prepare resolves. Earlier rows
    // are committed by then, so only real byte counts ever enter the sum:
    // counting queued sources would read 21/42/63 and falsely reject.
    const committedActual: number[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      const decision = finalAdmissionAllowed({
        currentBytes: MiB, // this job's freshly prepared size
        committedActual,
        checkpointActual: [],
      });
      expect(decision).toBe(true);
      committedActual.push(MiB);
    }
    expect(sum(committedActual)).toBe(3 * MiB);
  });
});
