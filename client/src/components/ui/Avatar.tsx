import type { AvatarColor } from "@cryo/shared";
import { avatarColor } from "@cryo/shared";
import { initials } from "../../lib/format";

interface AvatarProps {
  name: string;
  color: AvatarColor;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
} as const;

export function Avatar({ name, color, size = "md", className = "" }: AvatarProps) {
  const bg = avatarColor(color);
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${SIZES[size]} ${className}`}
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      <span className="text-[#0a0a0c]">{initials(name)}</span>
    </span>
  );
}
