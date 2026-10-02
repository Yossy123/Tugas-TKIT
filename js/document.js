// Process every section of a long document without putting it in the textarea.
(() => {
  const CHUNK_SIZE = 12000;
  const splitText = (text, limit = CHUNK_SIZE) => {
    const chunks = [];
    let offset = 0;
    while (offset < text.length) {
      let end = Math.min(offset + limit, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf('\n', end);
        if (boundary > offset + limit / 2) end = boundary + 1;
        if (text.length - end < Math.min(100, limit / 4)) end -= Math.min(100, Math.floor(limit / 4));
        // Keep Unicode surrogate pairs together when a paragraph must be split.
        if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      }
      chunks.push(text.slice(offset, end));
      offset = end;
    }
    return chunks;
  };
  const prepare = async (text, summarize, onProgress = () => {}) => {
    if (text.length <= CHUNK_SIZE) return text;
    let material = text;
    for (let round = 0; round < 8; round++) {
      const chunks = splitText(material);
      const notes = [];
      for (let index = 0; index < chunks.length; index++) {
        onProgress(index + 1, chunks.length, round + 1);
        const note = await summarize(chunks[index]);
        if (typeof note !== 'string' || !note.trim() || note.length > 6000) {
          throw new Error('Catatan dokumen dari AI tidak valid. Silakan coba lagi.');
        }
        notes.push(`Bagian ${index + 1}:\n${note.trim()}`);
      }
      const combined = notes.join('\n\n');
      if (combined.length <= CHUNK_SIZE) return combined;
      if (combined.length >= material.length) break;
      material = combined;
    }
    throw new Error('Dokumen belum berhasil dirangkum. Coba PDF yang lebih pendek.');
  };
  const api = { splitText, prepare, CHUNK_SIZE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.StudyGenDocument = api;
})();
