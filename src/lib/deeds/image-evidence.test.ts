import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertImageRefOwnedBy,
  buildPendingImagePath,
  detectDeedImageMimeFromBytes,
  parsePendingImagePath,
  validateDeedImageFile,
} from "./image-evidence";

const profileId = "11111111-1111-4111-8111-111111111111";
const deedId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";

describe("image evidence paths", () => {
  it("builds and parses pending paths", () => {
    const path = buildPendingImagePath({
      profileId,
      deedId,
      objectId,
      mime: "image/jpeg",
    });
    assert.equal(
      path,
      `pending/${profileId}/${deedId}/${objectId}.jpg`,
    );
    const parsed = parsePendingImagePath(path);
    assert.ok(parsed);
    assert.equal(parsed?.profileId, profileId);
    assert.equal(parsed?.deedId, deedId);
  });

  it("rejects path traversal and foreign ownership", () => {
    assert.equal(parsePendingImagePath("../etc/passwd"), null);
    assert.equal(parsePendingImagePath("public/x.jpg"), null);
    assert.throws(() =>
      assertImageRefOwnedBy(
        `pending/${profileId}/${deedId}/${objectId}.jpg`,
        "44444444-4444-4444-8444-444444444444",
        deedId,
      ),
    );
  });
});

describe("image file validation", () => {
  it("accepts jpeg/png/webp signatures", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);

    assert.equal(detectDeedImageMimeFromBytes(jpeg), "image/jpeg");
    assert.equal(detectDeedImageMimeFromBytes(png), "image/png");
    assert.equal(detectDeedImageMimeFromBytes(webp), "image/webp");

    assert.equal(
      validateDeedImageFile({
        mimeReported: "image/jpeg",
        sizeBytes: jpeg.length,
        bytes: jpeg,
      }).ok,
      true,
    );
  });

  it("rejects svg, oversized, empty, mismatch", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(
      validateDeedImageFile({
        mimeReported: "image/svg+xml",
        sizeBytes: 12,
        bytes: jpeg,
      }).ok,
      false,
    );
    assert.equal(
      validateDeedImageFile({
        mimeReported: "image/jpeg",
        sizeBytes: 0,
        bytes: new Uint8Array(),
      }).ok,
      false,
    );
    assert.equal(
      validateDeedImageFile({
        mimeReported: "image/png",
        sizeBytes: jpeg.length,
        bytes: jpeg,
      }).ok,
      false,
    );
    assert.equal(
      validateDeedImageFile({
        mimeReported: "image/jpeg",
        sizeBytes: 6 * 1024 * 1024,
        bytes: jpeg,
      }).ok,
      false,
    );
  });
});
