import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Film } from 'lucide-react';

export function TicketNowLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 select-none whitespace-nowrap shrink-0">
      <svg
        width={compact ? 22 : 26}
        height={compact ? 22 : 26}
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect x="2" y="5" width="24" height="18" rx="4" fill="#0F172A" />
        <circle cx="2" cy="14" r="3" fill="#FFFFFF" />
        <circle cx="26" cy="14" r="3" fill="#FFFFFF" />
        <path d="M10 9.5H18M14 9.5V18.5" stroke="#16A34A" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <span
        className={`font-display font-extrabold tracking-tight leading-none ${
          compact ? 'text-[17px]' : 'text-[20px]'
        }`}
      >
        <span className="text-slate-950">TICKET</span>
        <span className="text-emerald-600">NOW</span>
      </span>
    </span>
  );
}

export function CinemaProjectorIllustration() {
  return (
    <svg width="56" height="56" viewBox="0 0 64 64" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="8" y="26" width="32" height="22" rx="4" fill="#0F172A" />
      <circle cx="18" cy="18" r="8" fill="#DCFCE7" stroke="#16A34A" strokeWidth="2.2" />
      <circle cx="18" cy="18" r="2.5" fill="#16A34A" />
      <circle cx="33" cy="19" r="6.5" fill="#F1F5F9" stroke="#0F172A" strokeWidth="2" />
      <circle cx="33" cy="19" r="2" fill="#0F172A" />
      <path d="M40 31L56 23V51L40 43V31Z" fill="#BBF7D0" fillOpacity="0.85" />
      <rect x="13" y="32" width="12" height="6" rx="1.5" fill="#16A34A" />
      <path d="M16 48L12 56M32 48L36 56" stroke="#0F172A" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function FilmReelIllustration() {
  return (
    <svg width="56" height="56" viewBox="0 0 64 64" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="30" cy="32" r="20" fill="#0F172A" />
      <circle cx="30" cy="32" r="15" stroke="#16A34A" strokeWidth="2" strokeDasharray="4 4" />
      <circle cx="30" cy="21" r="3.5" fill="#FFFFFF" />
      <circle cx="30" cy="43" r="3.5" fill="#FFFFFF" />
      <circle cx="19" cy="32" r="3.5" fill="#FFFFFF" />
      <circle cx="41" cy="32" r="3.5" fill="#FFFFFF" />
      <circle cx="30" cy="32" r="4" fill="#16A34A" />
      <path d="M44 46C48 48 53 48 58 45" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function MoviePosterImage({
  src,
  alt,
  title,
  className = '',
}: {
  src: string;
  alt: string;
  title: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-emerald-950 text-white p-4 text-center ${className}`}
      >
        <Film className="w-8 h-8 text-emerald-400 mb-2" />
        <span className="font-display font-bold text-sm leading-snug line-clamp-2">{title}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
      loading="lazy"
    />
  );
}

export function TicketQrCode({ payload, size = 160 }: { payload: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(payload, {
      width: size,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [payload, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-slate-100 border border-slate-200 animate-pulse"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt="Digital ticket QR code"
      width={size}
      height={size}
      className="rounded-lg border border-slate-200 bg-white p-1.5"
    />
  );
}
