import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  style,
  className = "",
  onClick,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div className={`card ${className}`.trim()} style={style} onClick={onClick}>
      {children}
    </div>
  );
}
