import { forwardRef, useMemo, useRef } from "react";
import type { ITheme } from "@xterm/xterm";
import { Compiled, cssColor, runs } from "../lib/highlight";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  compiled: Compiled[];
  theme: ITheme;
  font: string;
  fontSize: number;
  placeholder?: string;
}

/**
 * Textarea con resaltado: el texto real es transparente y debajo se dibuja una copia
 * coloreada con el mismo motor que la terminal. Sin ajuste de línea, como un editor de config.
 */
export const CodeEditor = forwardRef<HTMLTextAreaElement, Props>(function CodeEditor(
  { value, onChange, onKeyDown, compiled, theme, font, fontSize, placeholder },
  ref,
) {
  const preRef = useRef<HTMLPreElement>(null);

  const highlighted = useMemo(
    () =>
      value.split("\n").map((line, li) => {
        const spans = runs(line, compiled);
        if (!spans.length) return <div key={li}>{line || " "}</div>;
        const parts: React.ReactNode[] = [];
        let pos = 0;
        spans.forEach(([s, e, i], k) => {
          if (s > pos) parts.push(line.slice(pos, s));
          const st = compiled[i].style;
          parts.push(
            <span
              key={k}
              style={{
                color: cssColor(st.color, theme),
                background: cssColor(st.bg, theme),
                fontWeight: st.bold ? 700 : undefined,
                fontStyle: st.italic ? "italic" : undefined,
                textDecoration: st.underline ? "underline" : undefined,
              }}
            >
              {line.slice(s, e)}
            </span>,
          );
          pos = e;
        });
        parts.push(line.slice(pos));
        return <div key={li}>{parts}</div>;
      }),
    [value, compiled, theme],
  );

  const shared: React.CSSProperties = {
    fontFamily: font,
    fontSize,
    lineHeight: 1.5,
    padding: "10px 12px",
    whiteSpace: "pre",
    tabSize: 4,
    margin: 0,
  };

  return (
    <div className="relative flex-1 min-h-0" style={{ background: theme.background }}>
      <pre
        ref={preRef}
        aria-hidden
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ ...shared, color: theme.foreground, fontWeight: 400 }}
      >
        {highlighted}
        {"\n"}
      </pre>
      <textarea
        ref={ref}
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (preRef.current) {
            preRef.current.scrollTop = e.currentTarget.scrollTop;
            preRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
        className="code-editor absolute inset-0 w-full h-full resize-none outline-none bg-transparent overflow-auto"
        style={{
          ...shared,
          color: "transparent",
          caretColor: String(theme.cursor ?? theme.foreground),
          WebkitTextFillColor: "transparent",
        }}
      />
    </div>
  );
});
