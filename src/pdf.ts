import { extractText, getDocumentProxy } from 'unpdf';

// One string per PDF, with the Court's line breaks kept (the order parser works line by line).
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
