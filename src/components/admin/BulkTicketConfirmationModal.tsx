import { CheckCircle2, Download, Printer, Ticket, X } from 'lucide-react';
import { useState } from 'react';
import { downloadBulkTicketsPdf } from '../../lib/bulkTicketPdf';
import { formatDateChip, formatINR } from '../../lib/format';
import type { BulkBookingRecord } from '../../types';
import { TicketQrCode } from '../BrandMark';

interface BulkTicketConfirmationModalProps {
  record: BulkBookingRecord | null;
  onClose: () => void;
}

export function BulkTicketConfirmationModal({ record, onClose }: BulkTicketConfirmationModalProps) {
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  if (!record) return null;

  const dateChip = formatDateChip(record.show_date);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      await downloadBulkTicketsPdf(record);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        {/* Top Action Bar (Hidden in Print) */}
        <div className="no-print px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-base text-slate-950 truncate">
                Bulk Booking Confirmation — {record.bulk_code}
              </h3>
              <p className="text-xs text-slate-500">
                {record.total_tickets} verified individual ticket{record.total_tickets > 1 ? 's' : ''} with unique QR passes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-800"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Tickets
            </button>
            <button
              type="button"
              disabled={downloadingPdf}
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              {downloadingPdf ? 'Building PDF...' : 'Download PDF Tickets'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close confirmation"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Ticket Content */}
        <div className="ticket-print-area flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50">
          {/* Combined Summary Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                  TICKETNOW Combined Confirmation
                </div>
                <h2 className="font-display font-extrabold text-xl text-slate-950 mt-0.5">{record.movie_title}</h2>
                <div className="text-xs text-slate-600 mt-1">
                  {record.theatre_name} · {record.screen_name} · {dateChip.fullLabel} at {record.show_time}
                </div>
              </div>
              <div className="text-left sm:text-right">
                <div className="font-mono font-bold text-sm text-slate-950">{record.bulk_code}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Booking ID{record.booking_codes.length > 1 ? 's' : ''}:{' '}
                  <span className="font-mono text-slate-700">{record.booking_codes.join(', ')}</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-emerald-700">
                  {record.booking_status} · {record.payment_status} ({record.payment_method})
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Primary Contact</div>
                <div className="font-semibold text-slate-900">{record.primary_customer_name}</div>
                <div className="text-slate-600 font-mono">{record.primary_customer_mobile}</div>
                {record.primary_customer_email && <div className="text-slate-500">{record.primary_customer_email}</div>}
                {record.reference_code && (
                  <div className="text-slate-600">
                    Ref: <span className="font-mono font-semibold">{record.reference_code}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Allocation</div>
                <div className="text-slate-700">
                  Mode: <strong>{record.mode === 'SINGLE_CUSTOMER' ? 'Single Customer' : 'Multiple Customers'}</strong>
                </div>
                <div className="text-slate-700">
                  Total Tickets: <strong className="font-mono">{record.total_tickets}</strong> ({record.customer_count}{' '}
                  customer{record.customer_count > 1 ? 's' : ''})
                </div>
                <div className="text-slate-700">
                  Seats:{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {record.tickets.map((t) => t.seat_id).join(', ')}
                  </span>
                </div>
              </div>

              <div className="space-y-1 sm:text-right">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Financials</div>
                <div className="text-slate-600 tabular-nums">Tickets: {formatINR(record.subtotal)}</div>
                <div className="text-slate-600 tabular-nums">
                  Conv. Fee: {formatINR(record.convenience_fee)} · GST: {formatINR(record.tax_amount)}
                </div>
                {record.discount_amount > 0 && (
                  <div className="text-emerald-700 tabular-nums">Discount: -{formatINR(record.discount_amount)}</div>
                )}
                <div className="font-display font-extrabold text-base text-slate-950 tabular-nums pt-0.5">
                  Total Payable: {formatINR(record.total_amount)}
                </div>
              </div>
            </div>
          </div>

          {/* Individual Tickets Grid with Scannable QR Codes */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Ticket className="w-4 h-4 text-emerald-600" />
              Individual E-Tickets ({record.tickets.length})
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {record.tickets.map((t) => (
                <div
                  key={t.id}
                  className="ticket-print-card rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4 shadow-2xs"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="font-mono text-[11px] font-bold text-emerald-700">{t.ticket_number}</div>
                    <div className="font-display font-bold text-sm text-slate-950 truncate">{record.movie_title}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {record.theatre_name} · {record.screen_name}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      {dateChip.fullLabel} · <strong>{record.show_time}</strong>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 font-mono font-bold text-xs">
                        Seat {t.seat_id} · {t.category_name}
                      </span>
                      <span className="font-mono font-bold text-xs text-slate-900 tabular-nums">
                        {formatINR(t.unit_price)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 pt-1 truncate">
                      Guest: <strong className="text-slate-900">{t.customer_name}</strong> ·{' '}
                      <span className="font-mono">{t.customer_mobile}</span>
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-center">
                    <TicketQrCode payload={t.qr_payload} size={96} />
                    <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400 mt-1">
                      {t.ticket_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
