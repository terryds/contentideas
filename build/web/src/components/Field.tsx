import type { CSSProperties, ReactNode } from "react";

export function Field({
  label,
  error,
  children,
  style,
}: {
  label: string;
  error?: string | null;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <label className="field" style={style}>
      <span>{label}</span>
      {children}
      {error ? <div className="field-error">{error}</div> : null}
    </label>
  );
}
