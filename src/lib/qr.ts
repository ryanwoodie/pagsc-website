// QR codes as inline SVG, made at build time (no outside service).
import QRCode from 'qrcode';

export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0E2233', light: '#FFFFFF' } });
}
