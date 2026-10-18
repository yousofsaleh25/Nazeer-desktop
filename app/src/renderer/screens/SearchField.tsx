/** A list's text filter (History's tabs): typing waits 300 ms before the list is asked again. */
import { useEffect, useEffectEvent, useState } from "react";
import type { BiText } from "@/components/ui/Bi";
import { Field, Input } from "@/components/ui/Field";
import { messagePair } from "@/i18n/t";

export function SearchField({
  value,
  onSearch,
  label = messagePair("history.search"),
  type = "search",
  className = "min-w-56 flex-1",
}: {
  value: string;
  onSearch: (q: string) => void;
  label?: BiText;
  /** "search" for the tab's one search box; "text" for a narrower filter beside it */
  type?: "search" | "text";
  className?: string;
}) {
  const [text, setText] = useState(value);
  const search = useEffectEvent((q: string) => onSearch(q));
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => search(text), 300);
    return () => clearTimeout(timer);
  }, [text, value]);
  return (
    <Field label={label} className={className}>
      <Input
        type={type}
        value={text}
        dir="auto"
        onChange={(event) => setText(event.target.value)}
        placeholder="…"
      />
    </Field>
  );
}
