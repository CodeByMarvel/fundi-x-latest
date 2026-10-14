module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Settings from .env (never committed; see .env.example), read when the
    // app is bundled. Restart Metro with --reset-cache after changing .env.
    [
      'module:react-native-dotenv',
      { moduleName: '@env', path: '.env', allowUndefined: true },
    ],
  ],
};
