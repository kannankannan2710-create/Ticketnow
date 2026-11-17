import { useEffect, useState } from 'react';
import type { AvailabilityIndicator } from '../types';

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} min`;
  return `${h} hr ${m} min`;
}

export function formatINR(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDateChip(dateStr: string): {
  dayNum: string;
  monthShort: string;
  weekdayShort: string;
  weekdayLong: string;
  fullLabel: string;
} {
  const d = new Date(`${dateStr}T12:00:00`);
  return {
    dayNum: String(d.getDate()).padStart(2, '0'),
    monthShort: d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase(),
    weekdayShort: d.toLocaleDateString('en-IN', { weekday: 'short' }),
    weekdayLong: d.toLocaleDateString('en-IN', { weekday: 'long' }),
    fullLabel: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
  };
}

export function getShowTimeBucket(startTime: string): 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT' {
  const m = startTime.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!m) return 'MORNING';
  let h = parseInt(m[1], 10);
  const mer = m[3];
  if (mer === 'PM' && h < 12) h += 12;
  if (mer === 'AM' && h === 12) h = 0;
  if (h < 12) return 'MORNING';
  if (h < 17) return 'AFTERNOON';
  if (h < 21) return 'EVENING';
  return 'NIGHT';
}

export function isEarlyMorningShow(startTime: string): boolean {
  const m = startTime.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!m) return false;
  let h = parseInt(m[1], 10);
  if (m[3] === 'PM' && h < 12) h += 12;
  if (m[3] === 'AM' && h === 12) h = 0;
  return h < 9;
}

export function getIndicatorMeta(indicator: AvailabilityIndicator): {
  label: string;
  textClass: string;
  borderClass: string;
  barClass: string;
  dotColor: string;
} {
  switch (indicator) {
    case 'AVAILABLE':
      return {
        label: 'Available',
        textClass: 'text-emerald-700',
        borderClass: 'border-emerald-300 hover:border-emerald-600',
        barClass: 'bg-emerald-500',
        dotColor: '#16A34A',
      };
    case 'FAST_FILLING':
      return {
        label: 'Filling Fast',
        textClass: 'text-amber-700',
        borderClass: 'border-amber-300 hover:border-amber-600',
        barClass: 'bg-amber-500',
        dotColor: '#F59E0B',
      };
    case 'ALMOST_FULL':
      return {
        label: 'Almost Full',
        textClass: 'text-orange-700',
        borderClass: 'border-orange-300 hover:border-orange-600',
        barClass: 'bg-orange-600',
        dotColor: '#EA580C',
      };
    case 'SOLD_OUT':
      return {
        label: 'Sold Out',
        textClass: 'text-rose-700',
        borderClass: 'border-slate-200 opacity-60 cursor-not-allowed',
        barClass: 'bg-rose-600',
        dotColor: '#DC2626',
      };
    case 'BOOKING_NOT_OPEN':
      return {
        label: 'Booking Not Open',
        textClass: 'text-slate-600',
        borderClass: 'border-slate-200 opacity-60 cursor-not-allowed',
        barClass: 'bg-slate-400',
        dotColor: '#64748B',
      };
    case 'COMING_SOON':
      return {
        label: 'Coming Soon',
        textClass: 'text-slate-600',
        borderClass: 'border-slate-200 opacity-60 cursor-not-allowed',
        barClass: 'bg-slate-400',
        dotColor: '#64748B',
      };
    default:
      return {
        label: 'Booking Closed',
        textClass: 'text-slate-500',
        borderClass: 'border-slate-200 opacity-60 cursor-not-allowed',
        barClass: 'bg-slate-400',
        dotColor: '#94A3B8',
      };
  }
}

export function useCountdown(targetIso: string | null): {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  formatted: string;
} {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!targetIso) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  if (!targetIso) {
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0, formatted: '00:00:00' };
  }

  const targetMs = new Date(targetIso).getTime();
  const diff = Math.max(0, targetMs - nowMs);
  if (Number.isNaN(targetMs) || diff <= 0) {
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0, formatted: '00:00:00' };
  }

  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted =
    days > 0
      ? `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return { expired: false, days, hours, minutes, seconds, formatted };
}
