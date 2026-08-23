import { registerRootComponent } from 'expo';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import App from './src/App';

// SafeAreaProvider must wrap the whole tree so every screen can read the real
// system-bar insets via useSafeAreaInsets(). This is required under Android 15
// edge-to-edge (targetSdk 36): without it the app draws behind the status bar
// and the top of the screen stops receiving touches. .ts entry → no JSX, so we
// build the element tree with React.createElement.
function Root() {
  return React.createElement(SafeAreaProvider, null, React.createElement(App));
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => Root);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Root);
