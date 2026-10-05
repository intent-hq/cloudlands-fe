import { actionMenuMetadata } from './action-menu/action-menu.meta';
import { collectionMetadata } from './collection/collection.meta';
import { confirmMetadata } from './confirm/confirm.meta';
import { formMetadata } from './form/form.meta';
import { notifyMetadata } from './notify/notify.meta';
import { screenMetadata } from './screen/screen.meta';
import { settingsMetadata } from './settings/settings.meta';
import { parsePatternMetadata, type PatternMetadata } from './pattern-metadata';

const sourceMetadata = [
  actionMenuMetadata,
  collectionMetadata,
  confirmMetadata,
  formMetadata,
  notifyMetadata,
  screenMetadata,
  settingsMetadata,
];

export const canonicalPatternManifest: readonly PatternMetadata[] = sourceMetadata
  .map((metadata) => parsePatternMetadata(metadata))
  .sort((left, right) => left.publicImport.localeCompare(right.publicImport));
