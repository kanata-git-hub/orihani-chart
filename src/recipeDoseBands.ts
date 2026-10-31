const doseBands = [
  { limit: 15, label: '15g 이하', className: 'bg-slate-200' },
  { limit: 30, label: '15g 초과 · 30g 이하', className: 'bg-blue-200' },
  { limit: 45, label: '30g 초과 · 45g 이하', className: 'bg-cyan-200' },
  { limit: 60, label: '45g 초과 · 60g 이하', className: 'bg-emerald-200' },
  { limit: 75, label: '60g 초과 · 75g 이하', className: 'bg-lime-200' },
  { limit: 90, label: '75g 초과 · 90g 이하', className: 'bg-amber-200' },
  { limit: 120, label: '90g 초과 · 120g 이하', className: 'bg-orange-200' },
  { limit: 150, label: '120g 초과 · 150g 이하', className: 'bg-violet-200' },
  { limit: Infinity, label: '150g 초과', className: 'bg-rose-200' },
] as const;

const doseFormatter = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 6 });

/** Classify a validated positive quantity at the same precision shown to the user. */
export function getRecipeDoseBand(amount: number): { label: string; className: string } {
  const displayedAmount = Number(doseFormatter.format(amount));
  const band = doseBands.find(({ limit }) => displayedAmount <= limit)!;
  return { label: band.label, className: band.className };
}
