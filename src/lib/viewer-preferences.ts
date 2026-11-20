/**
 * Reader preferences shared by the embedded viewers.
 *
 * Dark reading mode is a per-browser preference, not a per-file one: a reader
 * who needs it on one worksheet needs it on the next file and on the notes
 * PDF, so both viewers read and write the same `localStorage` key.
 */
export const PDF_INVERT_STORAGE_KEY = 'lambda-prep:pdf-inverted';
