/** Utilitários AES-128 (CBC) para segmentos HLS criptografados. */

/** Descriptografa um segmento AES-128 (CBC/PKCS#7) com WebCrypto. */
export async function decryptAes128(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as Uint8Array<ArrayBuffer>,
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );

  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: iv as unknown as Uint8Array<ArrayBuffer> },
    cryptoKey,
    data as unknown as Uint8Array<ArrayBuffer>,
  );

  return new Uint8Array(plain);
}

/** Converte `0x0123…` / `0123…` em bytes. Retorna `undefined` se inválido. */
export function hexToBytes(value: string): Uint8Array | undefined {
  const clean = value.trim().replace(/^0x/i, "");
  if (clean.length === 0 || clean.length % 2 !== 0) return undefined;

  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(byte)) return undefined;
    bytes[index] = byte;
  }
  return bytes;
}

/** IV padrão do HLS: o número de sequência em 16 bytes big-endian. */
export function sequenceToIv(sequence: number): Uint8Array {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, sequence >>> 0);
  return iv;
}

/**
 * Normaliza o atributo `IV` do m3u8-parser (string hex ou `Uint32Array(4)`)
 * para 16 bytes big-endian, caindo no IV derivado da sequência se ausente.
 */
export function ivFromAttribute(value: unknown, sequence: number): Uint8Array {
  if (typeof value === "string") {
    return hexToBytes(value) ?? sequenceToIv(sequence);
  }
  if (value instanceof Uint32Array && value.length === 4) {
    return wordsToIv(value);
  }
  return sequenceToIv(sequence);
}

function wordsToIv(words: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < 4; index += 1) {
    view.setUint32(index * 4, words[index] ?? 0);
  }
  return bytes;
}
