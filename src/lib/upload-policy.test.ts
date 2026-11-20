import { describe, expect, it } from "vitest";
import {
  ALLOWED_UPLOAD_TYPES,
  UPLOAD_ACCEPT,
  allowedExtensionList,
  isTrustedDriveLink,
  resolveUploadType,
  sanitizeMimeType,
} from "./upload-policy";

describe("resolveUploadType", () => {
  it("maps the advertised extensions to their canonical MIME type", () => {
    expect(resolveUploadType("notes.pdf")).toEqual({ extension: "pdf", mimeType: "application/pdf" });
    expect(resolveUploadType("paper.DOCX")).toEqual({
      extension: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(resolveUploadType("scan.JPG")?.mimeType).toBe("image/jpeg");
  });

  it("rejects everything else, including things a browser would happily upload", () => {
    for (const name of ["setup.exe", "page.html", "icon.svg", "script.js", "archive.zip", "noext", ".pdf"]) {
      expect(resolveUploadType(name), name).toBeNull();
    }
  });

  it("keeps the accept attribute in sync with the allowlist", () => {
    const fromAccept = UPLOAD_ACCEPT.split(",")
      .map((token) => token.replace(".", ""))
      .sort();
    expect(fromAccept).toEqual(Object.keys(ALLOWED_UPLOAD_TYPES).sort());
    for (const extension of fromAccept) {
      expect(resolveUploadType(`file.${extension}`), extension).not.toBeNull();
    }
  });

  it("lists the formats for error copy", () => {
    expect(allowedExtensionList()).toContain("PDF");
    expect(allowedExtensionList()).toContain("WEBP");
  });
});

describe("sanitizeMimeType", () => {
  it("keeps a valid type", () => {
    expect(sanitizeMimeType("application/pdf")).toBe("application/pdf");
    expect(sanitizeMimeType("IMAGE/PNG")).toBe("image/png");
  });

  it("strips CRLF so header injection is impossible", () => {
    const injected = "application/pdf\r\nContent-Disposition: attachment; filename=evil.exe";
    const cleaned = sanitizeMimeType(injected);
    expect(cleaned).not.toMatch(/[\r\n]/);
    expect(cleaned).toBe("application/octet-stream");
  });

  it("degrades unknown or malformed input instead of throwing", () => {
    for (const value of ["", null, undefined, "not-a-mime", "text/plain; charset=utf-8", "  "]) {
      expect(sanitizeMimeType(value)).toBe("application/octet-stream");
    }
  });
});

describe("isTrustedDriveLink", () => {
  it("accepts Drive and Docs https links", () => {
    expect(isTrustedDriveLink("https://drive.google.com/file/d/abc123/view")).toBe(true);
    expect(isTrustedDriveLink("https://docs.google.com/document/d/abc123/edit")).toBe(true);
    expect(isTrustedDriveLink("  https://drive.google.com/open?id=abc123  ")).toBe(true);
  });

  it("rejects other hosts, schemes and lookalikes", () => {
    for (const link of [
      "http://drive.google.com/file/d/abc",
      "https://drive.google.com.evil.example/file",
      "https://evil.example/drive.google.com",
      "https://google.com/file",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isTrustedDriveLink(link), link).toBe(false);
    }
  });
});
