import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import type { BulkBookingRecord, BulkCustomerAssignment } from '../types';

export async function downloadBulkTicketsPdf(record: BulkBookingRecord): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;

  // Page 1: Combined Bulk Booking Confirmation Header & Summary
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 88, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('TICKET', margin, 42);
  doc.setTextColor(22, 163, 74);
  doc.text('NOW', margin + 84, 42);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('COMBINED BULK BOOKING CONFIRMATION & INDIVIDUAL TICKETS', margin, 62);

  doc.setTextColor(255, 255, 255);
  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.text(record.bulk_code, pageWidth - margin, 42, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Status: ${record.booking_status} | Payment: ${record.payment_status}`, pageWidth - margin, 60, {
    align: 'right',
  });

  let y = 112;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(record.movie_title, margin, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `${record.theatre_name} • ${record.screen_name} • ${record.show_date} at ${record.show_time}`,
    margin,
    y
  );
  y += 22;

  // Summary box
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 92, 8, 8, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('PRIMARY CONTACT', margin + 14, y + 20);
  doc.text('BOOKING DETAILS', margin + 210, y + 20);
  doc.text('FINANCIAL SUMMARY', margin + 390, y + 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(record.primary_customer_name, margin + 14, y + 36);
  doc.text(record.primary_customer_mobile, margin + 14, y + 50);
  doc.text(record.primary_customer_email || '—', margin + 14, y + 64);
  if (record.reference_code) {
    doc.text(`Ref: ${record.reference_code}`, margin + 14, y + 78);
  }

  doc.text(`Mode: ${record.mode === 'SINGLE_CUSTOMER' ? 'Single Customer' : 'Multiple Customers'}`, margin + 210, y + 36);
  doc.text(`Total Tickets: ${record.total_tickets}`, margin + 210, y + 50);
  doc.text(`Customers: ${record.customer_count}`, margin + 210, y + 64);
  doc.text(`Issued By: ${record.created_by_admin_name}`, margin + 210, y + 78);

  doc.text(`Tickets: INR ${record.subtotal.toFixed(2)}`, margin + 390, y + 36);
  doc.text(`Conv. Fee: INR ${record.convenience_fee.toFixed(2)}`, margin + 390, y + 50);
  doc.text(`Discount: -INR ${record.discount_amount.toFixed(2)} | GST: INR ${record.tax_amount.toFixed(2)}`, margin + 390, y + 64);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(22, 163, 74);
  doc.text(`Total Paid: INR ${record.total_amount.toFixed(2)}`, margin + 390, y + 80);

  y += 116;

  // Individual Ticket Cards with Scannable QR Codes (3 cards per page cleanly)
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`INDIVIDUAL E-TICKETS (${record.tickets.length})`, margin, y);
  y += 14;

  const cardHeight = 148;
  const cardGap = 14;

  for (let i = 0; i < record.tickets.length; i++) {
    const t = record.tickets[i];
    if (y + cardHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }

    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, y, pageWidth - margin * 2, cardHeight, 8, 8, 'FD');

    // Left emerald strip
    doc.setFillColor(22, 163, 74);
    doc.rect(margin, y, 6, cardHeight, 'F');

    // Ticket Number & Seat Header
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(22, 163, 74);
    doc.text(t.ticket_number, margin + 18, y + 22);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text(`${record.movie_title}`, margin + 18, y + 40);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`${record.theatre_name} • ${record.screen_name}`, margin + 18, y + 56);
    doc.text(`Show: ${record.show_date} at ${record.show_time}`, margin + 18, y + 70);

    // Seat & Price pill area
    doc.setFillColor(245, 243, 255);
    doc.setDrawColor(196, 181, 253);
    doc.roundedRect(margin + 18, y + 80, 175, 28, 5, 5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(124, 58, 237);
    doc.text(`SEAT ${t.seat_id} (${t.category_name})`, margin + 26, y + 98);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`INR ${t.unit_price.toFixed(2)}`, margin + 206, y + 98);

    // Attendee details
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `Guest: ${t.customer_name}  |  Mobile: ${t.customer_mobile}${t.customer_email ? `  |  ${t.customer_email}` : ''}`,
      margin + 18,
      y + 128
    );
    if (t.booking_code) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Booking ID: ${t.booking_code}`, margin + 18, y + 140);
    }

    // Generate QR PNG
    try {
      const qrDataUrl = await QRCode.toDataURL(t.qr_payload, {
        width: 140,
        margin: 1,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      });
      doc.addImage(qrDataUrl, 'PNG', pageWidth - margin - 116, y + 18, 102, 102);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text('SCAN AT ENTRY', pageWidth - margin - 65, y + 132, { align: 'center' });
    } catch {
      // Ignore QR generation error
    }

    y += cardHeight + cardGap;
  }

  doc.save(`TICKETNOW-${record.bulk_code}.pdf`);
}

