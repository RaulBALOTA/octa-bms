export type PreviewKind = 'pdf' | 'image' | 'tiff';

export function previewKind(fileName: string, mimeType = ''): PreviewKind | null {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (extension === 'tif' || extension === 'tiff' || mimeType === 'image/tiff') return 'tiff';
  if (['jpg', 'jpeg', 'png'].includes(extension ?? '') || ['image/jpeg', 'image/png'].includes(mimeType)) return 'image';
  return null;
}
