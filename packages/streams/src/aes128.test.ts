import { describe, expect, it } from "vitest";
import { decryptAes128, hexToBytes, ivFromAttribute, sequenceToIv } from "./aes128";

describe("hexToBytes", () => {
  it("parseia com e sem prefixo 0x", () => {
    expect(Array.from(hexToBytes("0x00ff") ?? [])).toEqual([0, 255]);
    expect(Array.from(hexToBytes("00ff") ?? [])).toEqual([0, 255]);
  });

  it("rejeita tamanho ímpar", () => {
    expect(hexToBytes("abc")).toBeUndefined();
  });
});

describe("sequenceToIv", () => {
  it("coloca a sequência em big-endian no fim", () => {
    const iv = sequenceToIv(259);

    expect(iv).toHaveLength(16);
    expect(Array.from(iv.slice(12))).toEqual([0, 0, 1, 3]);
  });
});

describe("ivFromAttribute", () => {
  it("converte Uint32Array(4) em bytes big-endian", () => {
    const iv = ivFromAttribute(new Uint32Array([0, 0, 0, 1]), 9);

    expect(Array.from(iv)).toEqual([...new Array(15).fill(0), 1]);
  });

  it("aceita string hex e cai no IV da sequência se ausente", () => {
    expect(Array.from(ivFromAttribute("0x00ff", 0).slice(0, 2))).toEqual([0, 255]);
    expect(Array.from(ivFromAttribute(undefined, 5).slice(12))).toEqual([0, 0, 0, 5]);
  });
});

describe("decryptAes128", () => {
  it("descriptografa AES-CBC", async () => {
    const key = crypto.getRandomValues(new Uint8Array(16));
    const iv = sequenceToIv(1);
    const plaintext = new TextEncoder().encode("0123456789abcdef");
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key as unknown as Uint8Array<ArrayBuffer>,
      { name: "AES-CBC" },
      false,
      ["encrypt"],
    );
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-CBC", iv: iv as unknown as Uint8Array<ArrayBuffer> },
        cryptoKey,
        plaintext as unknown as Uint8Array<ArrayBuffer>,
      ),
    );

    const decrypted = await decryptAes128(cipher, key, iv);

    expect(new TextDecoder().decode(decrypted)).toBe("0123456789abcdef");
  });
});
