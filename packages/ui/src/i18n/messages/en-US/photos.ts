export const photos = {
  previewInfo: { title: 'Asset information', original: 'Open original asset in a new tab' },
  filters: {
    search: 'Name / fileId on this page',
    selectPage: 'Select all images on this page',
    ungrouped: 'Ungrouped',
    referenced: 'Referenced by products',
    unknownDimensions: 'Unknown dimensions',
    minimumSize: 'Minimum size (KiB)',
    maximumSize: 'Maximum size (KiB)'
  },
  tasks: {
    retention: '100 tasks max. Keep unresolved records; clear terminal records after 30 days.',
    title: 'Transfer history',
    boundary: 'Continues across dialogs and navigation. After reload, confirm to resume. Local history only.',
    created: 'Task created. See Transfer history for progress.',
    preview: 'Frozen execution plan:',
    filter: 'Task status',
    all: 'All',
    refresh: 'Refresh',
    empty: 'No transfer tasks yet',
    detail: 'Task details',
    changedContext: 'Account or configuration changed. This task is read-only.',
    newPreview: 'New preview',
    progress: 'Image transfer {count}/{total}',
    pause: 'Pause',
    resume: 'Resume / retry confirmed failures',
    verify: 'Verify results',
    cancel: 'Cancel remaining work',
    remove: 'Clear record',
    report: 'Export redacted report',
    reselect: 'Reselect original ZIP',
    archiveReady: 'Original ZIP verified. Select Resume to continue.',
    downloadStarted: 'Download initiated. Check your browser downloads.',
    noRepeat:
      'Keep successful receipts; verify unknown writes, never resend. Re-preview changed settings; reselect the original ZIP to resume imports.',
    confirm: 'Confirm task action',
    clearWarning:
      'Removes local history, not remote files. Unresolved records can no longer be recovered or verified.',
    skip: 'Mark skipped',
    reason: 'Reason for skipping',
    error:
      'Needs attention ({code}). Check sign-in, permissions/settings or reselect the ZIP. Verify uncertain writes before continuing.',
    status: {
      pending: 'Pending',
      running: 'Running',
      paused: 'Paused',
      attention: 'Needs attention',
      completed: 'Completed',
      cancelled: 'Cancelled'
    },
    item: {
      pending: 'Pending',
      running: 'Running',
      unconfirmed: 'Succeeded; verification pending',
      confirmed: 'Verified',
      failed: 'Confirmed failure',
      unknown: 'Unknown outcome',
      skipped: 'Skipped'
    },
    kind: { asset: 'Asset', group: 'Create group', manifest: 'Write manifest', archive: 'Create download' },
    direction: { import: 'Import', export: 'Export' }
  },
  page: {
    title: 'Images',
    description: 'Manage Alibaba.com images, image groups and usage suggestions.',
    groupManagement: 'Manage groups',
    share: 'Share',
    shareCount: 'Share {count}',
    import: 'Import',
    export: 'Export',
    upload: 'Upload'
  },
  errors: {
    uploadUnavailable: 'Image library upload and external-URL transfer are not enabled in this environment',
    maxSelection: 'Select at most {count} images at a time'
  },
  feedback: {
    uploaded: 'Uploaded to image library: {name}'
  },
  allPhotos: 'All images',
  dimensionsLoading: 'Unknown dimensions',
  select: 'Select',
  selectPhoto: 'Select {name}',
  deselectPhoto: 'Deselect {name}',
  previewPhoto: 'Preview {name}',
  preview: 'Preview',
  columns: {
    image: 'Image',
    name: 'Name',
    dimensions: 'Dimensions',
    size: 'Size',
    references: 'References',
    updated: 'Updated',
    actions: 'Actions'
  },
  references: '{count} references',
  cleanupSuggestion: 'Consider cleanup',
  highResolutionSuggestion: 'Use a higher-resolution image',
  stats: {
    pageAssets: 'Assets on this page',
    unreferenced: 'Not referenced by products',
    lowResolution: 'Below 750 × 750'
  },
  groups: 'Image groups',
  governance: {
    title: 'Asset governance',
    nonBlocking: 'Suggestions do not block use',
    selected: '{count} selected',
    clearSelection: 'Clear selection',
    all: 'All',
    unreferenced: 'Unreferenced {count}',
    lowResolution: 'Low resolution {count}',
    displayMode: 'Image display mode',
    cards: 'Cards',
    list: 'List'
  },
  fileId: 'fileId: {id}',
  updatedAt: 'Updated {date}',
  emptyFilter: 'No images on this page match the filters. Other pages may contain matches.',
  clearFilter: 'Clear filter',
  picker: {
    button: 'Choose images',
    selectedPreview: 'Preview {name}',
    remove: 'Remove {name}',
    title: 'Choose images',
    description: 'Only clicked assets are added to the product; {selected}/{maximum} selected.',
    upload: 'Upload',
    close: 'Close image selection',
    currentGroup: 'Current group: {name}',
    selectionOnly: 'This view only selects existing assets. Uploading is a separate action.',
    selectedAction: 'Deselect {name}',
    selectAction: 'Select {name}',
    uploadedNotice: '“{name}” was saved to the image library. Select it from the asset list.',
    finish: 'Finish selection'
  },
  upload: {
    unavailableLocal: 'Local image upload is not enabled in this environment',
    unavailableTransfer: 'External-URL transfer is not enabled in this environment',
    uploaded: 'Uploaded to image library: {name}',
    transferred: 'Transferred to image library: {name}',
    tooLarge: 'Images cannot exceed 5 MiB',
    readFailed: 'Could not read the image file',
    title: 'Upload image to image library',
    description: 'Upload to “{name}”; the image will not be added to the product automatically.',
    localTitle: 'Upload from this device',
    localDescription: 'Supports common image formats, up to 5 MiB per image.',
    uploading: 'Uploading…',
    chooseLocal: 'Choose and upload a local image',
    transferTitle: 'Transfer from an external URL',
    transferDescription: 'Only public HTTP(S) images up to 5 MiB are supported.',
    externalUrl: 'External image URL',
    transferring: 'Transferring…',
    transferAction: 'Download and save to image library'
  },
  groupNavigation: {
    tree: 'Image groups',
    expand: 'Expand {name}',
    collapse: 'Collapse {name}',
    loadFailed: 'Could not load image groups',
    childLoadFailed: 'Could not load image library subgroups'
  },
  groupManager: {
    unavailable: 'Image library group changes are not enabled in this environment',
    unnamed: 'Unnamed group',
    confirmation: {
      addTitle: 'Confirm new image group',
      renameTitle: 'Confirm image group rename',
      deleteTitle: 'Confirm image group deletion',
      addDescription: 'This immediately creates a image group in the current Alibaba.com account.',
      renameDescription: 'This immediately renames a group in the current Alibaba.com account.',
      deleteDescription: 'This immediately deletes a image group from the current Alibaba.com account.',
      addLabel: 'Create group',
      renameLabel: 'Confirm rename',
      deleteLabel: 'Confirm deletion',
      addTarget: 'Create “{name}” under “{parent}”.',
      renameTarget: 'Rename “{current}” to “{name}”.',
      deleteTarget:
        'Delete “{name}”. The platform may reject the request if the group still contains images or subgroups.',
      selectedGroup: 'selected group'
    },
    success: {
      added: 'Image library group “{name}” created',
      renamed: 'Image library group renamed to “{name}”',
      deleted: 'Selected image group deleted'
    },
    childLoadFailed: 'Could not load subgroups',
    title: 'Manage image groups',
    description: 'Manage Alibaba.com image library (Photo Bank) groups as a tree.',
    treeTitle: 'Group tree',
    treeDescription: 'Up to three levels. Manage a group from the actions on its right.',
    treeLabel: 'Image library group tree',
    rootCount: '{count} top-level groups',
    addToRoot: 'Create a group under All images',
    rootNameLabel: 'New group name under All images',
    rootNamePlaceholder: 'Enter a top-level group name',
    saving: 'Saving…',
    empty: 'This account has no image groups. Create one from the action beside All images.',
    photoCount: '{count} images',
    addToGroup: 'Create a group under {name}',
    renameGroup: 'Rename group {name}',
    deleteGroup: 'Delete group {name}',
    addEditorTitle: 'Create under “{name}”',
    renameEditorTitle: 'Rename “{name}”',
    childNameLabel: 'New subgroup name under {name}',
    newNameLabel: 'New name for {name}',
    childNamePlaceholder: 'Enter a subgroup name',
    newNamePlaceholder: 'Enter a new group name',
    noChildren: 'No subgroups',
    realWriteWarning:
      'Create, rename, and delete operations write to the current Alibaba.com account immediately. Every operation requires confirmation.'
  },
  transfer: {
    importTitle: 'Import image assets',
    exportTitle: 'Export image assets',
    importDescription: 'Read a oneVegetable image library ZIP and upload its images to “{group}”.',
    exportDescription: 'Download the {count} selected originals with a verifiable manifest.',
    exportSummary: 'Export {count} images',
    archiveLimit: 'ZIP files are limited to 50 MiB; each image library image is limited to 5 MiB.',
    localZip: 'Local ZIP',
    ...{
      s3Unavailable: 'S3 storage is unavailable in this runtime. Check S3 configuration in Settings.',
      s3ExportDescription:
        'Originals and gallery.json use the selected layout in an isolated batch under the configured root prefix. Existing files are not overwritten.',
      prefix: 'Export prefix (relative to the configured root)',
      mapping: 'Directory mapping',
      createMissingGroups: 'Automatically create missing image groups (up to 3 levels)',
      flat: 'Put all images in one assets directory',
      groups: 'Preserve image group hierarchy under assets',
      rules: 'Use saved prefix mapping rules',
      current: 'Import all into the current image group: {group}',
      exportToS3: 'Export to S3',
      s3ScanTitle: 'Scan S3 with local rules',
      s3ScanDescription:
        'Up to 500 objects are read. Only images matching a rule enter the import confirmation.',
      scanS3: 'Scan S3',
      s3ScanResult: 'Found {total} images; {count} will be imported.',
      skipped: 'Skipped',
      confirmS3ImportDescription:
        'Upload {count} S3 images sequentially to their rule-selected image groups. Failures are not retried automatically.'
    },
    chooseZip: 'Choose image library ZIP',
    assetCount: '{count} images',
    validating: 'Validating the manifest, image formats, and digests…',
    importAction: 'Import',
    exportAction: 'Export',
    confirmImport: 'Confirm image library import',
    confirmExport: 'Confirm image library export',
    confirmImportDescription:
      'Upload {count} images to “{group}” sequentially. Failures are not retried automatically.',
    confirmExportDescription: 'Download {count} image library originals and create a ZIP.',
    errors: {
      countMismatch: 'The image library ZIP manifest and asset counts differ',
      assetDirectory: 'Image library ZIP assets must be stored under assets/',
      duplicatePath: 'Duplicate image library ZIP path: {path}',
      unreferencedAsset: 'The image library ZIP manifest does not reference {path}',
      contentMismatch: 'Image library ZIP asset content does not match its metadata: {path}',
      sizeMismatch: 'Image library ZIP asset size does not match its metadata: {path}',
      digestMismatch: 'Image library ZIP asset digest does not match its metadata: {path}',
      uncompressedLimit: 'Image library ZIP uncompressed content exceeds 100 MiB',
      entryLimit: 'Image library ZIP contains too many files',
      archiveLimit: 'Image library ZIP exceeds 50 MiB',
      invalidZip: 'The selected file is not a valid ZIP',
      unsupportedDirectory: 'Unsupported image library ZIP directory: {path}',
      unsupportedPath: 'Unsupported image library ZIP path: {path}',
      photoLimit: 'Image library image exceeds 5 MiB: {path}',
      manifestMissing: 'Image library ZIP is missing gallery.json',
      metadataMismatch: 'Image library ZIP asset metadata does not match: {path}',
      assetMissing: 'Image library ZIP is missing an image referenced by the manifest',
      invalidSha256: 'Image library asset SHA-256 is invalid',
      invalidManifest: 'Image library ZIP manifest is not valid UTF-8 JSON',
      unsafePath: 'Image library ZIP contains an unsafe path',
      traversalPath: 'Image library ZIP contains path traversal',
      nonCanonicalPath: 'Image library ZIP path is not canonical: {path}',
      extensionMismatch: 'Image library ZIP file extension does not match its content: {path}'
    }
  },
  social: {
    unavailable: {
      extension: 'Pair the extension with a social publishing backend in Settings first.',
      backend: 'Social publishing is not enabled on the current backend.',
      onePhoto: 'The official API supports exactly one image per publish action.',
      preparing: 'Preparing the original image.',
      notPrepared: 'The original image is not ready yet.',
      chooseDestination: 'Choose a publishing destination.',
      destination: 'This destination cannot publish: {reason}',
      permission: 'insufficient permissions',
      instagramJpeg: 'This version supports JPEG images only for Instagram.',
      captionTooLong: 'The caption cannot exceed {maximum} characters.',
      invalidSelection: 'The selected image is invalid'
    },
    status: {
      prepared: 'Awaiting confirmation',
      processing: 'Processing on platform',
      published: 'Published',
      failed: 'Publish failed',
      unknown: 'Result unknown',
      cancelled: 'Cancelled',
      expired: 'Expired'
    },
    feedback: {
      systemUnavailable:
        'This browser or operating system cannot share original images. Download the ZIP package and publish manually.',
      systemOpened:
        'Assets were sent to the system share panel. The selected app still controls the final publish action.',
      archiveDownloaded: 'Downloaded a share package containing {count} images',
      permalinkReady: 'Platform content link retrieved',
      published: 'The image was published through the official API',
      instagramProcessing: 'Instagram is processing the image. Progress will refresh in about one minute.',
      unknown:
        'The publishing result is unknown. The system will not retry automatically; verify it on the platform.',
      platformRejected: 'The platform rejected the publishing request'
    },
    shareTitle: 'oneVegetable image assets',
    dialogTitle: 'Share image assets',
    dialogDescription:
      '{count} images selected. Facebook, Instagram, X, and TikTok passwords are never saved.',
    contentTitle: 'Content to share',
    contentDescription:
      'Original images are read through the unified gateway; this page does not contact external CDNs directly.',
    photoCount: '{count} images',
    caption: 'Caption',
    captionPlaceholder: 'Enter product highlights, hashtags, or publishing notes…',
    quickTitle: 'Share now',
    quickDescription:
      'System sharing sends original images to the device share panel, where you choose an installed, signed-in app. oneVegetable cannot see which app you ultimately select.',
    systemSupported: 'Original-image sharing supported',
    downloadSuggested: 'Download package recommended',
    preparingProgress: 'Preparing originals {current}/{total}',
    systemAction: 'Use system share',
    downloadArchive: 'Download ZIP share package',
    retryPreparation: 'Prepare originals again',
    officialTitle: 'Publish through official APIs',
    officialDescription:
      'Each platform requires a connected account and the corresponding developer permissions. This version never uses page automation to bypass review.',
    connectedTitle: 'Publish to a connected account',
    connectedDescription:
      'Publish one image to one destination at a time. A second confirmation is required before publishing.',
    availableDestinations: '{count} available destinations',
    destination: 'Publishing destination',
    chooseDestination: 'Choose a destination',
    destinationUnavailable: ' (unavailable)',
    publishingFailed: 'Social publishing failed',
    platformPostId: 'Platform post ID: {id}',
    viewOn: 'View on {platform}',
    getLink: 'Get {platform} link',
    publishAction: 'Check and publish',
    refreshProgress: 'Refresh progress',
    connected: 'Connected',
    needsConfiguration: 'Configuration required',
    publishTo: 'Publishes to: {destination}',
    requirements: {
      facebook: {
        destination: 'Facebook Page',
        account:
          'Requires a Facebook Page you can manage. Automated posting to personal profiles is not supported.',
        api: 'Requires a Meta app, user authorization, a Page access token, and pages_manage_posts.',
        media: 'The server uploads the image to the Page. The user must explicitly confirm before publishing.'
      },
      instagram: {
        destination: 'Instagram professional account',
        account:
          'Requires a Business or Creator professional account. Personal accounts cannot use the publishing API.',
        api: 'Requires a Meta app, user OAuth, and instagram_business_content_publish.',
        media:
          'The platform fetches the image from a public HTTPS URL, which must stay available during publishing.'
      },
      x: {
        destination: 'X account',
        account: 'Requires an X developer project and user OAuth authorization by the posting account.',
        api: 'Requires a writable user token. Upload media first, then create a Post with the media ID. API usage is metered.',
        media: 'A Post can contain up to four images.'
      },
      tiktok: {
        destination: 'TikTok creator account',
        account: 'Requires a TikTok developer app and OAuth authorization by the target creator account.',
        api: 'Direct posting requires an approved video.publish scope; draft upload uses video.upload.',
        media:
          'Photos must be fetched from a public URL on a verified domain; arbitrary third-party CDN URLs are not accepted.'
      }
    },
    viewRequirements: 'View official integration requirements',
    confirmTitle: 'Confirm official API publishing',
    confirmDescription:
      'Publish the current image to {name}. This is a real external write and the post will not be deleted automatically.',
    selectedDestination: 'the selected destination',
    confirmPublish: 'Confirm publish',
    errors: {
      originalTimeout: 'Timed out preparing original image {name}. Try again.',
      byteLengthMismatch: 'Size validation failed for image {name}',
      contentTypeMismatch: 'Content type validation failed for image {name}',
      invalidTimeout: 'The original-image preparation timeout is invalid',
      archiveTooLarge: 'The ZIP share package cannot exceed 50 MiB',
      captionTooLong: 'The sharing caption cannot exceed 4,000 characters'
    }
  }
} as const;
