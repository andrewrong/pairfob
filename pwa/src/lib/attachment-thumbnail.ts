/**
 * Public thumbnail entry point.
 *
 * This is a thin wrapper over the shared attachment-image host: thumbnails
 * run on the SAME global queue (1 active + 4 queued) as full image
 * compression. Do not add a separate decode queue or any main-thread canvas.
 */
export {
  prepareAttachmentThumbnail,
  type AttachmentThumbnailOptions,
  THUMBNAIL_DEADLINE_MS,
} from "./attachment-image.ts";
