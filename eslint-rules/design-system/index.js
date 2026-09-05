import noAdhocTransitions from './no-adhoc-transitions.js';
import noArbitraryMotionOrColor from './no-arbitrary-motion-or-color.js';
import noDialogRootOutsidePatterns from './no-dialog-root-outside-patterns.js';
import noDirectToast from './no-direct-toast.js';
import noNativeDialogs from './no-native-dialogs.js';
import noRawControls from './no-raw-controls.js';
import settingsUseSchema from './settings-use-schema.js';

export const designSystemRules = {
  'no-adhoc-transitions': noAdhocTransitions,
  'no-arbitrary-motion-or-color': noArbitraryMotionOrColor,
  'no-dialog-root-outside-patterns': noDialogRootOutsidePatterns,
  'no-direct-toast': noDirectToast,
  'no-native-dialogs': noNativeDialogs,
  'no-raw-controls': noRawControls,
  'settings-use-schema': settingsUseSchema,
};
