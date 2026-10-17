import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

// Quick-liquid motion presets: springy, fluid entrance used across the app.
export const spring = { type: 'spring', stiffness: 260, damping: 24 } as const;
export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: spring,
};
export const stagger = {
  animate: { transition: { staggerChildren: 0.05 } },
};

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`glass rounded-2xl p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {right}
    </div>
  );
}

type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'brand';
const toneClass: Record<Tone, string> = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
  neutral: 'bg-surface-2 text-muted',
  brand: 'bg-brand/15 text-brand',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'brand',
  loading,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  loading?: boolean;
}) {
  return (
    <motion.div variants={fadeUp} className="glass rounded-2xl p-5">
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        {icon && <span className={`rounded-lg p-1.5 ${toneClass[tone]}`}>{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-28" />
      ) : (
        <div className="mt-2 text-3xl font-bold tracking-tight text-text">{value}</div>
      )}
      {sub && !loading && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </motion.div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';
  const styles = {
    primary: 'bg-brand text-brand-fg hover:brightness-110',
    ghost: 'glass-inset text-text hover:brightness-110',
    danger: 'bg-danger text-white hover:brightness-110',
  }[variant];
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={`${base} ${styles} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </motion.button>
  );
}
