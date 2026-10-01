import { describe, expect, it } from "vitest";
import { deriveFilename, filenameFromContentDisposition, sanitizeFilename } from "./filename";

describe("filename", () => {
  it("prefere o filename* do content-disposition", () => {
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''foto%20legal.png")).toBe(
      "foto legal.png",
    );
  });

  it("lê filename simples entre aspas", () => {
    expect(filenameFromContentDisposition('attachment; filename="relatório final.pdf"')).toBe(
      "relatório final.pdf",
    );
  });

  it("adiciona extensão quando falta", () => {
    expect(
      deriveFilename({ url: "https://cdn.test/media", kind: "video", contentType: "video/mp4" }),
    ).toBe("media.mp4");
  });

  it("mantém a extensão existente", () => {
    expect(deriveFilename({ url: "https://cdn.test/photo.webp", kind: "image" })).toBe(
      "photo.webp",
    );
  });

  it("sanitiza caracteres inválidos", () => {
    expect(sanitizeFilename("a/b:c*d?.png")).toBe("a_b_c_d_.png");
  });
});
