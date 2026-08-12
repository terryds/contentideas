import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  style,
  className = "",
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={`card ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
