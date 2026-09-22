import { LoaderCircle } from "lucide-react";
/** Indeterminate progress mark. Decorative: the surrounding control owns the label. */
export function Spinner({ className = "" }: { className?: string }) {
  return <LoaderCircle className={`spinner${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}
