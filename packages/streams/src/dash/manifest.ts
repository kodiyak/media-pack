import type { StreamVariant } from "@repo/protocol";
import { XMLParser } from "fast-xml-parser";
import { asArray, asString, parseIsoDuration, positiveInt, resolveUrl } from "../util";

/** Metadados extraídos de um manifesto DASH (`.mpd`). */
export type DashManifestInfo = {
  variants?: StreamVariant[];
  container?: "ts" | "fmp4";
  live?: boolean;
  durationSeconds?: number;
};

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/** Lê um `.mpd` e devolve as representações de vídeo e a duração. */
export function parseDashManifest(xml: string, baseUrl: string): DashManifestInfo {
  const document = parser.parse(xml) as { MPD?: XmlNode };
  const mpd = document.MPD;
  if (!mpd) return {};

  const representations = collectRepresentations(mpd);
  const variants = representations
    .map((representation) => toVariant(representation, baseUrl))
    .filter((variant) => variant.bandwidth !== undefined || variant.height !== undefined);

  return {
    variants: variants.length > 0 ? variants : undefined,
    container: detectContainer(representations),
    live: asString(mpd["@_type"]) === "dynamic",
    durationSeconds: parseIsoDuration(asString(mpd["@_mediaPresentationDuration"])),
  };
}

function collectRepresentations(mpd: XmlNode): XmlNode[] {
  const representations: XmlNode[] = [];

  for (const period of asArray(mpd.Period as XmlNode | XmlNode[] | undefined)) {
    for (const adaptation of asArray(period.AdaptationSet as XmlNode | XmlNode[] | undefined)) {
      const contentType = asString(adaptation["@_contentType"]) ?? "";
      const mimeType = asString(adaptation["@_mimeType"]) ?? "";
      if (contentType !== "video" && !mimeType.startsWith("video/")) continue;

      representations.push(
        ...asArray(adaptation.Representation as XmlNode | XmlNode[] | undefined),
      );
    }
  }

  return representations;
}

function toVariant(representation: XmlNode, baseUrl: string): StreamVariant {
  const height = positiveInt(representation["@_height"]);
  const variantBase = asString(representation.BaseURL);

  return {
    url: variantBase ? resolveUrl(variantBase, baseUrl) : undefined,
    bandwidth: positiveInt(representation["@_bandwidth"]),
    width: positiveInt(representation["@_width"]),
    height,
    codecs: asString(representation["@_codecs"]),
    label: height ? `${height}p` : undefined,
  };
}

function detectContainer(representations: XmlNode[]): "fmp4" | undefined {
  if (representations.length === 0) return undefined;
  const isWebm = representations.some((representation) =>
    (asString(representation["@_mimeType"]) ?? "").includes("webm"),
  );
  return isWebm ? undefined : "fmp4";
}
