import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Brain, ListChecks, PenLine, Check } from 'lucide-react';
import { Card } from './ui';

/**
 * On-theme loader for the Close Day AI step. The salad bowl is actively mixed:
 * the spoon swings back and forth about the rim center, and the salad bits
 * tumble. A 3-stage status line (Thinking -> Organizing -> Writing) advances on
 * a gentle timer so the sequence reads naturally even for a sub-second API.
 *
 * Motion is driven with animated SVG transform *attributes* using an explicit
 * rotate(angle, cx, cy) pivot — not CSS transform-origin — so the spoon rotates
 * about the right point in every browser. Colors are explicit hex. Respects
 * reduced-motion.
 */

const STAGES = [
  { key: 'thinking', label: 'Thinking', hint: 'Reading today’s numbers…', icon: Brain },
  { key: 'organizing', label: 'Organizing', hint: 'Sorting sales, stock & fees…', icon: ListChecks },
  { key: 'writing', label: 'Writing', hint: 'Composing the summary…', icon: PenLine },
] as const;

// Pivot for the spoon = rim center.
const PIVOT_X = 0;
const PIVOT_Y = -6;

// Salad bits sit INSIDE the bowl bowl-area (y between 2 and 22, |x| < 34).
const BITS = [
  { x: -22, y: 10, r: 6.5, fill: '#34d399' },
  { x: -8, y: 16, r: 5.5, fill: '#f59e0b' },
  { x: 6, y: 12, r: 6, fill: '#ef4444' },
  { x: 20, y: 14, r: 5.5, fill: '#a3e635' },
  { x: -2, y: 20, r: 5, fill: '#fbbf24' },
];

export function AiCookingLoader() {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timers = [
      setTimeout(() => setStage(1), 1100),
      setTimeout(() => setStage(2), 2300),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduce]);

  // Animate the spoon via the transform attribute itself: rotate(a, px, py).
  const spoonAnim = reduce
    ? { transform: `rotate(0 ${PIVOT_X} ${PIVOT_Y})` }
    : {
        transform: [
          `rotate(-26 ${PIVOT_X} ${PIVOT_Y})`,
          `rotate(26 ${PIVOT_X} ${PIVOT_Y})`,
          `rotate(-26 ${PIVOT_X} ${PIVOT_Y})`,
        ],
      };

  return (
    <Card className="flex flex-col items-center gap-5 py-8">
      <div className="relative h-32 w-44">
        <svg viewBox="-60 -58 120 120" className="h-full w-full" aria-hidden>
          {/* steam */}
          {!reduce && (
            <g>
              {[-14, 0, 14].map((x, i) => (
                <motion.path
                  key={x}
                  d={`M ${x} -34 q 7 -9 0 -18 q -7 -9 0 -18`}
                  stroke="#94a3b8"
                  strokeOpacity={0.5}
                  strokeWidth={2.5}
                  fill="none"
                  strokeLinecap="round"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: [0, 0.8, 0], y: [8, -4, -16] }}
                  transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.4, ease: 'easeInOut' }}
                />
              ))}
            </g>
          )}

          {/* bowl back rim (behind the bits so bits read as inside) */}
          <ellipse cx="0" cy={PIVOT_Y} rx="44" ry="10" fill="#0f172a" stroke="#475569" strokeWidth={3} />

          {/* tumbling salad bits */}
          <g>
            {BITS.map((b, i) =>
              reduce ? (
                <circle key={i} cx={b.x} cy={b.y} r={b.r} fill={b.fill} fillOpacity={0.92} />
              ) : (
                <motion.circle
                  key={i}
                  r={b.r}
                  fill={b.fill}
                  fillOpacity={0.92}
                  initial={{ cx: b.x, cy: b.y }}
                  animate={{
                    cx: [b.x, b.x + 14, b.x - 12, b.x + 6, b.x],
                    cy: [b.y, b.y - 7, b.y + 5, b.y - 4, b.y],
                  }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.14, ease: 'easeInOut' }}
                />
              )
            )}
          </g>

          {/* bowl front (half-ellipse body) drawn over bottom of bits */}
          <path d="M -44 -6 A 44 42 0 0 0 44 -6" fill="#1e293b" fillOpacity={0.55} stroke="#334155" strokeWidth={2.5} />
          <ellipse cx="0" cy={PIVOT_Y} rx="44" ry="10" fill="none" stroke="#64748b" strokeWidth={2} strokeOpacity={0.7} />

          {/* stirring spoon, rotating about the rim center */}
          <motion.g animate={spoonAnim} transition={reduce ? undefined : { duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}>
            <rect x={-3} y={-52} width={6} height={52} rx={3} fill="#f59e0b" />
            <ellipse cx={0} cy={2} rx={10} ry={6.5} fill="#f59e0b" />
          </motion.g>
        </svg>
      </div>

      {/* Stage stepper */}
      <div className="flex w-full max-w-md items-center justify-between gap-2">
        {STAGES.map((s, i) => {
          const done = i < stage;
          const active = i === stage;
          const Icon = s.icon;
          return (
            <div key={s.key} className="flex flex-1 flex-col items-center gap-1.5 text-center">
              <motion.span
                className={`grid h-9 w-9 place-items-center rounded-full border transition-colors ${
                  done
                    ? 'border-ok/40 bg-ok/15 text-ok'
                    : active
                    ? 'border-brand/40 bg-brand/15 text-brand'
                    : 'border-border bg-surface-2 text-muted'
                }`}
                animate={active && !reduce ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                transition={{ duration: 1.1, repeat: active && !reduce ? Infinity : 0, ease: 'easeInOut' }}
              >
                {done ? <Check size={16} /> : <Icon size={16} />}
              </motion.span>
              <span className={`text-xs font-semibold ${active || done ? 'text-text' : 'text-muted'}`}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      <motion.p
        key={stage}
        className="text-sm text-muted"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {STAGES[stage].hint}
      </motion.p>
    </Card>
  );
}
