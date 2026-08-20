/**
 * Tự thêm hậu tố kiểu Windows Explorer khi trùng tên trong cùng 1 thư mục
 * (mục 2.1). Dùng chung cho upload / rename / move / restore — 1 logic duy nhất.
 *
 *   "Báo cáo.pdf" -> "Báo cáo (1).pdf" -> "Báo cáo (2).pdf" ...
 *   "Ảnh"         -> "Ảnh (1)"        -> "Ảnh (2)" ...   (folder, không có đuôi)
 *
 * @param desiredName tên mong muốn
 * @param existingNames tên các item ĐANG active cùng thư mục (deletedAt IS NULL)
 * @param isFolder true = không tách phần mở rộng
 */
export function resolveNameCollision(
  desiredName: string,
  existingNames: Iterable<string>,
  isFolder = false,
): string {
  const taken = new Set<string>();
  for (const n of existingNames) taken.add(n.toLowerCase());

  if (!taken.has(desiredName.toLowerCase())) return desiredName;

  const { base, ext } = splitName(desiredName, isFolder);
  for (let i = 1; i < 100000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // Cực hiếm — fallback timestamp để không kẹt vòng lặp.
  return `${base} (${Date.now()})${ext}`;
}

function splitName(name: string, isFolder: boolean): { base: string; ext: string } {
  if (isFolder) return { base: name, ext: '' };
  const dot = name.lastIndexOf('.');
  // ".gitignore" (dot=0) coi như không có phần mở rộng.
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/** Tách đuôi file (không có dấu chấm), lowercase — cho cột File.extension. */
export function extractExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}
