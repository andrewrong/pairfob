import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Button } from "./button";
import { Chevron } from "./navigation";

type SelectionRowProps = Omit<ComponentPropsWithoutRef<"button">, "children" | "title"> & {
  title: ReactNode;
  description?: ReactNode;
  selected?: boolean;
  leading?: ReactNode;
  titleLeading?: ReactNode;
  badge?: ReactNode;
};

/** Shared picker row; identity, status and the action remain owned by the caller. */
export function SelectionRow({ title, description, selected = false, leading, titleLeading, badge,
  className = "", ...props }: SelectionRowProps) {
  return <Button {...props} className={`switch-item${selected ? " on" : ""}${className ? ` ${className}` : ""}`}>
    {leading}
    <span className="switch-main">
      <span className="switch-head">{titleLeading}<span className="switch-name">{title}</span>{badge}</span>
      {description && <span className="switch-meta">{description}</span>}
    </span>
    <Chevron />
  </Button>;
}
