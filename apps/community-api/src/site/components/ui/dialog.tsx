import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from './../../lib/utils';

/** 设计系统弹窗基件：radix-ui Dialog + 站点令牌（surface 卡 / line 边） */
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogOverlay(props: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-scrim backdrop-blur-sm',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        props.className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        aria-describedby={undefined}
        className={cn(
          'fixed left-[50%] top-20 z-50 grid max-h-[85dvh] w-[calc(100%-2rem)] max-w-md -translate-x-[50%] gap-5 overflow-y-auto rounded-2xl border border-edge bg-surface p-5 shadow-[var(--panel-elev)] sm:top-[50%] sm:-translate-y-[50%] sm:p-6',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-xl font-bold tracking-tight', className)}
      {...props}
    />
  );
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/** 内容右上角关闭按钮（配合 DialogClose 使用） */
function DialogCloseX() {
  return (
    <DialogClose
      aria-label="关闭"
      className="absolute top-4 right-4 rounded-full p-1.5 text-mist transition-all duration-150 hover:bg-wash-strong hover:text-ink active:scale-90"
    >
      <X className="size-4" />
    </DialogClose>
  );
}

export { Dialog, DialogTrigger, DialogOverlay, DialogContent, DialogTitle, DialogClose, DialogCloseX };
