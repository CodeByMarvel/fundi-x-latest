import type { FilePurpose } from '../db/schema';

/**
 * The limits on uploads (docs/files.md §4). Together with the two settings
 * (uploads_per_day_max, storage_max_mb) they keep R2 inside its free tier
 * and make a bug or an attack visible long before it costs anything.
 */

/** Photos are compressed by the app to ~300 KB; 5 MB leaves room for a PDF. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** How long an upload link works. */
export const UPLOAD_LINK_SECONDS = 5 * 60;
/** How long a staff viewing link works. */
export const VIEW_LINK_SECONDS = 5 * 60;
/** Upload links one person may ask for in an hour. */
export const UPLOADS_PER_PERSON_PER_HOUR = 20;
/** A pending upload never confirmed is cleaned up after this. */
export const PENDING_CLEANUP_MS = 60 * 60 * 1000;

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGES_OR_PDF = [...IMAGES, 'application/pdf'];

/** Which kinds of file each purpose takes, and in which formats. */
export const FILE_KINDS: Record<FilePurpose, Record<string, readonly string[]>> = {
  // docs/mechanic-onboarding.md §2–3. One current file per kind: a new
  // upload replaces the old one.
  MECHANIC_DOCUMENT: {
    profile_photo: IMAGES,
    id_front: IMAGES,
    id_back: IMAGES,
    selfie: IMAGES,
    good_conduct: IMAGES_OR_PDF,
    trade_certificate: IMAGES_OR_PDF,
  },
  DISPUTE_PHOTO: {
    evidence: IMAGES,
  },
};

/**
 * Files one person may hold at once (pending or ready): per mechanic for
 * documents, per person per job for dispute photos.
 */
export const MAX_ACTIVE: Record<FilePurpose, number> = {
  MECHANIC_DOCUMENT: 10,
  DISPUTE_PHOTO: 6,
};

/** Kinds where a new upload replaces the previous one. */
export const replacesPrevious = (purpose: FilePurpose) => purpose === 'MECHANIC_DOCUMENT';
