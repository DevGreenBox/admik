"use client";

import { motion, HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  magnetic?: boolean;
  children: React.ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-graphite text-white hover:bg-graphite/85 border border-graphite",
  secondary: "bg-white text-graphite border border-graphite hover:bg-surface",
  ghost: "bg-transparent text-graphite hover:opacity-60 border border-transparent",
  outline: "bg-transparent text-graphite border border-border hover:border-graphite",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-6 py-2.5 text-[10px]",
  md: "px-8 py-3.5 text-[10px]",
  lg: "px-10 py-4 text-[10px] md:px-12 md:py-4",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      magnetic = false,
      className = "",
      type = "button",
      children,
      ...props
    },
    ref
  ) => {
    return (
      <motion.button
        ref={ref}
        type={type}
        whileHover={magnetic ? { opacity: 0.85 } : undefined}
        whileTap={magnetic ? { opacity: 0.7 } : undefined}
        transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
        className={`
          inline-flex items-center justify-center gap-2
          uppercase tracking-[0.2em] font-normal
          transition-all duration-500
          disabled:opacity-30 disabled:cursor-not-allowed
          ${variants[variant]} ${sizes[size]} ${className}
        `}
        {...props}
      >
        {children}
      </motion.button>
    );
  }
);

Button.displayName = "Button";
