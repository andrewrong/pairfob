import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type ComponentType } from "react";
import { Button } from "./button";

type GroupProps = Omit<ComponentPropsWithoutRef<"div">, "role"> & {
  /** Menus commit on Enter/Space; moving focus must not close the sheet. */
  activation?: "automatic" | "manual";
};

/** One tab stop, arrow navigation and disabled-option skipping for segmented choices. */
export function SegmentedControl({ className = "", activation = "automatic", children, onKeyDown, ...props }: GroupProps) {
  const root = useRef<HTMLDivElement>(null);
  const radios = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [])]
    .filter(button => button.closest('[role="radiogroup"]') === root.current);
  useLayoutEffect(() => {
    const enabled = radios().filter(button => !button.disabled);
    const selected = enabled.find(button => button.getAttribute("aria-checked") === "true") ?? enabled[0];
    for (const button of radios()) {
      button.tabIndex = button === selected ? 0 : -1;
    }
  });
  return <div {...props} ref={root} className={`seg${className ? ` ${className}` : ""}`} role="radiogroup"
    onKeyDown={event => {
      onKeyDown?.(event);
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const enabled = radios().filter(button => !button.disabled);
      const current = enabled.indexOf(event.target as HTMLButtonElement);
      if (current < 0) return;
      const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
      let next: number;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = enabled.length - 1;
      else if (event.key === "ArrowDown" || event.key === (rtl ? "ArrowLeft" : "ArrowRight")) next = (current + 1) % enabled.length;
      else if (event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft")) next = (current + enabled.length - 1) % enabled.length;
      else return;
      event.preventDefault();
      for (const button of enabled) button.tabIndex = -1;
      const target = enabled[next];
      target.tabIndex = 0;
      target.focus();
      if (activation === "automatic" && target.getAttribute("aria-checked") !== "true") target.click();
    }}>{children}</div>;
}

type OptionProps = ComponentPropsWithoutRef<"button"> & {
  selected: boolean;
  /** Allows terminal controls to retain their native pointer/focus protection. */
  as?: ComponentType<ComponentPropsWithoutRef<"button">>;
};

export function SegmentedOption({ selected, as: Element = Button, className = "", ...props }: OptionProps) {
  return <Element {...props} type="button" className={`seg-item${selected ? " on" : ""}${className ? ` ${className}` : ""}`}
    role="radio" aria-checked={selected} tabIndex={selected && !props.disabled ? 0 : -1} />;
}
