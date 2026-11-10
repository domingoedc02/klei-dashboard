export type SignatureParts = {
  enabled: boolean;
  signoff: string;
  name: string;
  title: string;
  phone: string;
  studioName: string;
  studioAddress: string;
};

// The same rule as `SignatureRenderer` on the backend; both must pass docs/fixtures/signature.json (FR-31).
export function renderSignature(s: SignatureParts): string {
  if (!s.enabled) return '';
  const studioLine = [s.studioName, s.phone].map((t) => t.trim()).filter(Boolean).join(' · ');
  return [s.signoff, s.name, s.title, studioLine, ...s.studioAddress.split(/\r\n|\r|\n/)]
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n');
}
