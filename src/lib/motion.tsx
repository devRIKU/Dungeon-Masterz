import React from 'react';

type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & {
  initial?: unknown;
  animate?: unknown;
  exit?: unknown;
  transition?: unknown;
};

const MotionDiv = React.forwardRef<HTMLDivElement, MotionDivProps>(function MotionDiv(
  { children, ...props },
  ref
) {
  return (
    <div ref={ref} {...props}>
      {children}
    </div>
  );
});

export const motion = {
  div: MotionDiv,
};

export function AnimatePresence({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
