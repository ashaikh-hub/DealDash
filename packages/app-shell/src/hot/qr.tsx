import qrcode from 'qrcode-generator';

/**
 * Reservation QR code as inline SVG (no network, no image file). Always dark modules on a white tile with a quiet zone,
 * in every theme and direction, because scanners need that contrast. The payload is an opaque token (see QR_PREFIX).
 */
export function QrCode({
  text,
  size = 220,
  label,
}: {
  text: string;
  size?: number;
  label: string;
}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const total = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="dd-qr"
      data-qr-text-length={text.length}
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={d} fill="#0f0c42" />
    </svg>
  );
}
