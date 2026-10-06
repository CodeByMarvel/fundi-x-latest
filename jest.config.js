module.exports = {
  preset: '@react-native/jest-preset',
  // These packages ship untranspiled ESM, so Jest must run them through Babel.
  // [/\\] matches both path separators so this also works on Windows.
  transformIgnorePatterns: [
    'node_modules[/\\\\](?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-svg|lucide-react-native)[/\\\\])',
  ],
  // The app bundler picks lucide's ESM build; Jest needs the CommonJS one.
  moduleNameMapper: {
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
};
