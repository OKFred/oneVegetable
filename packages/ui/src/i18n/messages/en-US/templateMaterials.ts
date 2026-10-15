export const templateMaterials = {
  format: 'Local export format',
  file: 'Local JSON / ZIP file',
  description:
    'Transfer templates with optional image files. Credentials and audit identities are never included.',
  templateLimit: 'Up to 100 templates. JSON manifests are limited to 5 MiB.',
  json: 'JSON (template text and image URLs only)',
  zip: 'ZIP (templates and image files)',
  includeImages: 'Include image files in the S3 backup',
  limits: 'ZIP: up to 50 MiB; manifest: 5 MiB; extracted files: 100 MiB; up to 500 images, 5 MiB each.',
  s3Images: 'Images are stored separately with a templates.json manifest. A ZIP is never uploaded to S3.',
  preview:
    '{templates} templates · {images} image files. Previewing does not upload images or create templates.',
  files: 'Included image files',
  targetGroup: 'Target photo group',
  chooseGroup: 'Select a real photo group. All photos and ungrouped are not upload targets.',
  selectedGroup: 'Target group: {name}',
  reuseExisting: 'Reuse existing images (keep their original groups)',
  permissionNotice:
    'Confirming requests extension access to {hosts} to download and hash-check images. Denying access prevents uploads.',
  reuseExplanation:
    'Alibaba may deduplicate identical images without moving them. When enabled, reuse requires matching the returned file ID, actual group and content hash. Otherwise the target group is required. The full library is never scanned.',
  confirmReuse:
    'Reuse verified existing images in their actual groups. New images still use the target group.',
  uploadCount: '{count} image files will be uploaded or reused from confirmed gallery receipts.',
  preparedImages:
    'Planned new uploads: {uploads} · confirmed materials to reuse: {reused}. Skipped template conflicts may need no uploads.',
  verifyOnly:
    'The existing gallery task contains uncertain uploads. This attempt only verifies their results; it will not send new image uploads.',
  confirm: '{action} {templates} templates with {images} image files?',
  confirmImport:
    'Import {templates} templates into this account; upload or reuse {images} image files in “{group}”?',
  confirmVerify:
    'Check the existing image receipts in “{group}” for {templates} templates? No new image uploads will be sent. Templates are imported only after every required image is confirmed.',
  templatesUnavailable: 'The template library service is unavailable. Import is disabled.',
  transfersUnavailable: 'The persistent gallery transfer service is unavailable. Image import is disabled.',
  galleryUnavailable: 'The gallery context service is unavailable. Image transfer is disabled.',
  permissionPending: 'Checking gallery permissions and image upload availability…',
  permissionUnavailable: 'Gallery write permissions could not be verified. Image transfer is disabled.',
  permissionDenied: 'This account has no gallery write permission. Images cannot be uploaded.',
  availabilityUnavailable: 'The image upload availability service is unavailable. Image import is disabled.',
  uploadDenied: 'Image uploads are unavailable ({code}).',
  storageUnavailable: 'The S3 storage service is unavailable.',
  unknownImport:
    'The write result is uncertain or incomplete. This dialog is now read-only. Do not resend; check the template library and any persistent gallery task first.',
  materialRecovery:
    'For another check, close this dialog and reopen the same package in the same account/gallery context and select the same real photo group. Confirmed gallery receipts can be reused; uncertain sent uploads are only verified, never resent. This does not guarantee that an incomplete import will finish.',
  tasks: 'Open gallery tasks',
  savedPath: 'Backup prefix: {prefix} · manifest: {key}',
  downloading: 'Downloading images {current}/{total}',
  uploading: 'Uploading images {current}/{total}',
  packing: 'Packing files {current}/{total}',
  verifying: 'Verifying files {current}/{total}',
  codes: {
    GALLERY_TASK_BUSY:
      'An asset transfer is running or needs recovery. This attempt has not started writing. Wait for it to stop, or check/recover it in the task center, then confirm again.',
    GALLERY_TASK_STORAGE:
      'Local transfer records could not be saved. Further scheduling was stopped. Check browser storage, then verify any sent uploads. Do not resend uncertain uploads.',
    TEMPLATE_MATERIAL_PERMISSION_REQUIRED:
      'Image verification host access was not granted. No upload started. Confirm again to allow the listed hosts, or disable existing-image reuse.',
    TEMPLATE_MATERIAL_EXISTING_OTHER_GROUP:
      'Alibaba returned an existing image in another group. Nothing was reuploaded or moved. Reopen the same package and target group, enable existing-image reuse, and confirm a read-only check.',
    TEMPLATE_MATERIAL_INVALID: 'The template material manifest is invalid.',
    TEMPLATE_MATERIAL_INVALID_DOCUMENT: 'The ZIP contains an invalid or missing templates.json manifest.',
    TEMPLATE_MATERIAL_INVALID_ZIP: 'The ZIP structure is invalid or unsupported.',
    TEMPLATE_MATERIAL_ZIP_TOO_LARGE: 'The ZIP exceeds the 50 MiB limit.',
    TEMPLATE_MATERIAL_MANIFEST_TOO_LARGE: 'The material manifest exceeds the 5 MiB limit.',
    TEMPLATE_MATERIAL_UNCOMPRESSED_LIMIT: 'The extracted files exceed the 100 MiB limit.',
    TEMPLATE_MATERIAL_ASSET_LIMIT: 'The package exceeds the 500-image limit.',
    TEMPLATE_MATERIAL_ASSET_INVALID: 'An image is invalid, unsupported, or exceeds 5 MiB.',
    TEMPLATE_MATERIAL_INVALID_IMAGE: 'An image is invalid, unsupported, or exceeds 5 MiB.',
    TEMPLATE_MATERIAL_LIMIT: 'The material package exceeds its image count or extracted-size limit.',
    TEMPLATE_MATERIAL_GROUP_REQUIRED: 'Select a real photo group before importing images.',
    TEMPLATE_MATERIAL_UNAVAILABLE: 'The required gallery transfer or gallery context service is unavailable.',
    TEMPLATE_MATERIAL_ASSET_MISSING: 'An image listed in the manifest is missing.',
    TEMPLATE_MATERIAL_DIGEST_MISMATCH: 'An image hash does not match the manifest. Nothing will be imported.',
    TEMPLATE_MATERIAL_DUPLICATE_PATH: 'The package contains duplicate file paths.',
    TEMPLATE_MATERIAL_PATH_INVALID: 'A material path is not a valid relative image path.',
    TEMPLATE_MATERIAL_UNSAFE_PATH: 'The ZIP contains an unsafe file path.',
    TEMPLATE_MATERIAL_MISSING: 'A template references a missing material.',
    TEMPLATE_MATERIAL_UNREFERENCED: 'The manifest contains an image not referenced by any template.',
    TEMPLATE_MATERIAL_UNREFERENCED_ASSET: 'The ZIP contains an image not declared in the manifest.',
    TEMPLATE_MATERIAL_SOURCE_UNSUPPORTED:
      'Only supported photobank images can be included in a material package.',
    TEMPLATE_MATERIAL_UNCONFIRMED:
      'Image uploads have not been confirmed. Check gallery tasks; do not resend.'
  }
};
