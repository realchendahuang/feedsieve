import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './../../lib/utils';
import { Slot } from 'radix-ui';

/* 官网按钮即药丸：default = 深底浅字圆角胶囊（深色主题下翻转成白钮） */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-150 outline-none select-none cursor-pointer active:scale-[0.98] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive: 'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline: 'bg-soft-surface text-ink hover:bg-wash-strong',
        secondary: 'bg-surface text-ink shadow-[var(--panel-elev)] hover:bg-wash',
        ghost: 'text-mist hover:bg-wash hover:text-ink',
        gold: 'bg-gold-surface text-gold hover:text-gold-deep',
        link: 'text-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-6',
        xs: 'h-7 gap-1 rounded-full px-3 text-xs [&_svg:not([class*="size-"])]:size-3',
        sm: 'h-9 gap-1.5 rounded-full px-4',
        lg: 'h-12 rounded-full px-8',
        icon: 'size-10',
        'icon-xs': 'size-7 rounded-full [&_svg:not([class*="size-"])]:size-3',
        'icon-sm': 'size-9 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
