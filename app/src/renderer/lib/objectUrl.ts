/**
 * A `blob:` URL for bytes the app holds (the verified overlay), revoked when the bytes change or
 * the component unmounts. The page shows exactly those bytes, not a second download.
 */
import { useEffect, useMemo } from "react";

export function useObjectUrl(bytes: Uint8Array<ArrayBuffer> | null, type: string): string | null {
  const url = useMemo(
    () => (bytes === null ? null : URL.createObjectURL(new Blob([bytes], { type }))),
    [bytes, type],
  );
  useEffect(
    () => () => {
      if (url !== null) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}
