export const photos = {
  page: {
    title: 'Gallery',
    description:
      'Manage Alibaba.com gallery (Photo Bank) groups, publishing assets, and non-blocking governance suggestions.',
    groupManagement: 'Manage groups',
    share: 'Share',
    shareCount: 'Share {count}',
    upload: 'Upload image'
  },
  errors: {
    uploadUnavailable: 'Gallery upload and external-URL transfer are not enabled in this environment',
    maxSelection: 'Select at most {count} images at a time'
  },
  feedback: {
    uploaded: 'Uploaded to gallery: {name}'
  },
  allPhotos: 'All images',
  dimensionsLoading: 'Reading dimensions',
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
  groups: 'Gallery groups',
  governance: {
    title: 'Asset governance',
    nonBlocking: 'Suggestions do not block use',
    selected: '{count} selected',
    clearSelection: 'Clear selection',
    all: 'All',
    unreferenced: 'Unreferenced {count}',
    lowResolution: 'Low resolution {count}',
    displayMode: 'Gallery display mode',
    cards: 'Cards',
    list: 'List'
  },
  fileId: 'Gallery fileId: {id}',
  updatedAt: 'Updated {date}',
  emptyFilter: 'No assets match the current filter.',
  clearFilter: 'Clear filter',
  picker: {
    button: 'Choose from gallery',
    selectedPreview: 'Preview {name}',
    remove: 'Remove {name}',
    title: 'Choose gallery assets',
    description: 'Only clicked assets are added to the product; {selected}/{maximum} selected.',
    upload: 'Upload new asset',
    close: 'Close gallery',
    currentGroup: 'Current group: {name}',
    selectionOnly: 'This view only selects existing assets. Uploading is a separate action.',
    selectedAction: 'Deselect {name}',
    selectAction: 'Select {name}',
    uploadedNotice: '“{name}” was saved to the gallery. Select it from the asset list.',
    finish: 'Finish selection'
  },
  upload: {
    unavailableLocal: 'Local image upload is not enabled in this environment',
    unavailableTransfer: 'External-URL transfer is not enabled in this environment',
    uploaded: 'Uploaded to gallery: {name}',
    transferred: 'Transferred to gallery: {name}',
    tooLarge: 'Gallery images cannot exceed 5 MiB',
    readFailed: 'Could not read the image file',
    title: 'Upload image to gallery',
    description: 'Upload to “{name}”; the image will not be added to the product automatically.',
    localTitle: 'Upload from this device',
    localDescription: 'Supports common image formats, up to 5 MiB per image.',
    uploading: 'Uploading…',
    chooseLocal: 'Choose and upload a local image',
    transferTitle: 'Transfer from an external URL',
    transferDescription: 'Only public HTTP(S) images up to 5 MiB are supported.',
    externalUrl: 'External image URL',
    transferring: 'Transferring…',
    transferAction: 'Download and save to gallery'
  },
  groupNavigation: {
    tree: 'Gallery groups',
    expand: 'Expand {name}',
    collapse: 'Collapse {name}',
    loadFailed: 'Could not load gallery groups',
    childLoadFailed: 'Could not load gallery subgroups'
  },
  groupManager: {
    unavailable: 'Gallery group changes are not enabled in this environment',
    unnamed: 'Unnamed group',
    confirmation: {
      addTitle: 'Confirm new gallery group',
      renameTitle: 'Confirm gallery group rename',
      deleteTitle: 'Confirm gallery group deletion',
      addDescription: 'This immediately creates a gallery group in the current Alibaba.com account.',
      renameDescription: 'This immediately renames a group in the current Alibaba.com account.',
      deleteDescription: 'This immediately deletes a gallery group from the current Alibaba.com account.',
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
      added: 'Gallery group “{name}” created',
      renamed: 'Gallery group renamed to “{name}”',
      deleted: 'Selected gallery group deleted'
    },
    childLoadFailed: 'Could not load subgroups',
    title: 'Manage gallery groups',
    description: 'Manage Alibaba.com gallery (Photo Bank) groups as a tree.',
    treeTitle: 'Group tree',
    treeDescription: 'Up to three levels. Manage a group from the actions on its right.',
    treeLabel: 'Gallery group tree',
    rootCount: '{count} top-level groups',
    addToRoot: 'Create a group under All images',
    rootNameLabel: 'New group name under All images',
    rootNamePlaceholder: 'Enter a top-level group name',
    saving: 'Saving…',
    empty: 'This account has no gallery groups. Create one from the action beside All images.',
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
    shareTitle: 'oneVegetable gallery assets',
    dialogTitle: 'Share gallery assets',
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
