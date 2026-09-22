import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Delete, type LucideIcon } from "lucide-react";
import type { KeySpec } from "./keys";

const KEY_ICONS: Readonly<Partial<Record<string, LucideIcon>>> = {
  up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight, backspace: Delete,
};

/** Keep terminal key values and text labels separate from their visual representation. */
export function KeyLabel({ spec }: { spec: KeySpec }) {
  const Icon = Object.hasOwn(KEY_ICONS, spec.key) ? KEY_ICONS[spec.key] : undefined;
  return Icon ? <Icon size={20} aria-hidden="true" /> : <>{spec.label ?? ""}</>;
}
