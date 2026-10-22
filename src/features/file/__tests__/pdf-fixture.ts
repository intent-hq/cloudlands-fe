/** Independent two-page binary PDF: red first page, blue second page, real text. */
export function createPdfFixture(): Uint8Array {
  const streams = [
    '1 0 0 rg 0 0 300 200 re f 0 0 0 rg BT /F1 20 Tf 30 100 Td (First PDF page) Tj ET',
    '0 0 1 rg 0 0 300 200 re f 0 0 0 rg BT /F1 20 Tf 30 100 Td (Second PDF page) Tj ET',
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    ...[5, 6].map(
      (content) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents ${content} 0 R >>`,
    ),
    ...streams.map((stream) => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let source = '%PDF-1.7\n%\xff\xfe\x80\x81\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = source.length;
  source += `xref\n0 8\n0000000000 65535 f \n`;
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  source += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(source, (char) => char.charCodeAt(0));
}