export async function parseCustomerFile(
  file: File,
  selectedSeatIds: string[]
): Promise<{
  customers: BulkCustomerAssignment[];
  errors: string[];
}> {
  const errors: string[] = [];
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) {
    return { customers: [], errors: ['Uploaded file has no readable worksheet.'] };
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], { defval: '' });
  if (rawRows.length === 0) {
    return { customers: [], errors: ['Uploaded spreadsheet contains zero customer rows.'] };
  }

  const seatPool = [...selectedSeatIds];
  const usedSeats = new Set<string>();
  const customers: BulkCustomerAssignment[] = [];

  const getField = (row: Record<string, unknown>, candidates: string[]): string => {
    const keys = Object.keys(row);
    for (const c of candidates) {
      const foundKey = keys.find((k) => k.trim().toLowerCase().replace(/[^a-z0-9]/g, '') === c);
      if (foundKey && String(row[foundKey]).trim()) {
        return String(row[foundKey]).trim();
      }
    }
    return '';
  };

  rawRows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const name = getField(row, ['name', 'customername', 'fullname', 'guestname', 'attendee']);
    const mobile = getField(row, ['mobile', 'phone', 'mobilenumber', 'phonenumber', 'contact']);
    const email = getField(row, ['email', 'emailaddress', 'mail']);
    const seatsRaw = getField(row, ['seats', 'seat', 'seatid', 'seatids', 'seatnumber', 'seatnumbers']);

    if (!name) {
      errors.push(`Row ${rowNum}: Missing customer Name.`);
      return;
    }
    if (!mobile || mobile.replace(/\D/g, '').length < 10) {
      errors.push(`Row ${rowNum} (${name}): Valid 10-digit Mobile number is required.`);
      return;
    }

    const assignedSeats: string[] = [];
    if (seatsRaw) {
      const requested = seatsRaw
        .split(/[,;|/\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      for (const sId of requested) {
        if (!selectedSeatIds.includes(sId)) {
          errors.push(`Row ${rowNum} (${name}): Seat "${sId}" is not in the currently selected seats.`);
        } else if (usedSeats.has(sId)) {
          errors.push(`Row ${rowNum} (${name}): Seat "${sId}" is already assigned to another customer.`);
        } else {
          usedSeats.add(sId);
          assignedSeats.push(sId);
        }
      }
    }

    customers.push({
      id: `cust_${idx}_${Date.now().toString(36)}`,
      name,
      mobile,
      email,
      seat_ids: assignedSeats,
    });
  });

  // Auto-assign any remaining unassigned seats round-robin to customers who had no explicit seat column
  const unassignedSeats = seatPool.filter((id) => !usedSeats.has(id));
  const emptyCustomers = customers.filter((c) => c.seat_ids.length === 0);
  if (unassignedSeats.length > 0 && emptyCustomers.length > 0) {
    unassignedSeats.forEach((seatId, idx) => {
      emptyCustomers[idx % emptyCustomers.length].seat_ids.push(seatId);
    });
  }

  return { customers, errors };
}

export function downloadSampleCustomerCsv(sampleSeats: string[]): void {
  const s1 = sampleSeats[0] || 'A1';
  const s2 = sampleSeats[1] || 'A2';
  const s3 = sampleSeats[2] || 'A3';
  const csv = [
    'Name,Mobile,Email,Seats',
    `Karthik Rajendran,9842112345,karthik@company.in,"${s1},${s2}"`,
    `Meenakshi Sundaram,9842167890,meenakshi@company.in,${s3}`,
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ticketnow-bulk-customers-sample.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
