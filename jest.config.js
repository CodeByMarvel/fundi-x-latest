module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: [
    '<rootDir>/node_modules/@react-native-google-signin/google-signin/jest/build/jest/setup.js',
    '<rootDir>/jest.setup.js',
  ],
  // server/ and admin/ are separate projects with their own tooling.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/server/', '<rootDir>/admin/'],
  // These packages ship untranspiled ESM, so Jest must run them through Babel.
  // [/\\] matches both path separators so this also works on Windows.
  transformIgnorePatterns: [
    'node_modules[/\\\\](?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-svg|lucide-react-native|@react-native-google-signin)[/\\\\])',
  ],
  // The app bundler picks lucide's ESM build; Jest needs the CommonJS one.
  moduleNameMapper: {
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
};
